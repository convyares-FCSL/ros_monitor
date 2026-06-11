# ROS 2 3D Network Visualizer (3D.Pulse)

A functional "first-gen" prototype of a browser-based **3D ROS 2 Network Visualizer** designed to monitor a running ROS 2 system. It features a Python WebSocket bridge that queries the ROS 2 graph dynamically and handles dynamic subscriptions with rate limiting and payload trimming. The frontend renders a premium glassmorphic HUD alongside a WebGL-based 3D scene using Three.js, animating telemetry message particles along real-time connection paths.

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

## Monitoring the mServe stack

The bridge must be started from a shell that has both ROS 2 **and** the mServe
workspace sourced — otherwise custom interface types (e.g. `interfaces/srv/Drive`)
cannot be decoded and those subscriptions are skipped:

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

## Service call visibility (introspection)

Topics can be observed by simply subscribing, but **service calls are point-to-point
request/reply** — they cannot be sniffed passively. The visualizer relies on ROS 2
**service introspection** (Iron+): when a server (or client) opts in, every
request/response is mirrored onto a regular `<service>/_service_event` topic, which
the bridge auto-detects and subscribes to.

**This is opt-in per service, in the node's code.** No introspection → service
topology is still shown (servers/clients/types), but live calls are invisible.
Enabling it on the **server side alone is enough** — the server emits a
`REQUEST_RECEIVED` event no matter who calls (another node, rosbridge, or
`ros2 service call`).

rclpy:

```python
from rclpy.qos import qos_profile_system_default
from rclpy.service_introspection import ServiceIntrospectionState

srv = self.create_service(AddTwoInts, '/my/service', self.handle)
srv.configure_introspection(
    self.get_clock(), qos_profile_system_default,
    ServiceIntrospectionState.CONTENTS)  # METADATA = events without payloads
```

rclcpp:

```cpp
#include <rcl/service_introspection.h>

service_ = create_service<Trigger>("/my/service", cb);
service_->configure_introspection(
    get_clock(), rclcpp::SystemDefaultsQoS(), RCL_SERVICE_INTROSPECTION_CONTENTS);
```

Already enabled in this ecosystem: the demo `math_service`/`math_client`, and all
four `mserve_drivechain` services (`/connect`, `/stop`, `/drive`, `/set_motor_id`).

Verify after starting the stack:

```bash
ros2 topic list | grep _service_event
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
