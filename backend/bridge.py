#!/usr/bin/env python3
import os
import sys
import json
import time
import argparse
import asyncio
import threading
import logging
import math
import traceback
from http.server import SimpleHTTPRequestHandler
from socketserver import ThreadingTCPServer

# Configure logger
logging.basicConfig(level=logging.INFO, format='[%(asctime)s] [%(levelname)s] %(message)s')
logger = logging.getLogger("ROS2Bridge")

# Attempt importing rclpy and rosidl utilities for ROS 2 functionality
SIM_MODE = False
try:
    import rclpy
    from rclpy.node import Node
    from rclpy.executors import MultiThreadedExecutor
    from rclpy.serialization import serialize_message
    from rosidl_runtime_py.utilities import get_message
    from rosidl_runtime_py.convert import message_to_ordereddict
    logger.info("ROS 2 environment detected. Running in standard ROS 2 Mode.")
except ImportError:
    SIM_MODE = True
    logger.warning("ROS 2 (rclpy/rosidl) not found. Falling back to Simulation Mode.")

# WebSocket library
try:
    import websockets
except ImportError:
    logger.error("The 'websockets' library is required. Please install it using: pip install websockets")
    sys.exit(1)

# Thread-safe queue and loop reference
event_queue = None
global_loop = None
connected_clients = set()

# Configuration variables
HTTP_PORT = 8080
WS_PORT = 8765
WS_HOST = "0.0.0.0"
RATE_LIMIT_HZ = 10.0  # Max rate of message events per topic to frontend

# List of topics/types to explicitly trim or drop payloads for (e.g. image/lidar arrays)
HEAVY_MESSAGE_TYPES = {
    "sensor_msgs/msg/Image",
    "sensor_msgs/msg/CompressedImage",
    "sensor_msgs/msg/PointCloud2",
    "sensor_msgs/msg/LaserScan",
    "nav_msgs/msg/OccupancyGrid"
}

# --- Payload Trimming Helper ---
def trim_payload(data, max_list_len=50):
    """Recursively traverses a python dict/list to prune large arrays so JSON serialization is lightweight."""
    if isinstance(data, dict):
        return {k: trim_payload(v, max_list_len) for k, v in data.items()}
    elif isinstance(data, list):
        if len(data) > max_list_len:
            return f"[Array truncated, original length={len(data)}]"
        return [trim_payload(x, max_list_len) for x in data]
    elif isinstance(data, (bytes, bytearray)):
        return f"[Bytes truncated, length={len(data)}]"
    return data

# --- Rate Limiter ---
class RateLimiter:
    def __init__(self, limit_hz):
        self.interval = 1.0 / limit_hz if limit_hz > 0 else 0
        self.last_sent = {}

    def is_allowed(self, topic_name):
        if self.interval == 0:
            return True
        now = time.time()
        last = self.last_sent.get(topic_name, 0)
        if now - last >= self.interval:
            self.last_sent[topic_name] = now
            return True
        return False

rate_limiter = RateLimiter(RATE_LIMIT_HZ)

# --- Thread-Safe Queue Dispatcher ---
def dispatch_event(event_dict):
    """Utility to queue events for async websocket dispatch from any thread."""
    global global_loop, event_queue
    if global_loop and event_queue:
        try:
            global_loop.call_soon_threadsafe(event_queue.put_nowait, event_dict)
        except Exception:
            pass

