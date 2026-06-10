# 3D ROS 2 Network Visualizer - Implementation Plan

This project implements a 3D ROS 2 Network Visualizer in the browser. It connects to a running ROS 2 system via a Python WebSocket bridge. It allows real-time monitoring of nodes, topics, services, actions, and message flow.

---

## Architectural Approach

### 1. Hybrid Serving Model
The Python backend will act as both:
- **HTTP Server**: Serves the frontend static files (HTML, CSS, JS) from a `frontend/` directory using Python's built-in `http.server` (running on a background thread).
- **WebSocket Server**: Provides a real-time, bi-directional telemetry connection using the `websockets` library (running in an `asyncio` event loop).
- **ROS 2 Node**: Integrates with `rclpy` to query the ROS 2 graph and dynamically subscribe to active topics to stream live messages.

This single-command execution model makes it extremely easy to run and self-contained.

### 2. Threading Architecture
To prevent event loop blocks and thread safety issues:
- **Main Thread**: Runs the `asyncio` event loop, managing the WebSocket server connections and broadcasting telemetry events.
- **ROS Thread**: A separate Python thread initialized via `threading.Thread`. It initializes `rclpy`, instantiates our bridge node, and spins using a `MultiThreadedExecutor`.
- **Communication Bridge**: Thread-safe communication from the ROS Thread to the Main Thread is achieved using `asyncio.run_coroutine_threadsafe()` to dispatch websocket broadcasts, or via an `asyncio.Queue` polled by the server.

### 3. Topological Edge Modeling
Instead of rendering direct node-to-node lines, the visualizer models the actual ROS 2 publisher-subscriber data path:
- Nodes and Topics are BOTH represented as 3D elements in the space.
- Nodes are rendered as floating cylindrical hubs (blue/teal).
- Topics are rendered as floating spherical nodes (orange).
- Edges are directed links:
  - `Publisher Node -> Topic Node`
  - `Topic Node -> Subscriber Node`
- This accurately represents the decoupled nature of ROS 2 communication and matches what the graph API reports.

### 4. Action Cluster Grouping
At runtime, ROS 2 actions appear as a bundle of related topics and services:
- Topics: `<action_name>/_action/feedback`, `<action_name>/_action/status`
- Services: `<action_name>/_action/send_goal`, `<action_name>/_action/get_result`, `<action_name>/_action/cancel_goal`
The bridge will detect naming patterns containing `/_action/`. It will group these interfaces into a single Action Cluster (a specialized purple visual node) connected to the action server and action client nodes, preventing graph clutter.

### 5. Dynamic Message Deserialization & Payload Trimming
- We use `rosidl_runtime_py.utilities.get_message` to dynamically import message classes at runtime.
- If a message package is missing or fails to import, the bridge catches the exception and falls back to a generic tracking subscription (if possible) or gracefully skips the topic.
- To prevent UI crashes, the bridge:
  - Filters out heavy binary-heavy messages (e.g., `sensor_msgs/msg/Image`, `sensor_msgs/msg/PointCloud2`, `sensor_msgs/msg/LaserScan`) from subscription.
  - Implements a per-topic rate limiter (throttling to max 10Hz per topic).
  - Trims payload values if they exceed a size threshold, converting them to a lightweight metadata envelope.

---

## WebSocket Event Contract

The bridge sends JSON-serialized payloads over the WebSocket. There are two primary event schemas:

### 1. `graph_update`
Sent when a change is detected in the ROS 2 network graph, or periodically (e.g., every 2 seconds).

```json
{
  "type": "graph_update",
  "timestamp": 1686000000.0,
  "data": {
    "nodes": [
      {
        "name": "/talker",
        "namespace": "/"
      },
      {
        "name": "/listener",
        "namespace": "/"
      }
    ],
    "topics": [
      {
        "name": "/chatter",
        "type": "std_msgs/msg/String",
        "publishers": ["/talker"],
        "subscribers": ["/listener"],
        "frequency_hz": 10.0
      }
    ],
    "services": [
      {
        "name": "/add_two_ints",
        "type": "example_interfaces/srv/AddTwoInts",
        "servers": ["/add_two_ints_server"]
      }
    ],
    "actions": [
      {
        "name": "/fibonacci",
        "type": "action_tutorials_interfaces/action/Fibonacci",
        "servers": ["/fibonacci_server"],
        "clients": ["/fibonacci_client"]
      }
    ]
  }
}
```

### 2. `message_event`
Sent in real-time when a message is captured on a subscribed topic.

```json
{
  "type": "message_event",
  "timestamp": 1686000000.0,
  "data": {
    "topic": "/chatter",
    "msg_type": "std_msgs/msg/String",
    "payload": {
      "data": "Hello, ROS 2!"
    },
    "dropped_payload": false,
    "size_bytes": 14
  }
}
```

If the payload is trimmed (e.g., for heavy binary messages or rate-limited envelopes):
```json
{
  "type": "message_event",
  "timestamp": 1686000000.0,
  "data": {
    "topic": "/camera/image_raw",
    "msg_type": "sensor_msgs/msg/Image",
    "payload": null,
    "dropped_payload": true,
    "size_bytes": 921600
  }
}
```

---

## Proposed Directory Structure

```
ros2_visualizer/
├── backend/
│   └── bridge.py        # Python HTTP/WebSocket bridge & ROS 2 Node
├── frontend/
│   ├── index.html       # UI Layout and HUD overlay
│   ├── style.css        # Premium dark glassmorphism styles
│   └── app.js           # Three.js 3D graph and particle logic
└── README.md            # Detailed How-To-Run Guide
```

---

## Verification Plan

### Automated/Simulation Verification
1. Run the Python bridge on Windows:
   ```bash
   python backend/bridge.py --sim
   ```
2. Open `http://localhost:8080` in Chrome/Edge.
3. Verify:
   - The 3D scene renders nodes (cylinders), topics (spheres), services, and actions.
   - Directed edges connect: `Publisher Node -> Topic Node -> Subscriber Node`.
   - Message glyphs flow from publisher to topic node, and topic node to subscriber node.
   - Clicking a particle pauses it and opens the HTML inspector panel.

### ROS 2 Verification
1. Copy the files to the Linux Raspberry Pi (running ROS 2 Jazzy/Humble).
2. Start the bridge:
   ```bash
   source /opt/ros/jazzy/setup.bash
   python3 backend/bridge.py
   ```
3. Run some demo ROS 2 nodes (e.g., `ros2 run demo_nodes_py talker` and `listener`).
4. Verify the nodes and `/chatter` topic appear in the 3D scene and messages flow in real-time.
