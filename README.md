# ROS 2 Diagnostic Platform

A browser-based diagnostic dashboard for ROS 2 systems. A Python bridge streams live
data to a React app over WebSockets; no ROS tooling is needed in the browser.

- **ROS Introspection** — real-time 3D view of the ROS 2 graph (nodes, topics,
  services, actions) with live telemetry.
- **Behavior Tree** — Unreal-style visualizer for BehaviorTree.CPP v4 trees (live
  status, blackboard, port remappings), fed by the demo emitter or a real Groot2 executor.

## Quickstart

Start the visualizer in full live-system mode:

```bash
./scripts/run_visualizer_new.sh
```

Then open:

```text
http://localhost:7260
```

The default mode is `full`, which connects to the live ROS 2 graph and auto-probes for a BT/Groot2 publisher.

For pure local simulation:

```bash
./scripts/run_visualizer_new.sh --mode sim
```

For bundled local demos using real protocols:

```bash
./scripts/run_visualizer_new.sh --mode demo
```

Useful variants:

```bash
# Full mode with explicit BT endpoint
./scripts/run_visualizer_new.sh --mode full --btros localhost:1667

# Demo ROS only
./scripts/run_visualizer_new.sh --mode demo --no-bt

# Demo BT only
./scripts/run_visualizer_new.sh --mode demo --no-ros-demo

# Faster restart using existing built assets
./scripts/run_visualizer_new.sh --skip-build
```

The bridge prints a **RUN MODE** banner on startup and the app shows `MODE` / `INSP` / `BT` chips so the active data sources are always visible. See **[docs/README.md → Visualizer run modes](docs/README.md#visualizer-run-modes)** for the full details.

## Layout

| Path | What |
|---|---|
| [backend/](backend/) | Python `rclpy` + `websockets` bridge (`ros_monitor_bridge`) |
| [frontend_new/](frontend_new/) | React 18 + TS + Vite + Tailwind app (production frontend) |
| [frontend/](frontend/) | Vanilla JS + Three.js reference frontend + BT prototype |
| [bt_demo/](bt_demo/) | Standalone C++ BehaviorTree.CPP v4 + Groot2 demo (real BT source) |
| [ros2_demo_ws/](ros2_demo_ws/) | Bundled demo ROS 2 package (`monitor_demo`) |
| [docs/](docs/) | Detailed documentation (below) |

## Documentation

- **[docs/README.md](docs/README.md)** — full setup, run modes, WebSocket protocol,
  and architecture.
- **[docs/walkthrough.md](docs/walkthrough.md)** — how the system was built, layer by layer.
- **[docs/bt_visualizer_plan.md](docs/bt_visualizer_plan.md)** — the Behavior Tree
  visualizer execution plan + progress.
- **[bt_demo/README.md](bt_demo/README.md)** — building/running the real Groot2 demo.
