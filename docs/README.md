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

### 2. Dual-mode Execution (ROS 2 & Simulation)
To ease development on Windows and deployment on a Linux Raspberry Pi, the backend bridge features an **automatic fallback simulation mode**:
- If `rclpy` is found, it queries the actual active ROS 2 graph and subscribes dynamically to active topics.
- If `rclpy` is missing, it starts a simulation loop generating simulated telemetry (sensor streams, motor commands, active action instances) so that the visualizer is immediately interactive on any machine.

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

Ubuntu 24.04 and recent WSL images block `pip install` into system Python by default (`externally-managed-environment`, PEP 668). This repo uses a local virtual environment that keeps ROS 2 system packages visible:

```bash
./scripts/setup_python_env.sh
```

To verify the visualizer end to end on ROS 2 Jazzy, use the bundled demo workspace:

```bash
./scripts/build_demo.sh
```

Terminal 1:
```bash
./scripts/run_visualizer.sh
```

Terminal 2:
```bash
./scripts/run_demo.sh
```

Then open:

```text
http://localhost:7260
```

The demo publishes topics, exposes a service, and runs a Fibonacci action so the visualizer has a real graph to render.

---

## How-To-Run Guide

### Option A: Local Simulation Mode (Windows / macOS / Linux without ROS 2)
Use this option to test the interactive 3D frontend and verify the layout engine without any active ROS 2 system.

1. Create the local Python environment:
   ```bash
   ./scripts/setup_python_env.sh
   ```
2. Navigate to the project root directory and run the bridge script:
   ```bash
   ./scripts/run_visualizer.sh --sim
   ```
   *Note: If `rclpy` is not installed, the bridge script will automatically fall back to simulation mode even without the `--sim` flag.*
3. Open your browser and navigate to:
   ```
   http://localhost:7260
   ```
4. Click the **Toggle Simulation** button in the bottom-left controls overlay to start the local message streams.

---

### Option B: Real ROS 2 Mode (Linux Raspberry Pi / PC with ROS 2 Jazzy or Humble)
Use this option inside a sourced ROS 2 workspace.

1. Create the local Python environment:
   ```bash
   ./scripts/setup_python_env.sh
   ```
2. Source your ROS 2 workspace:
   ```bash
   source /opt/ros/jazzy/setup.bash
   source /path/to/your_ws/install/setup.bash  # optional, needed for custom interfaces
   ```
3. Run the bridge:
   ```bash
   ./scripts/run_visualizer.sh
   ```
4. Run some active ROS 2 nodes in a separate terminal. For a quick check, use the bundled demo:
   ```bash
   ./scripts/build_demo.sh
   ./scripts/run_demo.sh
   ```
5. Open a browser (on the same machine or on a computer on the same network) and go to:
   ```
   http://<RASPBERRY_PI_IP>:7260
   ```
   *(Ensure port `7260` and `8765` are open on the Raspberry Pi's firewall).*

If the bridge logs warnings such as `Could not dynamically subscribe ... No module named ...`, the graph is still visible, but payload decoding for those topic types is unavailable until the workspace that defines those interfaces is sourced before starting the bridge.

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
./scripts/run_visualizer_new.sh              # npm install (first run) + vite build + bridge
./scripts/run_visualizer_new.sh --skip-build # fast restart, reuse the existing dist/
./scripts/run_visualizer_new.sh --sim        # extra args are forwarded to the bridge
```

Then open `http://localhost:7260` as usual.

### Run modes (bridge flags)

The bridge makes it explicit what data each view is showing. The TopBar in the app
shows the same as `INSP` (3D introspection) and `BT` (behavior tree) chips, and the
bridge prints a RUN MODE banner on startup.

| Flag | Meaning |
|---|---|
| _(none)_ | **REAL** — live ROS 2 graph; **auto-probes `localhost:1667`** for a Groot2 BT executor |
| `--sim` | **NO ROS** — never use rclpy; the introspection view runs on demo data |
| `--insp` | Introspection **DEMO** — simulated ROS graph even when ROS is present |
| `--bt` | Behavior Tree **DEMO** — run the demo trees (HydrogenDispenser + PackCharger) |
| `--btros HOST:PORT` | Behavior Tree **REAL** — explicit Groot2 v4 endpoint (overrides the 1667 auto-probe; needs `pyzmq`) |

By default the bridge auto-probes the standard Groot2 port (`1667`), so a locally
running executor (e.g. [bt_demo/](../bt_demo/)) is picked up with **no flags**; use
`--btros` only for a non-default host/port. The three sources are orthogonal, e.g.:

```bash
./scripts/run_visualizer_new.sh --sim --bt     # no ROS; both views on controlled demos
./scripts/run_visualizer_new.sh --bt           # real ROS graph + demo behavior tree
python3 backend/bridge.py                       # real ROS graph + auto-probe BT on 1667
python3 backend/bridge.py --btros host:1667     # explicit Groot2 endpoint (see bt_demo/)
```

There is also an in-app **Sim** toggle on the Behavior Tree page (bottom-left
controls) that runs a fake tree entirely in the browser — handy for UI work and
settings tuning with no bridge at all, mirroring the ROS Introspection sim toggle.

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
