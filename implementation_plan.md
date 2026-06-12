# 3D ROS 2 Network Visualizer — Implementation Plan

A browser-based 3D visualizer for any ROS 2 system. A Python WebSocket bridge
streams live graph topology and telemetry to the browser; two frontend
implementations share the same protocol.

---

## Architectural Approach

### 1. Hybrid Serving Model

The Python backend acts as both:
- **HTTP Server**: Serves frontend static files on port `7260` using Python's
  built-in `http.server` in a background thread.
- **WebSocket Server**: Real-time bi-directional telemetry on port `8765` via the
  `websockets` library in an `asyncio` event loop.
- **ROS 2 Node**: Integrates with `rclpy` to poll the ROS 2 graph and dynamically
  subscribe to active topics.

The `ROS_MONITOR_FRONTEND_DIR` environment variable controls which directory is
served on port `7260`, allowing the React build to be swapped in without touching
the bridge.

### 2. Threading Architecture

```
Main thread          asyncio event loop
                       └─ WebSocket server (port 8765)
                       └─ HTTP static server (port 7260)
                       └─ broadcast loop ← runtime.dispatch_event()

ROS thread           threading.Thread
                       └─ rclpy MultiThreadedExecutor
                       └─ ros_bridge callbacks → runtime.dispatch_event()

Sim thread           threading.Thread (when --sim or rclpy absent)
                       └─ SimulatedBridge.sim_loop() → runtime.dispatch_event()
```

The ROS/sim thread pushes events via `dispatch_event()`; the async loop consumes
them using `loop.call_soon_threadsafe()`.

### 3. Dual-Mode Execution

- **ROS 2 mode**: `rclpy` found → bridge queries the live graph, subscribes
  dynamically to topics, tracks Hz, monitors lifecycle state transitions.
- **Simulation mode**: `rclpy` absent or `--sim` flag → `SimulatedBridge` generates
  a mock graph (6 nodes, 4 topics, 1 service, 1 action) with realistic telemetry.

### 4. Topological Edge Modeling

Topics are rendered as their own sphere nodes in 3D space. Edges are directed:

```
Publisher Node  →  Topic Node  →  Subscriber Node
```

This matches the ROS 2 graph API exactly and decouples publishers from subscribers.

### 5. Action Cluster Grouping

The five `/_action/` sub-interfaces (goal, feedback, result, status, cancel) are
detected by naming convention and collapsed into a single purple icosahedron,
keeping the 3D scene readable.

### 6. Dynamic Message Deserialization & Payload Trimming

- `rosidl_runtime_py.utilities.get_message` imports message classes at runtime.
- Heavy binary types (`sensor_msgs/Image`, `PointCloud2`, `LaserScan`) are blocked
  from subscription but kept in the topology graph.
- All other subscriptions are capped at 10 Hz.
- Payloads exceeding a size threshold are pruned to a metadata envelope
  (`size_bytes`, `dropped_payload: true`).

### 7. Service & Action Introspection

- **Services**: The bridge auto-detects any topic matching `*/_service_event` and
  subscribes. Opt-in is per-server in node code via `configure_introspection()`.
- **Actions**: Nodes declare `action_server_configure_introspection` /
  `action_client_configure_introspection` parameters. Default `contents` in the demo
  nodes. Can be overridden at launch or at runtime via `ros2 param set`.

---

## Directory Structure