# --- ROS 2 Bridge Node ---
if not SIM_MODE:
    class ROS2BridgeNode(Node):
        def __init__(self):
            super().__init__('ros2_websocket_bridge')
            logger.info("Initializing ROS 2 Bridge Node...")
            
            self.active_subscriptions = {}  # topic_name -> subscription object
            self.graph_lock = threading.Lock()
            
            # Periodic timer to query the ROS 2 graph and push updates
            self.graph_timer = self.create_timer(2.0, self.update_graph_topology)
            logger.info("ROS 2 graph query timer started (2s interval).")

        def update_graph_topology(self):
            """Queries the ROS 2 graph, groupings actions, and updates topic subscriptions."""
            with self.graph_lock:
                try:
                    # 1. Fetch raw nodes list
                    raw_nodes = self.get_node_names_and_namespaces()
                    nodes_list = [{"name": name, "namespace": ns} for name, ns in raw_nodes]
                    
                    # 2. Fetch topics and types
                    raw_topics = self.get_topic_names_and_types()
                    
                    # 3. Fetch services and types
                    raw_services = self.get_service_names_and_types()
                    
                    # Action recognition and grouping:
                    # Action topics end in /_action/feedback, /_action/status
                    # Action services end in /_action/send_goal, /_action/get_result, /_action/cancel_goal
                    action_groups = {}  # base_name -> {type, servers: set, clients: set}
                    
                    filtered_topics = []
                    filtered_services = []

                    # Process Actions from topics & services
                    action_suffixes_topics = ["/_action/feedback", "/_action/status"]
                    action_suffixes_services = ["/_action/send_goal", "/_action/get_result", "/_action/cancel_goal"]

                    # Filter topics
                    for topic_name, topic_types in raw_topics:
                        is_action = False
                        for suffix in action_suffixes_topics:
                            if topic_name.endswith(suffix):
                                is_action = True
                                base_name = topic_name[:-len(suffix)]
                                if base_name not in action_groups:
                                    action_groups[base_name] = {"type": "unknown", "servers": set(), "clients": set()}
                                break
                        
                        if is_action:
                            continue
                            
                        # Standard topic resolution: map publishers & subscribers
                        pubs = [info.node_name for info in self.get_publishers_info_by_topic(topic_name)]
                        subs = [info.node_name for info in self.get_subscriptions_info_by_topic(topic_name)]
                        
                        filtered_topics.append({
                            "name": topic_name,
                            "types": topic_types,
                            "publishers": pubs,
                            "subscribers": subs
                        })

                    # Filter services
                    for srv_name, srv_types in raw_services:
                        is_action = False
                        for suffix in action_suffixes_services:
                            if srv_name.endswith(suffix):
                                is_action = True
                                base_name = srv_name[:-len(suffix)]
                                # Extract action type from service type (e.g. action_tutorials_interfaces/action/Fibonacci_SendGoal -> action_tutorials_interfaces/action/Fibonacci)
                                act_type = srv_types[0]
                                if "_SendGoal" in act_type:
                                    act_type = act_type.replace("_SendGoal", "")
                                elif "_GetResult" in act_type:
                                    act_type = act_type.replace("_GetResult", "")
                                elif "_CancelGoal" in act_type:
                                    act_type = act_type.replace("_CancelGoal", "")
                                
                                if base_name not in action_groups:
                                    action_groups[base_name] = {"type": act_type, "servers": set(), "clients": set()}
                                else:
                                    if act_type != "unknown":
                                        action_groups[base_name]["type"] = act_type
                                break
                        
                        if is_action:
                            continue
                        
                        # Service servers (clients cannot be queried directly in rclpy, so server nodes only)
                        servers = []
                        # Scan all nodes to see which one hosts this service
                        for node_name, node_ns in raw_nodes:
                            node_srvs = self.get_service_names_and_types_by_node(node_name, node_ns)
                            for nsrv_name, _ in node_srvs:
                                if nsrv_name == srv_name:
                                    servers.append(node_name)
                                    break
                                    
                        filtered_services.append({
                            "name": srv_name,
                            "types": srv_types,
                            "servers": servers
                        })

                    # Build action client / server details
                    # In ROS 2, an action server hosts the services; an action client publishes goal/cancel and subscribes to status/feedback.
                    for action_name, details in action_groups.items():
                        # Determine server: who hosts the send_goal service
                        goal_srv = f"{action_name}/_action/send_goal"
                        for node_name, node_ns in raw_nodes:
                            node_srvs = self.get_service_names_and_types_by_node(node_name, node_ns)
                            for nsrv_name, _ in node_srvs:
                                if nsrv_name == goal_srv:
                                    details["servers"].add(node_name)
                                    break
                        
                        # Determine client: who is subscribed to feedback topic
                        feedback_topic = f"{action_name}/_action/feedback"
                        subs_info = self.get_subscriptions_info_by_topic(feedback_topic)
                        for info in subs_info:
                            details["clients"].add(info.node_name)

                    actions_list = [
                        {
                            "name": name,
                            "type": d["type"],
                            "servers": list(d["servers"]),
                            "clients": list(d["clients"])
                        }
                        for name, d in action_groups.items()
                    ]

                    # 4. Compile topology update
                    graph_update = {
                        "type": "graph_update",
                        "timestamp": time.time(),
                        "data": {
                            "nodes": nodes_list,
                            "topics": filtered_topics,
                            "services": filtered_services,
                            "actions": actions_list
                        }
                    }
                    dispatch_event(graph_update)

                    # 5. Dynamically manage subscriptions
                    self.sync_topic_subscriptions(filtered_topics)

                except Exception as e:
                    logger.error(f"Error updating graph topology: {e}")
                    traceback.print_exc()

        def sync_topic_subscriptions(self, current_topics):
            """Registers subscribers for newly discovered topics and cleans up old ones."""
            target_topics = {}
            for t in current_topics:
                # Handle topics with multiple types gracefully
                if len(t["types"]) > 1:
                    logger.warning(f"Topic {t['name']} has multiple types {t['types']}. Skipping dynamic subscription.")
                    continue
                t_type = t["types"][0]
                target_topics[t["name"]] = t_type

            # Remove subscriptions for topics that no longer exist
            for old_topic in list(self.active_subscriptions.keys()):
                if old_topic not in target_topics:
                    logger.info(f"Topic {old_topic} disappeared. Unsubscribing.")
                    self.destroy_subscription(self.active_subscriptions[old_topic])
                    del self.active_subscriptions[old_topic]

            # Create subscriptions for new topics
            for topic_name, topic_type in target_topics.items():
                if topic_name in self.active_subscriptions:
                    continue  # already subscribed

                # If it's a heavy data topic, do not subscribe. Instead, we skip to save bandwith
                # and let the frontend know about it via metadata updates in the graph.
                if topic_type in HEAVY_MESSAGE_TYPES:
                    logger.info(f"Skipping heavy message topic subscription: {topic_name} ({topic_type})")
                    continue

                try:
                    # Dynamically get Python message class
                    msg_class = get_message(topic_type)
                    
                    # Create callback closure
                    callback = self.make_subscription_callback(topic_name, topic_type)
                    
                    # Standard QOS profile: depth 10
                    sub = self.create_subscription(
                        msg_class,
                        topic_name,
                        callback,
                        10
                    )
                    self.active_subscriptions[topic_name] = sub
                    logger.info(f"Successfully subscribed to: {topic_name} [{topic_type}]")
                except Exception as e:
                    logger.warning(f"Could not dynamically subscribe to {topic_name} of type {topic_type}: {e}")

        def make_subscription_callback(self, topic_name, topic_type):
            """Creates a closure callback to handle incoming message telemetry."""
            def callback(msg):
                # Apply rate limiting
                if not rate_limiter.is_allowed(topic_name):
                    return

                try:
                    # Serialize message to compute byte size
                    serialized_bytes = serialize_message(msg)
                    size_bytes = len(serialized_bytes)

                    # Convert ROS Message object to python dict
                    msg_dict = message_to_ordereddict(msg)
                    trimmed_payload = trim_payload(msg_dict)

                    msg_event = {
                        "type": "message_event",
                        "timestamp": time.time(),
                        "data": {
                            "topic": topic_name,
                            "msg_type": topic_type,
                            "payload": trimmed_payload,
                            "dropped_payload": False,
                            "size_bytes": size_bytes
                        }
                    }
                    dispatch_event(msg_event)
                except Exception as e:
                    logger.debug(f"Failed to serialize message on {topic_name}: {e}")
            return callback

    def run_ros2_node():
        """Target for ROS 2 Executor thread."""
        logger.info("Starting ROS 2 Executor Thread...")
        rclpy.init()
        node = ROS2BridgeNode()
        executor = MultiThreadedExecutor()
        executor.add_node(node)
        try:
            executor.spin()
        except Exception as e:
            logger.error(f"ROS 2 Spin interrupted: {e}")
        finally:
            node.destroy_node()
            rclpy.shutdown()
            logger.info("ROS 2 Executor Thread terminated.")

