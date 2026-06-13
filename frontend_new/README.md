# ROS Monitor React Frontend

`frontend_new/` is the production frontend for the ROS monitor visualizer. It is a React 18 + TypeScript + Vite application that the Python bridge serves on `http://localhost:7260`.

## Run It Through the Project Launcher

The canonical entrypoint is the repo launcher:

```bash
./scripts/run_visualizer_new.sh
```

That starts the visualizer in **full** mode by default and serves the built frontend at:

```text
http://localhost:7260
```

Supported launcher modes:

```bash
./scripts/run_visualizer_new.sh --mode sim
./scripts/run_visualizer_new.sh --mode demo
./scripts/run_visualizer_new.sh --mode full
```

Mode summary:

| Mode | What it does |
|---|---|
| `sim` | Fully offline. The backend simulates ROS introspection and BT data internally. No ROS 2 runtime is required. |
| `demo` | Starts the bundled local demos and uses real local protocols. By default this includes the ROS demo and the BT demo. |
| `full` | Connects to the live ROS 2 graph and auto-probes for a real BT/Groot2 publisher. This is the default. |

Useful variants:

```bash
# Reuse existing frontend build output
./scripts/run_visualizer_new.sh --skip-build

# Demo ROS only
./scripts/run_visualizer_new.sh --mode demo --no-bt

# Demo BT only
./scripts/run_visualizer_new.sh --mode demo --no-ros-demo

# Full mode with an explicit BT endpoint
./scripts/run_visualizer_new.sh --mode full --btros localhost:1667
```

## Frontend-Only Development

Install dependencies:

```bash
cd frontend_new
npm install
```

Run the Vite dev server:

```bash
npm run dev
```

The dev server opens on `http://localhost:5173`.

For live backend data during frontend development, run the bridge separately in another terminal:

```bash
./scripts/run_visualizer_new.sh --skip-build --mode full
```

The frontend derives the WebSocket host from the page hostname and connects to the bridge on port `8765`.

The app uses one shared application-level WebSocket connection. Runtime behavior is selected only through the launcher run modes above; there are no browser-local simulation toggles anymore.

## Build Commands

```bash
npm run build
npm run preview
npm run typecheck
npm run lint
```