```
ros_monitor/
├── backend/
│   └── ros_monitor_bridge/
│       ├── main.py           # Entry point, arg parsing
│       ├── server.py         # asyncio WebSocket + HTTP server
│       ├── runtime.py        # Event dispatcher (thread-safe queue)
│       ├── ros_bridge.py     # rclpy node: graph, topics, Hz, lifecycle
│       ├── simulation.py     # Fallback sim loop
│       ├── config.py         # Tuneable constants
│       └── pid_scanner.py    # /proc PID → node name mapping
├── frontend/                 # Vanilla JS + Three.js (reference)
│   ├── index.html
│   └── js/
│       ├── app.js            # Bootstrap
│       ├── graph.js          # Topology + layout + event handlers
│       ├── scene.js          # Three.js mesh factories
│       ├── inspector.js      # Right-panel inspector drawer
│       ├── sidebar.js        # HUD node/topic lists
│       ├── state.js          # Shared state + constants
│       ├── visibility.js     # Show/hide logic
│       ├── interactions.js   # Mouse + raycasting
│       ├── simulation.js     # Local browser sandbox fallback
│       └── websocket.js      # WebSocket client + event routing
├── frontend_new/             # React 18 + TypeScript + Vite + Tailwind
│   └── src/
├── ros2_demo_ws/             # Bundled demo ROS 2 package (monitor_demo)
│   └── src/monitor_demo/
│       └── monitor_demo/
│           ├── sensor_hub.py
│           ├── control_node.py
│           ├── math_service.py          # Service introspection enabled
│           ├── math_client.py           # Service introspection enabled
│           ├── fibonacci_action_server.py  # Action introspection parameter
│           └── fibonacci_action_client.py  # Action introspection parameter
├── scripts/
│   ├── setup_python_env.sh   # Create .venv with ROS 2 packages visible
│   ├── build_demo.sh         # colcon build for ros2_demo_ws
│   ├── run_demo.sh           # Launch monitor_demo nodes
│   ├── run_visualizer.sh     # Start bridge (vanilla frontend)
│   └── run_visualizer_new.sh # Build React frontend + start bridge
└── README.md
```

---

## WebSocket Event Contract

All events: `{ "type": string, "timestamp": float, "data": object }`

### `graph_update`
Full topology snapshot, sent every ~4 s and on change.
```json
{
  "type": "graph_update",
  "data": {
    "nodes":    [{ "name": "/talker", "namespace": "/" }],
    "topics":   [{ "name": "/chatter", "types": ["std_msgs/msg/String"],
                   "publishers": ["/talker"], "subscribers": ["/listener"] }],
    "services": [{ "name": "/add_two_ints", "types": ["example_interfaces/srv/AddTwoInts"],
                   "servers": ["/math_service"] }],
    "actions":  [{ "name": "/fibonacci", "type": "example_interfaces/action/Fibonacci",
                   "servers": ["/fibonacci_action_server"],
                   "clients": ["/fibonacci_action_client"] }]
  }
}
```

### `message_event`
Live topic message (or dropped-payload envelope for heavy/rate-limited types).
```json
{
  "type": "message_event",
  "data": {
    "topic": "/chatter",
    "msg_type": "std_msgs/msg/String",
    "payload": { "data": "Hello, ROS 2!" },
    "dropped_payload": false,
    "size_bytes": 14
  }
}
```

### `lifecycle_event`
Managed node state transition (`unconfigured` → `inactive` → `active` / `error_processing`).
```json
{
  "type": "lifecycle_event",
  "data": {
    "node_name": "/camera_driver",
    "start_state": "inactive",
    "goal_state": "active"
  }
}
```

### `frequency_update`
Rolling Hz per topic, emitted every 1 s.
```json
{
  "type": "frequency_update",
  "data": { "updates": { "/pose": 4.97, "/cmd_vel": 2.01 } }
}
```

### `node_params_event`
Parameter snapshot emitted when a lifecycle node reaches `active`.
```json
{
  "type": "node_params_event",
  "data": {
    "node_name": "/camera_driver",
    "params": { "image_width": 1280, "fps": 30.0 }
  }
}
```

### `service_invoked`
Fired when a `_service_event` message is received on an introspected service.
```json
{
  "type": "service_invoked",
  "data": { "service_name": "/add_two_ints" }
}
```

---

## Verification

### Simulation (no ROS 2 required)
```bash
./scripts/setup_python_env.sh
./scripts/run_visualizer.sh --sim
# open http://localhost:7260
```

Verify: nodes, topics, services, actions render; particles flow; clicking a particle
opens the inspector drawer; lifecycle nodes cycle through states; Hz badges update.

### Real ROS 2 (Jazzy / Humble)
```bash
source /opt/ros/jazzy/setup.bash
./scripts/build_demo.sh
# Terminal 1:
./scripts/run_visualizer.sh
# Terminal 2:
./scripts/run_demo.sh
# open http://localhost:7260
```

Verify: live graph appears; `/monitor_demo/add_two_ints/_service_event` pulses the
service node on each call; action cluster appears and goal/feedback/result events
are visible when introspection is active.