# --- Simulation Mode ---
class SimulatedBridge:
    def __init__(self):
        logger.info("Initializing Simulated ROS 2 Bridge...")
        self.sim_thread = None
        self.running = False
        
    def start(self):
        self.running = True
        self.sim_thread = threading.Thread(target=self.sim_loop, daemon=True)
        self.sim_thread.start()
        logger.info("Simulation background thread started.")
        
    def stop(self):
        self.running = False
        if self.sim_thread:
            self.sim_thread.join()
            
    def sim_loop(self):
        """Simulates periodic graph updates and message streams."""
        t = 0.0
        last_graph_update = 0.0
        
        # Static mock graph topology
        nodes = [
            {"name": "/camera_driver", "namespace": "/"},
            {"name": "/lidar_driver", "namespace": "/"},
            {"name": "/localization_node", "namespace": "/"},
            {"name": "/planner_node", "namespace": "/"},
            {"name": "/motion_controller", "namespace": "/"},
            {"name": "/fibonacci_action_server", "namespace": "/"}
        ]
        
        topics = [
            {
                "name": "/camera/image_raw",
                "types": ["sensor_msgs/msg/Image"],
                "publishers": ["/camera_driver"],
                "subscribers": ["/localization_node"]
            },
            {
                "name": "/scan",
                "types": ["sensor_msgs/msg/LaserScan"],
                "publishers": ["/lidar_driver"],
                "subscribers": ["/planner_node"]
            },
            {
                "name": "/pose",
                "types": ["geometry_msgs/msg/PoseStamped"],
                "publishers": ["/localization_node"],
                "subscribers": ["/planner_node", "/motion_controller"]
            },
            {
                "name": "/cmd_vel",
                "types": ["geometry_msgs/msg/Twist"],
                "publishers": ["/planner_node"],
                "subscribers": ["/motion_controller"]
            }
        ]
        
        services = [
            {
                "name": "/set_pose",
                "types": ["robot_localization/srv/SetPose"],
                "servers": ["/localization_node"]
            }
        ]
        
        actions = [
            {
                "name": "/fibonacci",
                "type": "action_tutorials_interfaces/action/Fibonacci",
                "servers": ["/fibonacci_action_server"],
                "clients": ["/planner_node"]
            }
        ]
        
        # Action state variables
        action_active = False
        action_step = 0
        action_seq = [1, 1]
        action_start_time = 0.0
        
        while self.running:
            now = time.time()
            
            # Send Graph update every 4 seconds
            if now - last_graph_update > 4.0:
                graph_update = {
                    "type": "graph_update",
                    "timestamp": now,
                    "data": {
                        "nodes": nodes,
                        "topics": topics,
                        "services": services,
                        "actions": actions
                    }
                }
                dispatch_event(graph_update)
                last_graph_update = now
                
            # Send /pose at 5Hz
            if math.floor(t * 5) != math.floor((t - 0.1) * 5):
                pose_event = {
                    "type": "message_event",
                    "timestamp": now,
                    "data": {
                        "topic": "/pose",
                        "msg_type": "geometry_msgs/msg/PoseStamped",
                        "payload": {
                            "header": {"stamp": {"sec": int(now), "nanosec": int((now % 1)*1e9)}, "frame_id": "map"},
                            "pose": {
                                "position": {
                                    "x": round(2.0 + 1.5 * math.cos(t * 0.2), 3),
                                    "y": round(1.0 + 1.0 * math.sin(t * 0.2), 3),
                                    "z": 0.0
                                },
                                "orientation": {"x": 0.0, "y": 0.0, "z": round(math.sin(t * 0.1), 3), "w": round(math.cos(t * 0.1), 3)}
                            }
                        },
                        "dropped_payload": False,
                        "size_bytes": 56
                    }
                }
                dispatch_event(pose_event)
                
            # Send /cmd_vel at 2Hz
            if math.floor(t * 2) != math.floor((t - 0.1) * 2):
                cmd_vel_event = {
                    "type": "message_event",
                    "timestamp": now,
                    "data": {
                        "topic": "/cmd_vel",
                        "msg_type": "geometry_msgs/msg/Twist",
                        "payload": {
                            "linear": {"x": round(0.5 + 0.3 * math.sin(t * 0.5), 2), "y": 0.0, "z": 0.0},
                            "angular": {"x": 0.0, "y": 0.0, "z": round(0.2 * math.cos(t * 0.5), 2)}
                        },
                        "dropped_payload": False,
                        "size_bytes": 48
                    }
                }
                dispatch_event(cmd_vel_event)
                
            # Send trimmed telemetry for heavy messages (e.g. image/scan) at 1Hz
            if math.floor(t) != math.floor(t - 0.1):
                # Image metadata envelope
                img_event = {
                    "type": "message_event",
                    "timestamp": now,
                    "data": {
                        "topic": "/camera/image_raw",
                        "msg_type": "sensor_msgs/msg/Image",
                        "payload": None,
                        "dropped_payload": True,
                        "size_bytes": 921600
                    }
                }
                dispatch_event(img_event)

                # Scan metadata envelope
                scan_event = {
                    "type": "message_event",
                    "timestamp": now,
                    "data": {
                        "topic": "/scan",
                        "msg_type": "sensor_msgs/msg/LaserScan",
                        "payload": None,
                        "dropped_payload": True,
                        "size_bytes": 1440
                    }
                }
                dispatch_event(scan_event)

            # Action state machine simulator: /fibonacci action
            # Runs every 12 seconds
            if not action_active and int(now) % 12 == 0:
                action_active = True
                action_step = 0
                action_seq = [1, 1]
                action_start_time = now
                # Broadcast goal message
                goal_msg = {
                    "type": "message_event",
                    "timestamp": now,
                    "data": {
                        "topic": "/fibonacci/_action/goal",
                        "msg_type": "action_tutorials_interfaces/action/Fibonacci_Goal",
                        "payload": {"order": 8},
                        "dropped_payload": False,
                        "size_bytes": 12
                    }
                }
                dispatch_event(goal_msg)
                
            if action_active:
                # Send feedback every 1 second
                if now - action_start_time > (action_step + 1):
                    action_step += 1
                    if action_step <= 6:
                        # Append next fibonacci number
                        next_num = action_seq[-1] + action_seq[-2]
                        action_seq.append(next_num)
                        
                        feedback_msg = {
                            "type": "message_event",
                            "timestamp": now,
                            "data": {
                                "topic": "/fibonacci/_action/feedback",
                                "msg_type": "action_tutorials_interfaces/action/Fibonacci_Feedback",
                                "payload": {"sequence": list(action_seq)},
                                "dropped_payload": False,
                                "size_bytes": len(action_seq) * 4
                            }
                        }
                        dispatch_event(feedback_msg)
                    else:
                        # Send action result
                        result_msg = {
                            "type": "message_event",
                            "timestamp": now,
                            "data": {
                                "topic": "/fibonacci/_action/result",
                                "msg_type": "action_tutorials_interfaces/action/Fibonacci_Result",
                                "payload": {"sequence": list(action_seq)},
                                "dropped_payload": False,
                                "size_bytes": len(action_seq) * 4
                            }
                        }
                        dispatch_event(result_msg)
                        action_active = False
                        
            time.sleep(0.1)
            t += 0.1

