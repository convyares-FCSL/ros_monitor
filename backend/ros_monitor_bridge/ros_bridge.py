import json
import threading
import time
import traceback
from collections import deque

from ros_monitor_bridge.config import HEAVY_MESSAGE_TYPES
from ros_monitor_bridge.pid_scanner import scan as scan_pids
from ros_monitor_bridge.utils import trim_payload

ROS_AVAILABLE = False

try:
    import rclpy
    from rclpy.executors import MultiThreadedExecutor
    from rclpy.node import Node
    from rclpy.qos import DurabilityPolicy, HistoryPolicy, QoSProfile, ReliabilityPolicy
    from rclpy.serialization import serialize_message
    from rosidl_runtime_py.convert import message_to_ordereddict
    from rosidl_runtime_py.utilities import get_message

    ROS_AVAILABLE = True
except ImportError:
    rclpy = None
    Node = object
    MultiThreadedExecutor = None
    serialize_message = None
    message_to_ordereddict = None
    get_message = None

_LIFECYCLE_TRANSITION_EVENT_TYPE = 'lifecycle_msgs/msg/TransitionEvent'

# BEST_EFFORT lets us receive from any publisher regardless of its reliability
# policy. Depth 10 is sufficient for a passive monitor.
_MONITOR_QOS = QoSProfile(
    history=HistoryPolicy.KEEP_LAST,
    depth=10,
    reliability=ReliabilityPolicy.BEST_EFFORT,
    durability=DurabilityPolicy.VOLATILE,
) if ROS_AVAILABLE else None

# rcl_interfaces/msg/Log severity (uint8) → frontend log level.
_LOG_LEVEL_MAP = {10: "debug", 20: "info", 30: "warn", 40: "error", 50: "fatal"}


class TopicHzTracker:
    """Sliding time-window Hz estimator (count over span).

    Counting arrivals over a multi-second window is immune to executor
    burstiness: messages that queue up and get processed back-to-back have
    near-zero inter-arrival gaps, which made the old last-5-intervals estimate
    report wildly inflated rates (e.g. 20 Hz for a 1 Hz topic).
    """

    _WINDOW_SEC = 3.0

    def __init__(self):
        self._timestamps: dict[str, deque] = {}
        self._lock = threading.Lock()

    def record(self, topic_name: str) -> None:
        with self._lock:
            if topic_name not in self._timestamps:
                self._timestamps[topic_name] = deque(maxlen=512)
            self._timestamps[topic_name].append(time.time())

    def get_all_hz(self) -> dict[str, float]:
        result = {}
        now = time.time()
        cutoff = now - self._WINDOW_SEC
        with self._lock:
            for topic, times in self._timestamps.items():
                # Silent topic: stop reporting so the frontend marks it stale,
                # instead of re-broadcasting the last rate forever.
                if not times or now - times[-1] > 2.5:
                    continue
                while times and times[0] < cutoff:
                    times.popleft()
                n = len(times)
                if n < 2:
                    continue
                age = now - times[0]
                span = times[-1] - times[0]
                if age >= self._WINDOW_SEC * 0.6:
                    # Established stream: exact average over the window —
                    # burst-clustered arrivals don't skew this
                    hz = n / self._WINDOW_SEC
                elif span >= 0.5:
                    # Young stream: rate from observed span
                    hz = (n - 1) / span
                else:
                    # Single tight burst: conservative window average
                    hz = n / self._WINDOW_SEC
                result[topic] = round(hz, 2)
        return result


