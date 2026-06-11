#!/usr/bin/env bash
# Same as run_visualizer.sh, but serves the React frontend (frontend_new)
# instead of the vanilla JS one. Builds it first if needed.
#
# Usage: ./scripts/run_visualizer_new.sh [--sim] [--skip-build] [bridge args...]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend_new"
DIST_DIR="$FRONTEND_DIR/dist"
ROS_SETUP="/opt/ros/${ROS_DISTRO:-jazzy}/setup.bash"

# --skip-build reuses the existing dist (faster restarts)
SKIP_BUILD=false
BRIDGE_ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--skip-build" ]]; then
    SKIP_BUILD=true
  else
    BRIDGE_ARGS+=("$arg")
  fi
done

# ── Build the React frontend ─────────────────────────────────────────────────
if [[ "$SKIP_BUILD" == false || ! -d "$DIST_DIR" ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    echo "ERROR: npm not found — install Node.js to build frontend_new." >&2
    exit 1
  fi
  echo "Building React frontend (frontend_new)…"
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    (cd "$FRONTEND_DIR" && npm install)
  fi
  (cd "$FRONTEND_DIR" && npm run build)
fi

# ── Source ROS + python env, then run the bridge against dist/ ───────────────
if [[ ! -f "$ROS_SETUP" ]]; then
  echo "ROS setup file not found: $ROS_SETUP" >&2
  exit 1
fi

set +u
source "$ROS_SETUP"
set -u
"$ROOT_DIR/scripts/setup_python_env.sh"

export ROS_MONITOR_FRONTEND_DIR="$DIST_DIR"
exec "$ROOT_DIR/.venv/bin/python" "$ROOT_DIR/backend/bridge.py" ${BRIDGE_ARGS[@]+"${BRIDGE_ARGS[@]}"}