# --- WebSocket Broadcast Task ---
async def websocket_broadcaster():
    """Reads messages from the thread-safe queue and broadcasts them to all websocket connections."""
    logger.info("WebSocket broadcaster task running.")
    while True:
        event = await event_queue.get()
        if connected_clients:
            payload = json.dumps(event)
            # Gather all sends so they run concurrently
            await asyncio.gather(
                *[asyncio.create_task(send_to_client(client, payload)) for client in list(connected_clients)],
                return_exceptions=True
            )
        event_queue.task_done()

async def send_to_client(client, payload):
    try:
        await client.send(payload)
    except websockets.exceptions.ConnectionClosed:
        pass  # Will be cleaned up by the client handler loop

# --- WebSocket Handler (v10+ compatibility) ---
async def ws_handler(websocket, *args):
    """Handles WebSocket connections and incoming messages."""
    connected_clients.add(websocket)
    addr = websocket.remote_address
    logger.info(f"WebSocket client connected from {addr[0]}:{addr[1]}. Active clients: {len(connected_clients)}")
    
    try:
        # Keep client connection open; can handle client control inputs if needed
        async for message in websocket:
            try:
                data = json.loads(message)
                logger.info(f"Received from client {addr}: {data}")
            except json.JSONDecodeError:
                logger.warning("Received invalid JSON from client.")
    except websockets.exceptions.ConnectionClosedOK:
        pass
    except Exception as e:
        logger.error(f"WebSocket connection error with {addr}: {e}")
    finally:
        connected_clients.remove(websocket)
        logger.info(f"WebSocket client disconnected {addr[0]}:{addr[1]}. Remaining: {len(connected_clients)}")