if ROS_AVAILABLE:
    class ROS2BridgeNode(Node):
        def __init__(self, runtime, rate_limiter, logger):
            super().__init__("ros2_websocket_bridge")
            self.runtime = runtime
            self.rate_limiter = rate_limiter
            self.logger = logger
            self.active_subscriptions = {}
            self.service_event_subscriptions = {}
            self._seen_service_events = set()
            self.hz_tracker = TopicHzTracker()
            self.graph_lock = threading.Lock()
            self.graph_timer = self.create_timer(2.0, self.update_graph_topology)
            self.hz_timer = self.create_timer(1.0, self.emit_frequency_update)
            self.logger.info("Initializing ROS 2 Bridge Node...")
            self.logger.info("ROS 2 graph query timer started (2s interval).")
            self._subscribe_rosout()

        def update_graph_topology(self):
            with self.graph_lock:
                try:
                    raw_nodes = self.get_node_names_and_namespaces()
                    raw_topics = self.get_topic_names_and_types()
                    raw_services = self.get_service_names_and_types()

                    # Build fully-qualified names then scan /proc once for all nodes
                    fq_names = [
                        f"{ns.rstrip('/')}/{name}".replace('//', '/')
                        for name, ns in raw_nodes
                    ]
                    pid_map = scan_pids(fq_names)

                    nodes_list = [
                        {
                            "name": name,
                            "namespace": namespace,
                            "pid": pid_map.get(
                                f"{namespace.rstrip('/')}/{name}".replace('//', '/')
                            ),
                        }
                        for name, namespace in raw_nodes
                    ]
                    filtered_topics = []
                    filtered_services = []
                    action_groups = {}

                    action_topic_suffixes = ["/_action/feedback", "/_action/status"]
                    action_service_suffixes = ["/_action/send_goal", "/_action/get_result", "/_action/cancel_goal"]

                    service_event_topics = {}
                    for topic_name, topic_types in raw_topics:
                        # Service introspection topics — handle separately, don't show in graph
                        if topic_name.endswith('/_service_event'):
                            if topic_types:
                                service_name = topic_name[:-len('/_service_event')]
                                service_event_topics[topic_name] = {
                                    'type': topic_types[0],
                                    'service_name': service_name,
                                }
                            continue

                        action_name = _match_action_suffix(topic_name, action_topic_suffixes)
                        if action_name:
                            action_groups.setdefault(action_name, {"type": "unknown", "servers": set(), "clients": set()})
                            continue

                        filtered_topics.append(
                            {
                                "name": topic_name,
                                "types": topic_types,
                                "publishers": [info.node_name for info in self.get_publishers_info_by_topic(topic_name)],
                                "subscribers": [info.node_name for info in self.get_subscriptions_info_by_topic(topic_name)],
                            }
                        )

                    for service_name, service_types in raw_services:
                        action_name = _match_action_suffix(service_name, action_service_suffixes)
                        if action_name:
                            action_groups.setdefault(action_name, {"type": "unknown", "servers": set(), "clients": set()})
                            action_groups[action_name]["type"] = _normalize_action_type(service_types[0])
                            continue

                        servers = _find_service_servers(self, raw_nodes, service_name)
                        # No live server = uncallable. Covers stale graph-cache entries
                        # from dead nodes AND dangling clients (e.g. lifecycle_manager
                        # holding clients to servers that have shut down).
                        if not servers:
                            continue
                        clients = _find_service_clients(self, raw_nodes, service_name)

                        filtered_services.append(
                            {
                                "name": service_name,
                                "types": service_types,
                                "servers": servers,
                                "clients": clients,
                            }
                        )

                    for action_name, details in action_groups.items():
                        goal_service = f"{action_name}/_action/send_goal"
                        details["servers"].update(_find_service_servers(self, raw_nodes, goal_service))
                        feedback_topic = f"{action_name}/_action/feedback"
                        details["clients"].update(info.node_name for info in self.get_subscriptions_info_by_topic(feedback_topic))

                    graph_update = {
                        "type": "graph_update",
                        "timestamp": time.time(),
                        "data": {
                            "nodes": nodes_list,
                            "topics": filtered_topics,
                            "services": filtered_services,
                            "actions": [
                                {
                                    "name": name,
                                    "type": details["type"],
                                    "servers": list(details["servers"]),
                                    "clients": list(details["clients"]),
                                }
                                for name, details in action_groups.items()
                            ],
                        },
                    }
                    self.runtime.dispatch_event(graph_update)
                    self.sync_topic_subscriptions(filtered_topics)
                    self.sync_service_event_subscriptions(service_event_topics)
                except Exception as exc:
                    self.logger.error(f"Error updating graph topology: {exc}")
                    traceback.print_exc()

        def emit_frequency_update(self):
            updates = self.hz_tracker.get_all_hz()
            if updates:
                self.runtime.dispatch_event(
                    {
                        "type": "frequency_update",
                        "timestamp": time.time(),
                        "data": {"updates": updates},
                    }
                )

        def _subscribe_rosout(self):
            # Dedicated subscription to the aggregated ROS log topic. Emits
            # log_event rather than message_event; the generic subscription path
            # skips /rosout so logs aren't double-reported.
            try:
                log_msg = get_message("rcl_interfaces/msg/Log")
                self.create_subscription(log_msg, "/rosout", self.rosout_callback, 50)
                self.logger.info("Subscribed to /rosout for log capture.")
            except Exception as exc:
                self.logger.warning(f"Could not subscribe to /rosout: {exc}")

        def rosout_callback(self, msg):
            self.runtime.dispatch_event(
                {
                    "type": "log_event",
                    "timestamp": time.time(),
                    "data": {
                        "level": _LOG_LEVEL_MAP.get(msg.level, "info"),
                        "name": msg.name,
                        "msg": msg.msg,
                        "file": msg.file,
                        "function": msg.function,
                        "line": msg.line,
                    },
                }
            )

        def sync_topic_subscriptions(self, current_topics):
            target_topics = {}
            for topic in current_topics:
                if topic["name"] == "/rosout":
                    continue  # handled by the dedicated log_event subscription
                if len(topic["types"]) > 1:
                    self.logger.warning(f"Topic {topic['name']} has multiple types {topic['types']}. Skipping dynamic subscription.")
                    continue
                target_topics[topic["name"]] = topic["types"][0]

            for old_topic in list(self.active_subscriptions.keys()):
                if old_topic not in target_topics:
                    self.logger.info(f"Topic {old_topic} disappeared. Unsubscribing.")
                    self.destroy_subscription(self.active_subscriptions[old_topic])
                    del self.active_subscriptions[old_topic]

            for topic_name, topic_type in target_topics.items():
                if topic_name in self.active_subscriptions:
                    continue
                if topic_type in HEAVY_MESSAGE_TYPES:
                    self.logger.info(f"Skipping heavy message topic subscription: {topic_name} ({topic_type})")
                    continue

                try:
                    msg_class = get_message(topic_type)
                    callback = self.make_subscription_callback(topic_name, topic_type)
                    self.active_subscriptions[topic_name] = self.create_subscription(msg_class, topic_name, callback, _MONITOR_QOS)
                    self.logger.info(f"Successfully subscribed to: {topic_name} [{topic_type}]")
                except Exception as exc:
                    self.logger.warning(f"Could not dynamically subscribe to {topic_name} of type {topic_type}: {exc}")

        def sync_service_event_subscriptions(self, service_event_topics):
            for old_topic in list(self.service_event_subscriptions.keys()):
                if old_topic not in service_event_topics:
                    self.destroy_subscription(self.service_event_subscriptions[old_topic])
                    del self.service_event_subscriptions[old_topic]

            for topic_name, info in service_event_topics.items():
                if topic_name in self.service_event_subscriptions:
                    continue
                try:
                    msg_class = get_message(info['type'])
                    callback = self.make_service_event_callback(info['service_name'])
                    self.service_event_subscriptions[topic_name] = self.create_subscription(
                        msg_class, topic_name, callback, 10
                    )
                    self.logger.info(f"Subscribed to service events: {topic_name} [{info['type']}]")
                except Exception as exc:
                    self.logger.warning(f"Could not subscribe to service event {topic_name}: {exc}")

        def make_service_event_callback(self, service_name):
            def callback(msg):
                try:
                    # service_msgs/msg/ServiceEventInfo constants:
                    # REQUEST_SENT=0, REQUEST_RECEIVED=1, RESPONSE_SENT=2, RESPONSE_RECEIVED=3
                    event_type = msg.info.event_type
                    if event_type not in (0, 1):
                        return

                    if service_name not in self._seen_service_events:
                        self._seen_service_events.add(service_name)
                        self.logger.info(f"First service call captured on: {service_name}")

                    payload = None
                    if hasattr(msg, 'request') and len(msg.request) > 0:
                        payload = trim_payload(message_to_ordereddict(msg.request[0]))

                    self.runtime.dispatch_event({
                        'type': 'service_invoked',
                        'timestamp': time.time(),
                        'data': {
                            'service_name': service_name,
                            'event_type': event_type,
                            'payload': payload,
                        },
                    })
                except Exception as exc:
                    self.logger.debug(f"Failed to parse service event for {service_name}: {exc}")
            return callback

        def make_subscription_callback(self, topic_name, topic_type):
            # Topics matching this pattern publish JSON-encoded blackboard snapshots:
            # {"tree_id": "MyTree", "vars": {"key": value, ...}}
            # Published by a BT executor (or a thin ROS node wrapping one) so the
            # dashboard blackboard panel shows live values without changing the
            # Groot2 ZMQ protocol (which has no blackboard retrieval).
            is_bb_topic = (
                topic_type == 'std_msgs/msg/String'
                and (topic_name.endswith('/bt_blackboard') or topic_name == '/bt_monitor/blackboard')
            )

            def callback(msg):
                # Always record arrival for Hz tracking
                self.hz_tracker.record(topic_name)

                # BT blackboard JSON topic → emit bt_blackboard event directly.
                if is_bb_topic:
                    try:
                        data = json.loads(msg.data)
                        if isinstance(data.get('vars'), dict):
                            self.runtime.dispatch_event({
                                'type': 'bt_blackboard',
                                'timestamp': time.time(),
                                'data': {
                                    'tree_id': data.get('tree_id', ''),
                                    'vars': data['vars'],
                                },
                            })
                    except Exception:
                        pass
                    return  # don't double-emit as message_event

                # Lifecycle TransitionEvent → emit dedicated lifecycle_event
                if topic_type == _LIFECYCLE_TRANSITION_EVENT_TYPE:
                    try:
                        node_name = _node_name_from_transition_topic(topic_name)
                        self.runtime.dispatch_event(
                            {
                                "type": "lifecycle_event",
                                "timestamp": time.time(),
                                "data": {
                                    "node_name": node_name,
                                    "start_state": msg.start_state.label,
                                    "goal_state": msg.goal_state.label,
                                    "transition_id": msg.transition.id,
                                },
                            }
                        )
                    except Exception as exc:
                        self.logger.debug(f"Failed to parse lifecycle event on {topic_name}: {exc}")
                    return  # Don't emit a message_event for lifecycle transitions

                if not self.rate_limiter.is_allowed(topic_name):
                    return

                try:
                    size_bytes = len(serialize_message(msg))
                    payload = trim_payload(message_to_ordereddict(msg))
                    self.runtime.dispatch_event(
                        {
                            "type": "message_event",
                            "timestamp": time.time(),
                            "data": {
                                "topic": topic_name,
                                "msg_type": topic_type,
                                "payload": payload,
                                "dropped_payload": False,
                                "size_bytes": size_bytes,
                            },
                        }
                    )
                except Exception as exc:
                    self.logger.debug(f"Failed to serialize message on {topic_name}: {exc}")

            return callback


