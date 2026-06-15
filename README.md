# ROS 2 Diagnostic Platform

A browser-based diagnostic dashboard for ROS 2 systems. A Python bridge streams live
data to a React app over WebSockets; no ROS tooling is needed in the browser.

- **ROS Introspection** — real-time 3D view of the ROS 2 graph (nodes, topics,
  services, actions) with live telemetry.
- **Behavior Tree** — Unreal-style visualizer for BehaviorTree.CPP v4 trees (live
  status, blackboard, port remappings), fed by the demo emitter or a real Groot2 executor.

---

## Installation

See **[INSTALLATION.md](INSTALLATION.md)** for a full setup guide covering ROS 2,
Node.js, Python, and the C++ BT demo on a fresh machine.

---

## Quickstart

### Watched launch (recommended)

Auto-detects your ROS 2 distro, sources all colcon workspaces under `$HOME`, and
restarts the bridge automatically whenever a new workspace is built:

```bash
./scripts/run_with_watch.sh --mode full
```

Requires `inotify-tools` (`sudo apt install inotify-tools`). Falls back to a plain
single run without it.

### Standard launch

```bash
./scripts/run_visualizer_new.sh
```

Then open:

```text
http://localhost:7260
```

The default mode is `full`, which connects to the live ROS 2 graph and auto-probes
for a BT/Groot2 publisher.

---

## Run modes

| Mode | Description | Needs ROS running |
|---|---|---|
| `full` | Live system — introspects the real ROS 2 graph | Yes |
| `demo` | Bundled local demo processes, real protocols | No (starts them) |
| `sim` | Pure backend simulation, no external processes | No |

```bash
./scripts/run_with_watch.sh --mode sim    # offline, no ROS required
./scripts/run_with_watch.sh --mode demo   # bundled ROS + BT demo
./scripts/run_with_watch.sh --mode full   # live system (default)
```

Useful variants:

```bash
# Full mode with explicit BT endpoint
./scripts/run_with_watch.sh --mode full --btros localhost:1667

# Demo ROS only (no BT)
./scripts/run_with_watch.sh --mode demo --no-bt

# Demo BT only
./scripts/run_with_watch.sh --mode demo --no-ros-demo

# Faster restart — reuse existing frontend build
./scripts/run_with_watch.sh --skip-build
```

---

## ROS auto-detection

`scripts/detect_ros.sh` is a sourceable script that finds the installed ROS 2 distro
and sources all colcon overlay workspaces under `$HOME` automatically. Add it to
`~/.bashrc` to auto-source on every new terminal:

```bash
source /path/to/ros_monitor/scripts/detect_ros.sh 2>/dev/null || true
```

It checks distros in order: `jazzy → iron → humble → rolling`, honours a pre-set
`$ROS_DISTRO`, and skips `.venv/` paths.

---

## Layout

| Path | What |
|---|---|
| [backend/](backend/) | Python `rclpy` + `websockets` bridge (`ros_monitor_bridge`) |
| [frontend_new/](frontend_new/) | React 18 + TS + Vite + Tailwind app (production frontend) |
| [frontend/](frontend/) | Vanilla JS + Three.js reference frontend + BT prototype |
| [bt_demo/](bt_demo/) | Standalone C++ BehaviorTree.CPP v4 + Groot2 demo |
| [ros2_demo_ws/](ros2_demo_ws/) | Bundled demo ROS 2 package (`monitor_demo`) |
| [scripts/](scripts/) | Launch, build, and environment scripts |
| [docs/](docs/) | Detailed documentation |

---

## Documentation

- **[INSTALLATION.md](INSTALLATION.md)** — full setup guide for a fresh machine.
- **[docs/README.md](docs/README.md)** — architecture, run modes, WebSocket protocol.
- **[docs/walkthrough.md](docs/walkthrough.md)** — how the system was built, layer by layer.
- **[docs/bt_visualizer_plan.md](docs/bt_visualizer_plan.md)** — Behavior Tree visualizer plan + progress.
- **[bt_demo/README.md](bt_demo/README.md)** — building/running the real Groot2 demo.