# --- Static File HTTP Server ---
class CORSHTTPRequestHandler(SimpleHTTPRequestHandler):
    """Standard HTTP request handler with CORS headers enabled for easy local development."""
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

    def log_message(self, format, *args):
        # Override to suppress noisy HTTP access logs in terminal
        pass

def run_http_server(root_dir, port):
    """Target for HTTP Server thread."""
    os.chdir(root_dir)
    # Ensure port is reusable immediately
    ThreadingTCPServer.allow_reuse_address = True
    with ThreadingTCPServer(("", port), CORSHTTPRequestHandler) as httpd:
        logger.info(f"Serving frontend static files from: {root_dir}")
        logger.info(f"Open in browser: http://localhost:{port}")
        try:
            httpd.serve_forever()
        except Exception as e:
            logger.info(f"HTTP Server stopped: {e}")

# --- Async Main Loop ---
async def async_main(args, frontend_dir):
    global global_loop, event_queue
    global_loop = asyncio.get_running_loop()
    event_queue = asyncio.Queue()

    # Start WebSocket Server
    async with websockets.serve(ws_handler, WS_HOST, args.ws_port):
        logger.info(f"WebSocket server started on ws://{WS_HOST}:{args.ws_port}")
        
        # Start broadcaster task
        broadcaster_task = asyncio.create_task(websocket_broadcaster())
        
        # Start HTTP server thread
        http_thread = threading.Thread(
            target=run_http_server, 
            args=(frontend_dir, args.port), 
            daemon=True
        )
        http_thread.start()

        # Start ROS Node or Simulation thread
        if SIM_MODE:
            sim = SimulatedBridge()
            sim.start()
        else:
            ros_thread = threading.Thread(target=run_ros2_node, daemon=True)
            ros_thread.start()

        # Run forever
        try:
            await asyncio.Future()  # run forever
        except asyncio.CancelledError:
            pass
        finally:
            if SIM_MODE:
                sim.stop()
            broadcaster_task.cancel()

