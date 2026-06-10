// --- Local Frontend Sandbox Simulation Mode (Fallback when backend offline) ---

import { state, logger } from './state.js';
import { handleGraphUpdate, handleMessageEvent, clearGraph } from './graph.js';
import { initWebSocket } from './websocket.js';

export function startLocalSimulation() {
    logger("Activating local simulation sandbox.");
    // Clear graph before simulating
    clearGraph();

    // Construct fake graph update
    const mockData = {
        nodes: [
            { name: "/telemetry_collector", namespace: "/" },
            { name: "/kinematics_engine", namespace: "/" },
            { name: "/trajectory_planner", namespace: "/" },
            { name: "/hardware_interface", namespace: "/" },
            { name: "/ros_websocket_bridge", namespace: "/" }
        ],
        topics: [
            {
                name: "/sensor_telemetry",
                types: ["geometry_msgs/msg/Point"],
                publishers: ["/telemetry_collector"],
                subscribers: ["/kinematics_engine"]
            },
            {
                name: "/state_estimate",
                types: ["nav_msgs/msg/Odometry"],
                publishers: ["/kinematics_engine"],
                subscribers: ["/trajectory_planner"]
            },
            {
                name: "/joint_commands",
                types: ["sensor_msgs/msg/JointState"],
                publishers: ["/trajectory_planner"],
                subscribers: ["/hardware_interface"]
            },
            {
                name: "/system_diagnostics",
                types: ["diagnostic_msgs/msg/DiagnosticArray"],
                publishers: ["/hardware_interface"],
                subscribers: ["/telemetry_collector"]
            }
        ],
        services: [
            {
                name: "/calibrate_sensors",
                types: ["std_srvs/srv/Trigger"],
                servers: ["/telemetry_collector"],
                clients: ["/trajectory_planner"]
            },
            {
                name: "/ros_websocket_bridge/describe_parameters",
                types: ["rcl_interfaces/srv/DescribeParameters"],
                servers: ["/ros_websocket_bridge"]
            },
            {
                name: "/ros_websocket_bridge/list_parameters",
                types: ["rcl_interfaces/srv/ListParameters"],
                servers: ["/ros_websocket_bridge"]
            }
        ],
        actions: [
            {
                name: "/execute_motion",
                type: "control_msgs/action/FollowJointTrajectory",
                servers: ["/hardware_interface"],
                clients: ["/trajectory_planner"]
            },
            {
                name: "/run_self_test",
                type: "diagnostic_msgs/action/SelfTest",
                servers: ["/kinematics_engine"],
                clients: ["/telemetry_collector"]
            }
        ]
    };

    handleGraphUpdate(mockData);

    // Message event simulator
    let t = 0;
    state.localSimInterval = setInterval(() => {
        t += 0.5;

        // Spawn particles
        const now = Date.now() / 1000.0;

        // Telemetry events
        handleMessageEvent({
            topic: "/sensor_telemetry",
            msg_type: "geometry_msgs/msg/Point",
            timestamp: now,
            payload: { x: Math.sin(t).toFixed(3), y: Math.cos(t).toFixed(3), z: 0.0 },
            dropped_payload: false,
            size_bytes: 24
        });

        if (Math.floor(t) % 2 === 0) {
            handleMessageEvent({
                topic: "/state_estimate",
                msg_type: "nav_msgs/msg/Odometry",
                timestamp: now,
                payload: {
                    pose: {
                        position: { x: (t * 0.1).toFixed(2), y: 0.0, z: 0.0 },
                        orientation: { x: 0, y: 0, z: 0, w: 1 }
                    }
                },
                dropped_payload: false,
                size_bytes: 48
            });
        }

        if (Math.floor(t) % 3 === 0) {
            handleMessageEvent({
                topic: "/joint_commands",
                msg_type: "sensor_msgs/msg/JointState",
                timestamp: now,
                payload: null,
                dropped_payload: true, // test drop payload warning
                size_bytes: 2048
            });
        }

        if (Math.floor(t) % 4 === 0) {
            handleMessageEvent({
                topic: "/system_diagnostics",
                msg_type: "diagnostic_msgs/msg/DiagnosticArray",
                timestamp: now,
                payload: { status: "OK", level: 0 },
                dropped_payload: false,
                size_bytes: 96
            });
        }
    }, 1000);
}

export function stopLocalSimulation() {
    logger("Stopping local simulation sandbox.");
    if (state.localSimInterval) {
        clearInterval(state.localSimInterval);
        state.localSimInterval = null;
    }
    clearGraph();
    // Try reconnecting to backend
    initWebSocket();
}
