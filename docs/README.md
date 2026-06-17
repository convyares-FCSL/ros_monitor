# ROS 2 3D Network Visualizer (3D.Pulse)

A functional "first-gen" prototype of a browser-based **3D ROS 2 Network Visualizer** designed to monitor a running ROS 2 system. It features a Python WebSocket bridge that queries the ROS 2 graph dynamically and handles dynamic subscriptions with rate limiting and payload trimming. The frontend renders a premium glassmorphic HUD alongside a WebGL-based 3D scene using Three.js, animating telemetry message particles along real-time connection paths.

Two frontends share the same bridge (see **Frontends** below):

| Directory | Stack | Run with |
|---|---|---|
| `frontend/` | Vanilla JS + Three.js (reference implementation) | `./scripts/run_visualizer.sh` |
| `frontend_new/` | React + TypeScript + Vite + Tailwind | `./scripts/run_visualizer_new.sh` |

---

## Architectural Approach

### 1. Hybrid serving model
The Python backend serves static files (HTML, CSS, JS) from a `frontend/` directory using Python's built-in `http.server` running in a background thread, while simultaneously exposing a real-time, bi-directional WebSocket connection via `websockets` in the main `asyncio` event loop. This makes the tool self-contained and runnable with a single command.

### 2. Canonical Run Modes
The visualizer now uses a single top-level run mode contract:
- `full` connects to the live ROS 2 graph and auto-probes for a live Groot2 publisher.
- `demo` starts the bundled local demos and uses real local protocols.
- `sim` stays fully offline and serves simulated ROS + BT data from the backend itself.

### 3. Threading Architecture
To prevent ROS 2 callback execution from blocking the WebSocket event loop:
- The WebSocket server runs in the main thread inside an `asyncio` event loop.
- The `rclpy` node and executor run in a dedicated background thread (`threading.Thread`) using `MultiThreadedExecutor`.
- Thread-safe queues and events route message traffic from the ROS node to the WebSocket broadcaster loop.

### 4. Graph Modeling & Action Clustering
- **Decoupled Nodes & Topics**: Rather than rendering direct node-to-node links, the scene displays the topological truth of ROS 2: `Publisher Node -> Topic Node -> Subscriber Node`. Both nodes and topics are distinct 3D visual hubs in space.
- **Action Cluster Grouping**: ROS 2 actions (which are actually a bundle of topics and services like `/goal`, `/feedback`, `/result`, `/status`, and `/cancel` under the `/_action/` suffix) are grouped dynamically. They are represented by a single Action node in the 3D layout, preventing visual clutter.

### 5. Telemetry Throttling & Payload Trimming
- High-bandwidth, binary-heavy topic types (like camera images, point clouds, laserscans) are skipped from dynamic subscription, but are kept in the visual graph topology. 
- A per-topic rate limiter throttles other streams to a maximum frequency (default 10Hz).
- Heavy messages with large arrays/byte blocks are automatically pruned by a recursive Python payload trimmer, preserving metadata envelopes (`size_bytes`, `topic`, `type`, `dropped_payload`).

---

## System Requirements

- **Python**: 3.8 or newer
- **Python Libraries**: `websockets` (installed via the repo-local `.venv`)
- **ROS 2**: Humble or Jazzy (validated on Jazzy)
- **Node.js + npm**: only required for the React frontend (`frontend_new/`); the
  vanilla `frontend/` has no build step

---

## WSL / Ubuntu Quick Start

Ubuntu 24.04 and recent WSL images block `pip install` into system Python by default (`externally-managed-environment`, PEP 668). This repo uses a local virtual environment that keeps ROS 2 system packages visible.

Start the visualizer in bundled local demo mode:

```bash
./scripts/run_visualizer_new.sh --mode demo
```

Then open:

```text
http://localhost:7260
```

The launcher builds the React frontend, ensures the local Python environment exists, starts the bundled ROS demo, starts the bundled BT demo, and runs the bridge against them.

