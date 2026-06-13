# ROS 2 3D Network Visualizer — Build Walkthrough

A record of what was built, how the architecture evolved, and how each layer fits together.

---

## What Was Built

A browser-based, real-time 3D visualizer for any ROS 2 system. A Python WebSocket
bridge sits alongside your ROS 2 graph, streams live topology and telemetry to the
browser, and serves the frontend itself — one command to run, no browser plugin or
ROS tooling required on the client machine.

Two frontends share the same bridge and the same WebSocket protocol:

| Frontend | Stack | Entry point |
|---|---|---|
| `frontend/` | Vanilla JS + Three.js | `./scripts/run_visualizer.sh` |
| `frontend_new/` | React 18 + TypeScript + Vite + Tailwind | `./scripts/run_visualizer_new.sh` |

---

## Backend: `backend/ros_monitor_bridge/`

The bridge is a Python package, not a single script. Key modules:

| File | Role |
|---|---|
| `main.py` | Entry point — parses args, wires bridge + runtime + server |
| `server.py` | `asyncio` WebSocket server + HTTP static file server (port `7260`) |
| `runtime.py` | Event dispatcher — bridge pushes events here; server pulls them |
| `ros_bridge.py` | `rclpy` node: graph polling, dynamic topic subscriptions, Hz tracking, lifecycle monitoring, service introspection auto-detection |
| `simulation.py` | Fallback simulation loop — runs when `rclpy` is absent or `--sim` is passed |
| `config.py` | Tuneable constants (rate limits, heavy-type blocklist, graph poll interval) |
| `pid_scanner.py` | Maps `/proc` PIDs to node names for lifecycle node detection |

### Threading model

```
Main thread          asyncio event loop
                       └─ WebSocket server  (port 8765, internal)
                       └─ HTTP static server (port 7260)
                       └─ broadcast loop  ← pulls from runtime queue

ROS thread           threading.Thread
                       └─ rclpy MultiThreadedExecutor
                       └─ ros_bridge callbacks → runtime.dispatch_event()

Sim thread           threading.Thread (sim mode only)
                       └─ SimulatedBridge.sim_loop() → runtime.dispatch_event()
```

Thread-safe: the ROS/sim thread pushes events via `dispatch_event()`; the async
loop consumes them from a `asyncio.Queue` using `loop.call_soon_threadsafe()`.

---

## WebSocket Event Contract

All events are JSON with the shape `{ type, timestamp, data }`.

### `graph_update`
Full topology snapshot, sent every ~4 s and on change.
```json
{
  "type": "graph_update",
  "timestamp": 1686000000.0,
  "data": {
    "nodes":    [{ "name": "/talker", "namespace": "/" }],
    "topics":   [{ "name": "/chatter", "types": ["std_msgs/msg/String"],
                   "publishers": ["/talker"], "subscribers": ["/listener"] }],
    "services": [{ "name": "/add_two_ints", "types": ["example_interfaces/srv/AddTwoInts"],
                   "servers": ["/math_service"] }],
    "actions":  [{ "name": "/fibonacci", "type": "example_interfaces/action/Fibonacci",
                   "servers": ["/fibonacci_action_server"], "clients": ["/fibonacci_action_client"] }]
  }
}
```

### `message_event`
Live topic message (or dropped-payload envelope for heavy types).
```json
{
  "type": "message_event",
  "timestamp": 1686000000.0,
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
Managed node state transition.
```json
{
  "type": "lifecycle_event",
  "timestamp": 1686000000.0,
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
  "timestamp": 1686000000.0,
  "data": { "updates": { "/pose": 4.97, "/cmd_vel": 2.01 } }
}
```

### `node_params_event`
Parameter snapshot emitted when a lifecycle node reaches `active`.
```json
{
  "type": "node_params_event",
  "timestamp": 1686000000.0,
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
  "timestamp": 1686000000.0,
  "data": { "service_name": "/add_two_ints" }
}
```

---

## Demo Workspace: `ros2_demo_ws/`

A minimal ROS 2 package (`monitor_demo`) that gives the bridge a real graph to
visualize. Nodes and what they demonstrate:

| Node | Demonstrates |
|---|---|
| `sensor_hub` | Multi-topic publisher (image, scan, pose) |
| `control_node` | Subscriber + cmd_vel publisher |
| `math_service` | Service with introspection (`CONTENTS`) |
| `math_client` | Service client with introspection (`CONTENTS`) |
| `fibonacci_action_server` | Action server with introspection parameter (default `contents`) |
| `fibonacci_action_client` | Action client with introspection parameter (default `contents`) |

Build and run:
```bash
./scripts/build_demo.sh
./scripts/run_demo.sh
```

---

## Key Design Decisions

**Decoupled topology model** — topics appear as their own sphere nodes in 3D space.
Edges are `Publisher → Topic → Subscriber`, matching the ROS 2 graph API exactly.

**Action cluster grouping** — the five `/_action/` sub-interfaces (goal, feedback,
result, status, cancel) are collapsed into a single purple icosahedron node, keeping
the scene readable.

**Heavy-type blocking** — `sensor_msgs/Image`, `PointCloud2`, and `LaserScan` are
excluded from dynamic subscription but still appear in the topology graph.

**Rate limiting + payload trimming** — all other subscriptions are capped at 10 Hz;
large array payloads are pruned to a metadata envelope before forwarding.

**Service introspection auto-detection** — the bridge subscribes to any topic
matching `*/_service_event` automatically. No config required; opt-in happens in
the node code.

**Action introspection via parameters** — nodes declare
`action_server_configure_introspection` / `action_client_configure_introspection`
with a default of `contents`. Override per-node at launch or at runtime via
`ros2 param set`.
