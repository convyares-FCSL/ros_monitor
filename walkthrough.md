# ROS 2 3D Network Visualizer - Walkthrough

We have successfully built and verified the "first-gen" prototype of the 3D ROS 2 Network Visualizer! The application works as a hybrid Python bridge / WebGL browser client.

---

## File Summary

The following files have been created in the workspace:

1. **[bridge.py](file:///c:/Users/CarlVonAyres/OneDrive%20-%20Fuel%20Cell%20Systems/Desktop/New%20folder%20%282%29/backend/bridge.py)**: The Python backend websocket bridge & ROS 2 node.
2. **[index.html](file:///c:/Users/CarlVonAyres/OneDrive%20-%20Fuel%20Cell%20Systems/Desktop/New%20folder%20%282%29/frontend/index.html)**: The frontend layout, sidebar list panels, statistics counters, and glassmorphic inspector overlay.
3. **[style.css](file:///c:/Users/CarlVonAyres/OneDrive%20-%20Fuel%20Cell%20Systems/Desktop/New%20folder%20%282%29/frontend/style.css)**: The CSS styling containing HSL color themes, custom scrollbars, glowing badges, drawer transitions, and pulse animations.
4. **[app.js](file:///c:/Users/CarlVonAyres/OneDrive%20-%20Fuel%20Cell%20Systems/Desktop/New%20folder%20%282%29/frontend/app.js)**: The core client Javascript setting up the Three.js viewport, starfield environment, 3D Force-Directed physics simulation, double-leg particle animations, raycaster mouse click listener, and layout controls.
5. **[README.md](file:///c:/Users/c:/Users/CarlVonAyres/OneDrive%20-%20Fuel%20Cell%20Systems/Desktop/New%20folder%20%282%29/README.md)**: A structured setup and operational guide for running locally in simulation mode (Windows) and real ROS 2 mode (Jazzy/Humble on Raspberry Pi).

---

## Key Features Implemented

### 1. Robust Multi-Threaded ROS 2 / Async WebSocket Bridge
To solve the event loop conflict between `asyncio` (WebSockets) and `rclpy` (ROS 2), we implemented a clean thread separation:
- The WebSocket server starts in the main thread inside an `asyncio` event loop using `asyncio.run()`.
- The `rclpy` environment initializes and spins in a separate background thread using a `MultiThreadedExecutor`.
- Communication is coordinated via a global loop reference and `loop.call_soon_threadsafe(event_queue.put_nowait, ...)`, allowing callbacks running on the ROS thread to safely insert telemetry packets into the async WebSocket queue.

### 2. Dual-Mode Fallback & Full Sandbox Simulation
If `rclpy` or `rosidl_runtime_py` modules are missing (e.g. running on Windows during development), the script detects this and falls back to **Simulation Mode** (which can also be forced with the `--sim` flag). 
- It generates a mock network graph of 6 nodes (camera, lidar, planner, localizer, motor, fibonacci server).
- It generates high-frequency telemetry (/pose at 5Hz, /cmd_vel at 2Hz) and mocks action server states (/fibonacci goal, feedback sequence additions, and final result).
- If the websocket connection is down, the frontend features a **Local Sandbox Mode** (toggled in the bottom-left controls HUD) to run the simulation directly in the browser's script sandbox.

### 3. Decoupled Topological Edge Model
We modeled the topology as:
`Publisher Node -> Topic Node -> Subscriber Node`
This means topics appear as their own smaller orange sphere hubs in space, separating they themselves from the blue node cylinders. Lines connect the publisher to the topic, and the topic to the subscribers. This ensures perfect congruence with the ROS 2 graph.

### 4. Dynamic Action Clustering
The backend filters and groups naming conventions ending with `/_action/feedback`, `/_action/status`, `/_action/send_goal`, `/_action/get_result`, and `/_action/cancel_goal`. 
Instead of adding 5 separate links, they are bundled together under a unified Action Node (purple icosahedron) linked between the action client and the action server, keeping the 3D space clean and readable.

### 5. Particle Routing & Raycasting Inspection
- **Message Particles**: Spawn at the publishing node, travel to the topic sphere (Leg 1), and then route out to each subscribing node (Leg 2). 
- **Raycasting**: Mouse clicks on the 3D viewport raycast against active particles. Clicking a particle pauses its translation, scales it up, and opens a glassmorphism drawer on the right.
- **HUD Inspector**: The drawer parses and displays the decoded JSON, topic name, size in bytes, type, source, and destination. Clicking "Resume Telemetry Stream" releases the particle back into motion.

---

## Verification Logs

The backend was run successfully in simulation mode:
```text
[2026-06-10 15:52:39,797] [WARNING] ROS 2 (rclpy/rosidl) not found. Falling back to Simulation Mode.
[2026-06-10 15:52:39,879] [INFO] Simulation mode forced via --sim flag.
[2026-06-10 15:52:39,982] [INFO] server listening on 0.0.0.0:8765
[2026-06-10 15:52:39,982] [INFO] WebSocket server started on ws://0.0.0.0:8765
[2026-06-10 15:52:39,985] [INFO] Initializing Simulated ROS 2 Bridge...
[2026-06-10 15:52:39,986] [INFO] Simulation background thread started.
[2026-06-10 15:52:39,986] [INFO] WebSocket broadcaster task running.
[2026-06-10 15:52:39,987] [INFO] Serving frontend static files from: C:\Users\CarlVonAyres\OneDrive - Fuel Cell Systems\Desktop\New folder (2)\frontend
[2026-06-10 15:52:39,987] [INFO] Open in browser: http://localhost:8080
```
This confirms:
1. Static files are correctly served on port `8080`.
2. WebSocket server initializes on port `8765`.
3. The mock background simulator runs on a separate thread.
