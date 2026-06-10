import threading
import time
import traceback

from ros_monitor_bridge.config import HEAVY_MESSAGE_TYPES
from ros_monitor_bridge.utils import trim_payload

ROS_AVAILABLE = False

try:
    import rclpy
    from rclpy.executors import MultiThreadedExecutor
    from rclpy.node import Node
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


if ROS_AVAILABLE:
    class ROS2BridgeNode(Node):
        def __init__(self, runtime, rate_limiter, logger):
            super().__init__("ros2_websocket_bridge")
            self.runtime = runtime
            self.rate_limiter = rate_limiter
            self.logger = logger
            self.active_subscriptions = {}
            self.graph_lock = threading.Lock()
            self.graph_timer = self.create_timer(2.0, self.update_graph_topology)
            self.logger.info("Initializing ROS 2 Bridge Node...")
            self.logger.info("ROS 2 graph query timer started (2s interval).")

        def update_graph_topology(self):
            with self.graph_lock:
                try:
                    raw_nodes = self.get_node_names_and_namespaces()
                    raw_topics = self.get_topic_names_and_types()
                    raw_services = self.get_service_names_and_types()

                    nodes_list = [{"name": name, "namespace": namespace} for name, namespace in raw_nodes]
                    filtered_topics = []
                    filtered_services = []
                    action_groups = {}

                    action_topic_suffixes = ["/_action/feedback", "/_action/status"]
                    action_service_suffixes = ["/_action/send_goal", "/_action/get_result", "/_action/cancel_goal"]

                    for topic_name, topic_types in raw_topics:
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

                        filtered_services.append(
                            {
                                "name": service_name,
                                "types": service_types,
                                "servers": _find_service_servers(self, raw_nodes, service_name),
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
                except Exception as exc:
                    self.logger.error(f"Error updating graph topology: {exc}")
                    traceback.print_exc()

        def sync_topic_subscriptions(self, current_topics):
            target_topics = {}
            for topic in current_topics:
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
                    self.active_subscriptions[topic_name] = self.create_subscription(msg_class, topic_name, callback, 10)
                    self.logger.info(f"Successfully subscribed to: {topic_name} [{topic_type}]")
                except Exception as exc:
                    self.logger.warning(f"Could not dynamically subscribe to {topic_name} of type {topic_type}: {exc}")

        def make_subscription_callback(self, topic_name, topic_type):
            def callback(msg):
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
    try:
        while rclpy.ok() and not stop_event.is_set():
            executor.spin_once(timeout_sec=0.5)
    except Exception as exc:
        logger.error(f"ROS 2 Spin interrupted: {exc}")
    finally:
        executor.shutdown()
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()
        logger.info("ROS 2 Executor Thread terminated.")


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

