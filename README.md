# ROS 2 Diagnostic Platform

A browser-based diagnostic dashboard for ROS 2 systems. A Python bridge streams
live data to a React app over WebSockets — no ROS tooling or plugin needed in the
browser.

| View | What it does |
|---|---|
| **ROS Introspection** | Real-time 3D graph of nodes, topics, services, and actions with live telemetry particles and Hz tracking |
| **Behavior Tree** | Unreal-style BT.CPP v4 visualizer — live node states, blackboard, port remappings, multi-tree explorer |
| **BT Replay** | Scrub, seek, and play back recorded `.btlog` files with a density histogram and variable speed |
| **Telemetry** | react-chartjs-2 live chart — record any ROS topic field or BT blackboard variable, zoom/pan, dual Y axes, CSV export; data persists across tab switches |
| **Logging** | Live `/rosout` console with level filter, search, and payload capture |
| **Settings** | WS endpoint, theme, telemetry rate limits, per-view defaults — persisted to `localStorage` |

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

To avoid scanning all of `$HOME` on larger dev machines, you can narrow the
workspace search/watch scope:

```bash
export ROS_MONITOR_OVERLAY_ROOTS="$HOME/ros2_ws:$HOME/sim_ws"
export ROS_MONITOR_WATCH_ROOTS="$HOME/ros2_ws:$HOME/sim_ws"
./scripts/run_with_watch.sh --mode full --skip-build
```

### Standard launch

```bash
./scripts/run_visualizer_new.sh
```

Then open `http://localhost:7260`.

The default mode is `full` — connects to the live ROS 2 graph and auto-probes for
a BT/Groot2 publisher.

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
# Full mode with an explicit BT endpoint
./scripts/run_with_watch.sh --mode full --btros localhost:1667

# Demo: ROS nodes only (no BT)
./scripts/run_with_watch.sh --mode demo --no-bt

# Demo: BT only
./scripts/run_with_watch.sh --mode demo --no-ros-demo

# Faster restart — reuse existing frontend build
./scripts/run_with_watch.sh --skip-build
```

### Unattended dev on Thor

A `systemd` user-service template is included at
[`deploy/systemd/ros-monitor-dev.service`](deploy/systemd/ros-monitor-dev.service).
It restarts the launcher on crash/boot, while `run_with_watch.sh` still handles
workspace-driven restarts.

---

## ROS auto-detection

`scripts/detect_ros.sh` finds the installed ROS 2 distro and sources all colcon
overlay workspaces under `$HOME` automatically. Add it to `~/.bashrc` to
auto-source on every new terminal:

```bash
source /path/to/ros_monitor/scripts/detect_ros.sh 2>/dev/null || true
```

Checks distros in order: `jazzy → iron → humble → rolling`, honours a pre-set
`$ROS_DISTRO`, and skips `.venv/` paths.

---

## Connecting a real Behavior Tree

The BT view connects to the **Groot2Publisher** built into BehaviorTree.CPP v4.
Enable it in your node:

```cpp
#include <behaviortree_cpp/loggers/groot2_publisher.h>

// After the tree is created (on_configure or similar):
declare_parameter("groot_port", 1667);
const int port = get_parameter("groot_port").as_int();
groot_publisher_ = std::make_unique<BT::Groot2Publisher>(tree_, port);
```

Build with `-DBTCPP_GROOT_INTERFACE=ON`. Each executor should use a distinct port.
The bridge auto-probes `localhost:1667` in `full` mode, or use `--btros host:port`
to target a specific executor.

See **[bt_demo/README.md](bt_demo/README.md)** for the full standalone C++ demo.

### Blackboard boolean display

BT.CPP exports `bool` blackboard entries as `0`/`1` by default (via
`std::to_string(bool)`). To display them as `true`/`false` in the dashboard,
register a JSON exporter for `bool` **before** the tree starts:

```cpp
#include <behaviortree_cpp/json_export.h>

BT::RegisterJsonDefinition<bool>(
    [](nlohmann::json& dest, const bool& val) { dest = val; }
);
```

This makes BT.CPP emit native JSON booleans, which the bridge forwards as
Python `True`/`False` and the dashboard renders as `true`/`false`.

---

## Telemetry quick-start

1. Navigate to the **Telemetry** tab.
2. Add a series — type a topic name (e.g. `/diagnostics`) and an optional field
   dot-path (e.g. `status.0.level`), or pick a numeric blackboard key from the
   **Blackboard** panel (appears automatically when a BT tree is running).
3. Press **Start**. The chart builds left-to-right from the moment recording
   begins, then scrolls as a live 10-minute rolling window.
4. Navigate to other tabs freely — the chart keeps recording. Data is controlled
   by **Start / Stop**, not which tab is visible.
5. Scroll to zoom, drag to pan, click **↺ Live** or double-click the chart to snap
   back to live view.
6. Switch a series between the left and right Y axes using the axis button next to
   each series name. Use **Y Axes** in the sidebar to pin fixed ranges.
7. Click the download icon to export all visible series as a CSV.

---

## Layout

| Path | What |
|---|---|
| [backend/](backend/) | Python `rclpy` + `websockets` bridge (`ros_monitor_bridge`) |
| [frontend_new/](frontend_new/) | React 18 + TS + Vite + Tailwind app (production frontend) |
| [frontend/](frontend/) | Vanilla JS + Three.js reference frontend |
| [bt_demo/](bt_demo/) | Standalone C++ BehaviorTree.CPP v4 + Groot2 demo |
| [ros2_demo_ws/](ros2_demo_ws/) | Bundled demo ROS 2 package (`monitor_demo`) |
| [scripts/](scripts/) | Launch, build, and environment scripts |
| [docs/](docs/) | Detailed documentation |

---

## Documentation

- **[INSTALLATION.md](INSTALLATION.md)** — full setup guide for a fresh machine.
- **[docs/README.md](docs/README.md)** — architecture, run modes, WebSocket protocol.
- **[docs/walkthrough.md](docs/walkthrough.md)** — how the system was built, layer by layer.
- **[bt_demo/README.md](bt_demo/README.md)** — building and running the real Groot2 C++ demo.

---

## Potential next steps

These are the natural extension points if the platform grows:

- **Topic autocomplete in Telemetry** — feed the live `graph_update` topic list into the series-add input so the user doesn't have to type topic names manually.
- **BT Replay keyboard shortcuts** — space bar for play/pause, left/right arrow for frame-step.
- **Persistent Telemetry layout** — save the current series list and axis config to `localStorage` so the chart survives a full page refresh (data already persists across tab switches).
- **Multi-executor BT** — the bridge already auto-discovers multiple Groot2 ports; the frontend tree-explorer panel supports switching trees, but there is no UI to add/remove executor endpoints at runtime without restarting the bridge.
- **Alert rules** — threshold triggers on Telemetry series (e.g. topic Hz drops below 5 Hz, or a blackboard variable exceeds a value) that surface in the Logging console.
- **Recording to file** — a bridge-side option to write all streamed events to a `.jsonl` file for post-session replay (similar to the existing BT replay but for the full dashboard).
- **Mobile / tablet layout** — the current layout targets widescreen. A responsive breakpoint for the nav sidebar would make it usable on a tablet mounted on a robot.