## Visualizer run modes

The visualizer uses a single primary run-mode argument:

```bash
./scripts/run_visualizer_new.sh --mode sim
./scripts/run_visualizer_new.sh --mode demo
./scripts/run_visualizer_new.sh --mode full
```

If no mode is supplied, `full` is used.

### Mode summary

| Mode | Description | External processes |
|---|---|---|
| `sim` | Pure local backend simulation. No ROS graph or external BT publisher is required. | None |
| `demo` | Uses bundled local demo processes and real protocols. By default this includes the ROS demo and BT demo. | Demo ROS / BT processes |
| `full` | Connects to the real ROS 2 graph and real BT executor. | Real system processes |

### Commands

```bash
# Full system, default
./scripts/run_visualizer_new.sh
./scripts/run_visualizer_new.sh --mode full

# Full system with explicit BT endpoint
./scripts/run_visualizer_new.sh --mode full --btros localhost:1667

# Pure local simulation
./scripts/run_visualizer_new.sh --mode sim

# Full bundled demo: ROS demo + BT demo
./scripts/run_visualizer_new.sh --mode demo

# ROS demo only
./scripts/run_visualizer_new.sh --mode demo --no-bt

# BT demo only
./scripts/run_visualizer_new.sh --mode demo --no-ros-demo
```

### Optional switches

| Option | Meaning |
|---|---|
| `--btros host:port` | Connect to a specific BT/Groot2 publisher endpoint. In `full` mode this overrides the default localhost auto-probe. |
| `--no-bt` | Disable behavior tree integration. Useful for ROS-only demo or ROS-only full mode. |
| `--no-ros-demo` | In `demo` mode, do not start the bundled ROS demo. Useful for BT-only demo runs. |
| `--skip-build` | Reuse existing frontend build output for faster restarts. |

### Behavior by mode

#### `--mode sim`

- Pure local backend simulation
- No ROS 2 runtime required
- No external ROS demo nodes
- No external BT/Groot2 publisher
- Simulated inspection data from the backend
- Simulated BT data from the backend unless `--no-bt` is passed

#### `--mode demo`

- Bundled local demo mode using real local protocols
- Starts `run_demo.sh` by default
- Starts the bundled `bt_demo` publisher by default
- `--no-bt` keeps only the ROS demo side
- `--no-ros-demo` keeps only the BT demo side

#### `--mode full`

- Live system mode
- Introspects the real ROS 2 graph
- Auto-probes `localhost:1667` for a BT/Groot2 publisher unless `--no-bt` is passed
- Supports an explicit BT endpoint with `--btros host:port`

### Backwards compatibility

Legacy flags are still accepted temporarily:

| Legacy flag | New equivalent |
|---|---|
| `--sim` | `--mode sim` |
| `--bt` | Deprecated and ambiguous. Prefer `--mode sim` for internal simulated BT or `--mode demo` for the bundled local BT demo. |
| no flags | `--mode full` |

The launcher and bridge print deprecation warnings when the legacy flags are used.

---

## Enabling Groot2Publisher in your C++ node

The visualizer connects to the **Groot2Publisher** built into BehaviorTree.CPP v4. To expose your tree, add the publisher to your ROS 2 node.

### 1. Build requirement

Your workspace must have BehaviorTree.CPP built with the Groot2 interface enabled:

```bash
colcon build --cmake-args -DBTCPP_GROOT_INTERFACE=ON
```

### 2. Header and member

```cpp
#include <behaviortree_cpp/loggers/groot2_publisher.h>

// In your node class:
std::unique_ptr<BT::Groot2Publisher> groot_publisher_;
```

### 3. Start the publisher after the tree is created