def run_ros2_node(runtime, rate_limiter, stop_event, logger):
    logger.info("Starting ROS 2 Executor Thread...")
    rclpy.init()
    node = ROS2BridgeNode(runtime, rate_limiter, logger)
    executor = MultiThreadedExecutor()
    executor.add_node(node)

    # spin_once() on a MultiThreadedExecutor dispatches a single callback per
    # call and rebuilds the wait set each time — with many subscriptions it
    # starves, messages drain in bursts, and Hz/particles misrepresent the
    # stream. spin() processes callbacks concurrently as they arrive.
    # The watchdog timer wakes spin() so the thread exits on shutdown.
    def _stop_watchdog():
        if stop_event.is_set():
            executor.shutdown(timeout_sec=0)

    node.create_timer(0.25, _stop_watchdog)

    try:
        executor.spin()
    except Exception as exc:
        logger.error(f"ROS 2 Spin interrupted: {exc}")
    finally:
        executor.shutdown(timeout_sec=1.0)
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
        logger.info("ROS 2 Executor Thread terminated.")


def _node_name_from_transition_topic(topic_name: str) -> str:
    """Derive node name from a lifecycle TransitionEvent topic path."""
    suffix = '/transition_event'
    if topic_name.endswith(suffix):
        return topic_name[: -len(suffix)]
    return topic_name


def _match_action_suffix(name, suffixes):
    for suffix in suffixes:
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return None


def _normalize_action_type(action_type):
    return (
        action_type.replace("_SendGoal", "")
        .replace("_GetResult", "")
        .replace("_CancelGoal", "")
    )


def _find_service_servers(node, raw_nodes, service_name):
    servers = []
    for node_name, node_namespace in raw_nodes:
        for current_service_name, _ in node.get_service_names_and_types_by_node(node_name, node_namespace):
            if current_service_name == service_name:
                servers.append(node_name)
                break
    return servers


def _find_service_clients(node, raw_nodes, service_name):
    clients = []
    for node_name, node_namespace in raw_nodes:
        for current_service_name, _ in node.get_client_names_and_types_by_node(node_name, node_namespace):
            if current_service_name == service_name:
                clients.append(node_name)
                break
    return clients
