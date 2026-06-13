# ROS 2 Diagnostic Platform

A browser-based diagnostic dashboard for ROS 2 systems. A Python bridge streams live
data to a React app over WebSockets; no ROS tooling is needed in the browser.

- **ROS Introspection** — real-time 3D view of the ROS 2 graph (nodes, topics,
  services, actions) with live telemetry.
- **Behavior Tree** — Unreal-style visualizer for BehaviorTree.CPP v4 trees (live
  status, blackboard, port remappings), fed by the demo emitter or a real Groot2 executor.

## Quickstart

```bash
# React app (build + serve the bridge) — open http://localhost:7260
./scripts/run_visualizer_new.sh --sim --bt     # no ROS; both views on demo data

# Real ROS graph + auto-probe a local Groot2 behaviour tree on port 1667
python3 backend/bridge.py
```

The bridge prints a **RUN MODE** banner on startup and the app shows `INSP` / `BT`
data-mode chips, so it's always clear whether you're on real, demo, or no-ROS data.
See **[docs/README.md → Run modes](docs/README.md#run-modes-bridge-flags)** for the
full flag matrix (`--sim`, `--insp`, `--bt`, `--btros`).

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
