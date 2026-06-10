import math
import threading
import time


class SimulatedBridge:
    def __init__(self, runtime, logger):
        self.runtime = runtime
        self.logger = logger
        self.sim_thread = None
        self.running = False

    def start(self):
        self.running = True
        self.sim_thread = threading.Thread(target=self.sim_loop, daemon=True)
        self.sim_thread.start()
        self.logger.info("Initializing Simulated ROS 2 Bridge...")
        self.logger.info("Simulation background thread started.")

    def stop(self):
        self.running = False
        if self.sim_thread:
            self.sim_thread.join()

    def sim_loop(self):
        t = 0.0
        last_graph_update = 0.0
        nodes, topics, services, actions = _mock_topology()
        action_active = False
        action_step = 0
        action_seq = [1, 1]
        action_start_time = 0.0

        while self.running:
            now = time.time()
            if now - last_graph_update > 4.0:
                self.runtime.dispatch_event(
                    {
                        "type": "graph_update",
                        "timestamp": now,
                        "data": {
                            "nodes": nodes,
                            "topics": topics,
                            "services": services,
                            "actions": actions,
                        },
                    }
                )
                last_graph_update = now

            if math.floor(t * 5) != math.floor((t - 0.1) * 5):
                self.runtime.dispatch_event(_pose_event(now, t))

            if math.floor(t * 2) != math.floor((t - 0.1) * 2):
                self.runtime.dispatch_event(_cmd_vel_event(now, t))

            if math.floor(t) != math.floor(t - 0.1):
                self.runtime.dispatch_event(_heavy_event(now, "/camera/image_raw", "sensor_msgs/msg/Image", 921600))
                self.runtime.dispatch_event(_heavy_event(now, "/scan", "sensor_msgs/msg/LaserScan", 1440))

            if not action_active and int(now) % 12 == 0:
                action_active = True
                action_step = 0
                action_seq = [1, 1]
                action_start_time = now
                self.runtime.dispatch_event(_action_goal_event(now))

            if action_active and now - action_start_time > (action_step + 1):
                action_step += 1
                if action_step <= 6:
                    next_num = action_seq[-1] + action_seq[-2]
                    action_seq.append(next_num)
                    self.runtime.dispatch_event(_action_feedback_event(now, list(action_seq)))
                else:
                    self.runtime.dispatch_event(_action_result_event(now, list(action_seq)))
                    action_active = False

            time.sleep(0.1)
            t += 0.1


def _mock_topology():
    nodes = [
        {"name": "/camera_driver", "namespace": "/"},
        {"name": "/lidar_driver", "namespace": "/"},
        {"name": "/localization_node", "namespace": "/"},
        {"name": "/planner_node", "namespace": "/"},
        {"name": "/motion_controller", "namespace": "/"},
        {"name": "/fibonacci_action_server", "namespace": "/"},
    ]
    topics = [
        {
            "name": "/camera/image_raw",
            "types": ["sensor_msgs/msg/Image"],
            "publishers": ["/camera_driver"],
            "subscribers": ["/localization_node"],
        },
        {
            "name": "/scan",
            "types": ["sensor_msgs/msg/LaserScan"],
            "publishers": ["/lidar_driver"],
            "subscribers": ["/planner_node"],
        },
        {
            "name": "/pose",
            "types": ["geometry_msgs/msg/PoseStamped"],
            "publishers": ["/localization_node"],
            "subscribers": ["/planner_node", "/motion_controller"],
        },
        {
            "name": "/cmd_vel",
            "types": ["geometry_msgs/msg/Twist"],
            "publishers": ["/planner_node"],
            "subscribers": ["/motion_controller"],
        },
    ]
    services = [
        {
            "name": "/set_pose",
            "types": ["robot_localization/srv/SetPose"],
            "servers": ["/localization_node"],
        }
    ]
    actions = [
        {
            "name": "/fibonacci",
            "type": "action_tutorials_interfaces/action/Fibonacci",
            "servers": ["/fibonacci_action_server"],
            "clients": ["/planner_node"],
        }
    ]
    return nodes, topics, services, actions


def _pose_event(now, t):
    return {
        "type": "message_event",
        "timestamp": now,
        "data": {
            "topic": "/pose",
            "msg_type": "geometry_msgs/msg/PoseStamped",
            "payload": {
                "header": {"stamp": {"sec": int(now), "nanosec": int((now % 1) * 1e9)}, "frame_id": "map"},
                "pose": {
                    "position": {
                        "x": round(2.0 + 1.5 * math.cos(t * 0.2), 3),
                        "y": round(1.0 + 1.0 * math.sin(t * 0.2), 3),
                        "z": 0.0,
                    },
                    "orientation": {
                        "x": 0.0,
                        "y": 0.0,
                        "z": round(math.sin(t * 0.1), 3),
                        "w": round(math.cos(t * 0.1), 3),
                    },
                },
            },
            "dropped_payload": False,
            "size_bytes": 56,
        },
    }


def _cmd_vel_event(now, t):
    return {
        "type": "message_event",
        "timestamp": now,
        "data": {
            "topic": "/cmd_vel",
            "msg_type": "geometry_msgs/msg/Twist",
            "payload": {
                "linear": {"x": round(0.5 + 0.3 * math.sin(t * 0.5), 2), "y": 0.0, "z": 0.0},
                "angular": {"x": 0.0, "y": 0.0, "z": round(0.2 * math.cos(t * 0.5), 2)},
            },
            "dropped_payload": False,
            "size_bytes": 48,
        },
    }


def _heavy_event(now, topic, msg_type, size_bytes):
    return {
        "type": "message_event",
        "timestamp": now,
        "data": {
            "topic": topic,
            "msg_type": msg_type,
            "payload": None,
            "dropped_payload": True,
            "size_bytes": size_bytes,
        },
    }


def _action_goal_event(now):
    return {
        "type": "message_event",
        "timestamp": now,
        "data": {
            "topic": "/fibonacci/_action/goal",
            "msg_type": "action_tutorials_interfaces/action/Fibonacci_Goal",
            "payload": {"order": 8},
            "dropped_payload": False,
            "size_bytes": 12,
        },
    }


def _action_feedback_event(now, sequence):
    return {
        "type": "message_event",
        "timestamp": now,
        "data": {
            "topic": "/fibonacci/_action/feedback",
            "msg_type": "action_tutorials_interfaces/action/Fibonacci_Feedback",
            "payload": {"sequence": sequence},
            "dropped_payload": False,
            "size_bytes": len(sequence) * 4,
        },
    }


def _action_result_event(now, sequence):
    return {
        "type": "message_event",
        "timestamp": now,
        "data": {
            "topic": "/fibonacci/_action/result",
            "msg_type": "action_tutorials_interfaces/action/Fibonacci_Result",
            "payload": {"sequence": sequence},
            "dropped_payload": False,
            "size_bytes": len(sequence) * 4,
        },
    }