```cpp
// Declare the parameter (e.g. in your constructor or on_configure):
declare_parameter("groot_port", 1667);

// One Groot2 publisher for the whole tree
const int port = static_cast<int>(get_parameter("groot_port").as_int());
if (port > 0) {
  try {
    groot_publisher_ = std::make_unique<BT::Groot2Publisher>(tree_, static_cast<unsigned>(port));
    RCLCPP_INFO(get_logger(), "Groot2 publisher listening on port %d", port);
  } catch (const std::exception & e) {
    RCLCPP_WARN(get_logger(), "Groot2 publisher disabled: %s", e.what());
    groot_publisher_.reset();
  }
}
```

The publisher binds a ZeroMQ REP socket on the given port. The visualizer connects to it automatically in `full` mode (default probe: `localhost:1667`) or via `--btros host:port`.

### 4. Port conventions

Each executor should use a distinct port to avoid conflicts. The bridge uses this default mapping:

| Executor | Default port |
|---|---|
| lifecycle | 1667 |
| system | 1669 |
| orchestrator | 1671 |
| compressor | 1673 |
| low_booster | 1675 |
| high_booster | 1677 |
| gas_manager | 1679 |
| dispenser | 1681 |

Override at launch time:

```bash
ros2 run my_pkg my_node --ros-args -p groot_port:=1669
```

### 5. Connect the visualizer

```bash
# Auto-probe localhost:1667
./scripts/run_visualizer_new.sh --mode full

# Explicit port
./scripts/run_visualizer_new.sh --mode full --btros localhost:1669

# Disable BT entirely (ROS graph only)
./scripts/run_visualizer_new.sh --mode full --no-bt
```

---

## Frontends

Both frontends speak the same WebSocket protocol (port `8765`) and are served by
the same bridge on port `7260`. They can be swapped without touching the backend.

### `frontend/` — vanilla JS (reference implementation)

The original frontend: plain ES modules, no build step, vendored Three.js bundles
(`Line2`, `Postprocessing`). This is where features land first — service docking,
dead-end filtering, Hz arteries, lifecycle states, etc. Served directly from the
directory by `./scripts/run_visualizer.sh`. Edit a file, refresh the browser.

### `frontend_new/` — React + TypeScript (generated with bolt.new)

A React 18 + TypeScript + Vite + Tailwind rebuild implementing the same WebSocket
protocol as the vanilla frontend. It must be **built** before the bridge can serve
it.

**Run it (build + serve, one command):**

```bash
./scripts/run_visualizer_new.sh              # default: --mode full
./scripts/run_visualizer_new.sh --mode sim
./scripts/run_visualizer_new.sh --mode demo
./scripts/run_visualizer_new.sh --skip-build
```

Then open `http://localhost:7260` as usual.

The app TopBar shows `MODE`, `INSP`, and `BT` chips to match the bridge's startup RUN MODE banner. The React app uses a single shared WebSocket connection, and runtime behavior is selected through the launcher run modes rather than page-local browser simulation toggles.

**Develop it (hot reload):**

```bash
# Terminal 1 — bridge only (either run script works; the frontend it serves is irrelevant)
./scripts/run_visualizer.sh

# Terminal 2 — Vite dev server with hot module reload
cd frontend_new
npm run dev          # opens on http://localhost:5173, connects to ws://localhost:8765
```

The app derives the bridge address from the page's hostname, so the dev server on
`:5173` still reaches the bridge on `:8765` automatically.

**Other commands** (from `frontend_new/`):

```bash
npm run build        # production build → frontend_new/dist/
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
```

### Serving any frontend build: `ROS_MONITOR_FRONTEND_DIR`

The bridge serves `frontend/` by default. The `ROS_MONITOR_FRONTEND_DIR`
environment variable overrides that — this is how `run_visualizer_new.sh` points
it at the React build:

```bash
ROS_MONITOR_FRONTEND_DIR=/path/to/any/static/dir ./scripts/run_visualizer.sh
```

---

## Monitoring a custom workspace

The bridge must be started from a shell that has both ROS 2 **and** your project
workspace sourced — otherwise custom interface types cannot be decoded and those
subscriptions are skipped with a warning.

Generic pattern:

