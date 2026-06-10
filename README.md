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
- **Python Libraries**: `websockets` (install via `pip install websockets`)
- **ROS 2**: Humble or Jazzy (for ROS 2 Mode)

---

## How-To-Run Guide

### Option A: Local Simulation Mode (Windows / macOS / Linux without ROS 2)
Use this option to test the interactive 3D frontend and verify the layout engine without any active ROS 2 system.

1. Ensure the `websockets` library is installed:
   ```bash
   pip install websockets
   ```
2. Navigate to the project root directory and run the bridge script:
   ```bash
   python backend/bridge.py --sim
   ```
   *Note: If `rclpy` is not installed, the bridge script will automatically fall back to simulation mode even without the `--sim` flag.*
3. Open your browser and navigate to:
   ```
   http://localhost:8080
   ```
4. Click the **Toggle Simulation** button in the bottom-left controls overlay to start the local message streams.

---

### Option B: Real ROS 2 Mode (Linux Raspberry Pi / PC with ROS 2 Jazzy or Humble)
Use this option inside a sourced ROS 2 workspace.

1. Ensure the `websockets` library is installed:
   ```bash
   pip3 install websockets
   ```
2. Source your ROS 2 workspace:
   ```bash
   source /opt/ros/jazzy/setup.bash  # or setup.zsh, or /opt/ros/humble/...
   ```
3. Run the bridge:
   ```bash
   python3 backend/bridge.py
   ```
4. Run some active ROS 2 nodes in separate terminals. For instance, the standard Python demo nodes:
   ```bash
   # In terminal 2
   source /opt/ros/jazzy/setup.bash
   ros2 run demo_nodes_py talker
   ```
   ```bash
   # In terminal 3
   source /opt/ros/jazzy/setup.bash
   ros2 run demo_nodes_py listener
   ```
5. Open a browser (on the same machine or on a computer on the same network) and go to:
   ```
   http://<RASPBERRY_PI_IP>:8080
   ```
   *(Ensure port `8080` and `8765` are open on the Raspberry Pi's firewall).*

---

## Visual UX Reference

- **Blue/Teal Cylinders**: ROS 2 Nodes.
- **Orange Spheres**: Active Topics.
- **Green Cubes**: Services.
- **Purple Icosahedrons**: Action Clusters (groups goal, result, feedback, status, and cancel topics/services).
- **Interactive Inspection**: Click on any flying message particle to freeze its movement in mid-air. The right-hand **Packet Inspector** panel slides open to display the decoded JSON payload, type metadata, source/destination timestamps, and payload sizes. Click **Resume Telemetry Stream** or close the inspector to release it.