# --- Main Entry Point ---
def main():
    global SIM_MODE, RATE_LIMIT_HZ, rate_limiter
    parser = argparse.ArgumentParser(description="ROS 2 Browser-based 3D Network Visualizer Bridge")
    parser.add_argument('--port', type=int, default=HTTP_PORT, help="Port to serve frontend files (HTTP)")
    parser.add_argument('--ws-port', type=int, default=WS_PORT, help="Port to run WebSocket Server")
    parser.add_argument('--sim', action='store_true', help="Force simulation mode (ignore rclpy)")
    parser.add_argument('--rate-limit', type=float, default=RATE_LIMIT_HZ, help="Throttling rate for messages (Hz)")
    args = parser.parse_args()

    if args.sim:
        SIM_MODE = True
        logger.info("Simulation mode forced via --sim flag.")
        
    RATE_LIMIT_HZ = args.rate_limit
    rate_limiter = RateLimiter(RATE_LIMIT_HZ)

    # Resolve frontend root directory (parent/frontend)
    script_dir = os.path.dirname(os.path.realpath(__file__))
    frontend_dir = os.path.abspath(os.path.join(script_dir, "..", "frontend"))
    
    if not os.path.exists(frontend_dir):
        # Fallback to current workspace / frontend if script structure varies
        frontend_dir = os.path.abspath(os.path.join(os.getcwd(), "frontend"))
    
    # Create frontend directory structure if it doesn't exist (just in case)
    os.makedirs(frontend_dir, exist_ok=True)

    # Run loop
    try:
        asyncio.run(async_main(args, frontend_dir))
    except KeyboardInterrupt:
        logger.info("Shutting down bridge...")
    finally:
        logger.info("Bridge closed.")

if __name__ == '__main__':
    main()
