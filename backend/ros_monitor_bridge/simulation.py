import math
import random
import threading
import time


# Nodes that participate in lifecycle simulation
_LIFECYCLE_NODES = [
    '/camera_driver',
    '/lidar_driver',
    '/localization_node',
    '/planner_node',
    '/motion_controller',
]

# Lifecycle progression: unconfigured -> inactive -> active (loop with occasional error)
_LIFECYCLE_ORDER = ['unconfigured', 'inactive', 'active']

_NODE_PARAMS = {
    '/camera_driver': {
        'image_width': 1280, 'image_height': 720,
        'frame_id': 'camera_link', 'fps': 30.0, 'encoding': 'bgr8',
        'auto_exposure': True,
    },
    '/lidar_driver': {
        'range_min': 0.12, 'range_max': 30.0,
        'frame_id': 'laser', 'scan_frequency': 15.0, 'angle_increment': 0.00436,
    },
    '/localization_node': {
        'use_sim_time': False, 'map_frame': 'map',
        'odom_frame': 'odom', 'robot_frame': 'base_link', 'transform_tolerance': 0.1,
    },
    '/planner_node': {
        'max_vel_x': 0.5, 'max_vel_theta': 1.0,
        'planner_frequency': 5.0, 'goal_tolerance': 0.1, 'xy_tolerance': 0.05,
    },
    '/motion_controller': {
        'controller_frequency': 10.0, 'acc_lim_x': 2.5,
        'acc_lim_theta': 3.2, 'kp': 1.2, 'kd': 0.08,
    },
}

# Nominal publish rates for frequency_update simulation
_TOPIC_HZ = {
    '/pose': 5.0,
    '/cmd_vel': 2.0,
    '/camera/image_raw': 1.0,
    '/scan': 1.0,
}


class SimulatedBridge:
    def __init__(self, runtime, logger):
        self.runtime = runtime
        self.logger = logger
        self.sim_thread = None
        self.running = False

        rng = random.Random(42)
        # Each lifecycle node staggers its activation to look realistic
        self._lifecycle_states = {n: 'unconfigured' for n in _LIFECYCLE_NODES}
        self._lifecycle_next = {n: rng.uniform(2.0, 4.5) for n in _LIFECYCLE_NODES}
        self._last_hz_emit = 0.0
        self._log_idx = 0
        self._last_log_emit = 0.0

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

            # --- Graph topology (every 4s) ---
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

            # --- Lifecycle state machine ---
            self._tick_lifecycle(t, now)

            # --- Message events ---
            if math.floor(t * 5) != math.floor((t - 0.1) * 5):
                self.runtime.dispatch_event(_pose_event(now, t))

            if math.floor(t * 2) != math.floor((t - 0.1) * 2):
                self.runtime.dispatch_event(_cmd_vel_event(now, t))

            if math.floor(t) != math.floor(t - 0.1):
                self.runtime.dispatch_event(_heavy_event(now, "/camera/image_raw", "sensor_msgs/msg/Image", 921600))
                self.runtime.dispatch_event(_heavy_event(now, "/scan", "sensor_msgs/msg/LaserScan", 1440))

            # --- Frequency update (every 1s) ---
            if now - self._last_hz_emit >= 1.0:
                self._emit_frequency_update(now, t)
                self._last_hz_emit = now

            # --- Service invocation (every ~8s, staccato spike demo) ---
            if math.floor(t / 8) != math.floor((t - 0.1) / 8):
                self.runtime.dispatch_event(
                    {
                        "type": "service_invoked",
                        "timestamp": now,
                        "data": {"service_name": "/set_pose"},
                    }
                )

            # --- Synthetic log lines (every ~2.5s, rotating sample) ---
            if now - self._last_log_emit >= 2.5:
                self.runtime.dispatch_event(_log_event(now, self._log_idx))
                self._log_idx += 1
                self._last_log_emit = now

            # --- Action simulation ---
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

    def _tick_lifecycle(self, t, now):
        for node_name in _LIFECYCLE_NODES:
            if t < self._lifecycle_next[node_name]:
                continue

            current = self._lifecycle_states[node_name]
            idx = _LIFECYCLE_ORDER.index(current) if current in _LIFECYCLE_ORDER else 0

            if current == 'active':
                # Occasionally inject a brief error on the planner then recover
                if int(t) % 47 == 0 and node_name == '/planner_node':
                    next_state = 'error_processing'
                    self._lifecycle_next[node_name] = t + 1.5
                else:
                    self._lifecycle_next[node_name] = t + 60.0
                    continue
            elif current == 'error_processing':
                next_state = 'active'
                self._lifecycle_next[node_name] = t + 60.0
            else:
                next_idx = idx + 1
                if next_idx >= len(_LIFECYCLE_ORDER):
                    continue
                next_state = _LIFECYCLE_ORDER[next_idx]
                # Each step takes 1.5–3s
                self._lifecycle_next[node_name] = t + random.uniform(1.5, 3.0)

            self._lifecycle_states[node_name] = next_state
            self.runtime.dispatch_event(
                {
                    "type": "lifecycle_event",
                    "timestamp": now,
                    "data": {
                        "node_name": node_name,
                        "start_state": current,
                        "goal_state": next_state,
                    },
                }
            )

            if next_state == 'active' and node_name in _NODE_PARAMS:
                self.runtime.dispatch_event(
                    {
                        "type": "node_params_event",
                        "timestamp": now,
                        "data": {
                            "node_name": node_name,
                            "params": _NODE_PARAMS[node_name],
                        },
                    }
                )

    def _emit_frequency_update(self, now, t):
        updates = {}
        for topic, base_hz in _TOPIC_HZ.items():
            # Add subtle sinusoidal jitter to make it look live
            jitter = base_hz * 0.06 * math.sin(t * 0.7 + abs(hash(topic)) % 7)
            updates[topic] = round(base_hz + jitter, 2)
        self.runtime.dispatch_event(
            {
                "type": "frequency_update",
                "timestamp": now,
                "data": {"updates": updates},
            }
        )


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
            # Match the real bridge's contract — graph_update services always
            # carry a clients list; the frontend types require it.
            "clients": ["/planner_node"],
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


# Rotating sample log lines for the no-ROS demo so the Logging console isn't empty.
_SAMPLE_LOGS = [
    ("info", "/control_node", "Control loop running at 50 Hz"),
    ("debug", "/sensor_hub", "Fused 3 sensor streams (imu, scan, odom)"),
    ("warn", "/planner_node", "Replanning: path blocked, retrying with inflated costmap"),
    ("info", "/lifecycle_manager", "All managed nodes reported active"),
    ("error", "/planner_node", "Goal rejected: no valid trajectory within tolerance"),
    ("info", "/sensor_hub", "Calibration parameters loaded from config"),
    ("warn", "/control_node", "Command latency 142ms exceeds 100ms budget"),
]


def _log_event(now, idx):
    level, name, msg = _SAMPLE_LOGS[idx % len(_SAMPLE_LOGS)]
    return {
        "type": "log_event",
        "timestamp": now,
        "data": {
            "level": level,
            "name": name,
            "msg": msg,
            "file": "sim.py",
            "function": "sim_loop",
            "line": 1,
        },
    }


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