```bash
source /opt/ros/jazzy/setup.bash
source /path/to/your_ws/install/setup.bash
./scripts/run_visualizer.sh
```

**Example — mServe stack** (`interfaces/srv/Drive` and related types):

```bash
source /opt/ros/jazzy/setup.bash
source /home/ecm/ai-workspace/projects/mServe-STACK/ws/install/setup.bash
./scripts/run_visualizer.sh
```

If the mServe workspace has not been built yet:

```bash
cd /home/ecm/ai-workspace/projects/mServe-STACK/ws
colcon build --packages-select interfaces utils mserve_drivechain mserve_base
```

---

## Service & action call visibility (introspection)

Topics can be observed by simply subscribing. **Service and action calls are
different** — they are point-to-point exchanges invisible to passive subscribers.
ROS 2 **introspection** (Iron+) mirrors these onto regular topics that the bridge
auto-detects and subscribes to.

Both services and actions share the same three configuration states:

| State | What is published |
|---|---|
| `disabled` | Nothing (default) |
| `metadata` | Communication metadata only — timestamps, client/server IDs, sequence numbers — no payloads |
| `contents` | Metadata **plus** full request/response or goal/result/cancel payloads |

**This is opt-in per server, in the node's code.** No introspection → topology is
still shown, but live calls are invisible. Enabling it on the **server side alone is
enough** — the server emits events regardless of who calls it.

### Services

Each request/response is mirrored onto `<service>/_service_event`.

**rclpy:**

```python
from rclpy.qos import qos_profile_system_default
from rclpy.service_introspection import ServiceIntrospectionState

srv = self.create_service(AddTwoInts, '/my/service', self.handle)
srv.configure_introspection(
    self.get_clock(), qos_profile_system_default,
    ServiceIntrospectionState.CONTENTS)  # or METADATA
```

**rclcpp:**

```cpp
#include <rcl/service_introspection.h>

service_ = create_service<Trigger>("/my/service", cb);
service_->configure_introspection(
    get_clock(), rclcpp::SystemDefaultsQoS(), RCL_SERVICE_INTROSPECTION_CONTENTS);
```

Already enabled: the demo `math_service`/`math_client` nodes, and all four
`mserve_drivechain` services (`/connect`, `/stop`, `/drive`, `/set_motor_id`).

```bash
ros2 topic list | grep _service_event
```

### Actions

Action calls are a bundle of topics and services (goal, feedback, result, status,
cancel) under `/_action/`. The feedback topic is passively visible; the goal and
result exchanges are not — introspection surfaces them via node parameters.

**At node startup:**

```bash
ros2 run my_package my_action_server --ros-args -p action_server_configure_introspection:=contents
```

**At runtime:**

```bash
ros2 param set /my_action_client_node action_client_configure_introspection contents
```

**In node code (rclpy)** — declare with a default so introspection is on without
launch arguments:

```python
self.declare_parameter("action_server_configure_introspection", "contents")  # server
self.declare_parameter("action_client_configure_introspection", "contents")  # client
```

Already enabled: the demo `fibonacci_action_server`/`fibonacci_action_client` nodes
(both default to `contents`).

```bash
ros2 topic list | grep _action
```

---

## Visual UX Reference

- **Blue/Teal Cylinders**: ROS 2 Nodes.
- **Orange Spheres**: Active Topics (line thickness tracks publish rate).
- **Green Octahedra**: Services. Orphan services (no client) sit as dim ports on a
  ring orbiting their host node; connected services sit mid-edge on a green
  client→server arc, flare on each call, and send a pulse along the edge.
- **Purple Icosahedrons**: Action Clusters (groups goal, result, feedback, status, and cancel topics/services).
- **Interactive Inspection**: Click on any flying message particle to freeze its movement in mid-air. The right-hand **Packet Inspector** panel slides open to display the decoded JSON payload, type metadata, source/destination timestamps, and payload sizes. Click **Resume Telemetry Stream** or close the inspector to release it.
