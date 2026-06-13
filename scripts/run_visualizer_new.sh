#!/usr/bin/env bash
# Build and serve the React visualizer frontend, then run the Python bridge in
# one of the canonical run modes: sim, demo, or full.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend_new"
DIST_DIR="$FRONTEND_DIR/dist"
ROS_SETUP="/opt/ros/${ROS_DISTRO:-jazzy}/setup.bash"
ROS_DEMO_WS_SETUP="$ROOT_DIR/ros2_demo_ws/install/setup.bash"
BT_DEMO_BIN="$ROOT_DIR/bt_demo/build/bt_demo"

MODE=""
SKIP_BUILD=false
NO_BT=false
NO_ROS_DEMO=false
EXPLICIT_BTROS=""
LEGACY_SIM=false
LEGACY_INSP=false
LEGACY_BT=false
EXTRA_BRIDGE_ARGS=()

ROS_DEMO_PID=""
BT_DEMO_PID=""
BRIDGE_PID=""

die() {
  echo "ERROR: $*" >&2
  exit 1
}

warn() {
  echo "[WARN] $*" >&2
}

kill_port() {
  local port="$1" desc="$2"
  local pids
  pids=$(fuser "${port}/tcp" 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    echo "[startup] Clearing leftover process on port ${port} (${desc})…"
    # shellcheck disable=SC2086
    kill -TERM $pids 2>/dev/null || true
    sleep 0.4
    pids=$(fuser "${port}/tcp" 2>/dev/null || true)
    [[ -z "$pids" ]] || kill -KILL $pids 2>/dev/null || true
  fi
}

terminate_pid() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  kill "$pid" >/dev/null 2>&1 || true
  for _ in {1..20}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  kill -KILL "$pid" >/dev/null 2>&1 || true
}

terminate_process_group() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  kill -- "-$pid" >/dev/null 2>&1 || true
  for _ in {1..20}; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done
  kill -KILL -- "-$pid" >/dev/null 2>&1 || true
}

cleanup() {
  local signal="${1:-}"
  trap - EXIT INT TERM
  local exit_code=$?
  if [[ "$signal" == "INT" ]]; then
    exit_code=130
  elif [[ "$signal" == "TERM" ]]; then
    exit_code=143
  fi
  set +e
  if [[ -n "$BRIDGE_PID" ]]; then
    terminate_pid "$BRIDGE_PID"
    wait "$BRIDGE_PID" >/dev/null 2>&1 || true
    BRIDGE_PID=""
  fi
  if [[ -n "$BT_DEMO_PID" ]]; then
    terminate_process_group "$BT_DEMO_PID"
    wait "$BT_DEMO_PID" >/dev/null 2>&1 || true
    BT_DEMO_PID=""
  fi
  if [[ -n "$ROS_DEMO_PID" ]]; then
    terminate_process_group "$ROS_DEMO_PID"
    wait "$ROS_DEMO_PID" >/dev/null 2>&1 || true
    ROS_DEMO_PID=""
  fi
  exit "${exit_code:-0}"
}

trap cleanup EXIT
trap 'cleanup INT' INT
trap 'cleanup TERM' TERM

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      [[ $# -ge 2 ]] || die "--mode requires sim, demo, or full"
      MODE="$2"
      shift 2
      ;;
    --mode=*)
      MODE="${1#*=}"
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --no-bt)
      NO_BT=true
      EXTRA_BRIDGE_ARGS+=("$1")
      shift
      ;;
    --no-ros-demo)
      NO_ROS_DEMO=true
      shift
      ;;
    --btros)
      [[ $# -ge 2 ]] || die "--btros requires HOST:PORT"
      EXPLICIT_BTROS="$2"
      EXTRA_BRIDGE_ARGS+=("--btros" "$2")
      shift 2
      ;;
    --btros=*)
      EXPLICIT_BTROS="${1#*=}"
      EXTRA_BRIDGE_ARGS+=("$1")
      shift
      ;;
    --sim)
      LEGACY_SIM=true
      shift
      ;;
    --insp)
      LEGACY_INSP=true
      shift
      ;;
    --bt)
      LEGACY_BT=true
      shift
      ;;
    *)
      EXTRA_BRIDGE_ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ -z "$MODE" ]]; then
  MODE="full"
fi

if [[ "$LEGACY_SIM" == true ]]; then
  warn "--sim is deprecated; use --mode sim."
  [[ "$MODE" == "full" ]] || [[ "$MODE" == "sim" ]] || die "--sim cannot be combined with --mode $MODE"
  MODE="sim"
fi

if [[ "$LEGACY_INSP" == true ]]; then
  warn "--insp is deprecated and now maps to --mode sim."
  [[ "$MODE" == "full" ]] || [[ "$MODE" == "sim" ]] || die "--insp cannot be combined with --mode $MODE"
  MODE="sim"
fi

case "$MODE" in
  sim|demo|full) ;;
  *) die "Unsupported --mode '$MODE'. Use sim, demo, or full." ;;
esac

if [[ "$MODE" == "sim" && -n "$EXPLICIT_BTROS" ]]; then
  die "--btros is not supported in --mode sim."
fi

if [[ "$MODE" != "demo" && "$NO_ROS_DEMO" == true ]]; then
  warn "--no-ros-demo is ignored outside --mode demo."
fi

if [[ "$LEGACY_BT" == true ]]; then
  warn "--bt is deprecated and ambiguous. Use --mode sim for internal simulated BT, or --mode demo for bundled local BT demo."
  if [[ "$MODE" == "sim" ]]; then
    warn "--bt is redundant in --mode sim; simulated BT is already enabled unless you pass --no-bt."
  elif [[ "$MODE" == "demo" ]]; then
    warn "--bt is ignored in --mode demo; the launcher already manages the bundled BT demo unless you pass --no-bt."
  else
    EXTRA_BRIDGE_ARGS+=("--bt")
  fi
fi

if [[ "$SKIP_BUILD" == false || ! -d "$DIST_DIR" ]]; then
  if ! command -v npm >/dev/null 2>&1; then
    die "npm not found — install Node.js to build frontend_new."
  fi
  echo "Building React frontend (frontend_new)…"
  if [[ ! -d "$FRONTEND_DIR/node_modules" ]]; then
    (cd "$FRONTEND_DIR" && npm install)
  fi
  (cd "$FRONTEND_DIR" && npm run build)
fi

require_ros() {
  [[ -f "$ROS_SETUP" ]] || die "ROS setup file not found: $ROS_SETUP"
  set +u
  # shellcheck disable=SC1090
  source "$ROS_SETUP"
  set -u
}

ensure_demo_workspace() {
  if [[ ! -f "$ROS_DEMO_WS_SETUP" ]]; then
    echo "Building bundled ROS demo workspace…"
    "$ROOT_DIR/scripts/build_demo.sh"
  fi
}

ensure_bt_demo() {
  if [[ -x "$BT_DEMO_BIN" ]]; then
    return
  fi
  if ! command -v cmake >/dev/null 2>&1; then
    die "cmake not found — required to build bt_demo for --mode demo."
  fi
  echo "Building bundled BT demo…"
  cmake -S "$ROOT_DIR/bt_demo" -B "$ROOT_DIR/bt_demo/build" -DCMAKE_BUILD_TYPE=Release
  cmake --build "$ROOT_DIR/bt_demo/build"
}

start_ros_demo() {
  ensure_demo_workspace
  echo "Starting bundled ROS demo…"
  setsid "$ROOT_DIR/scripts/run_demo.sh" &
  ROS_DEMO_PID=$!
}

start_bt_demo() {
  ensure_bt_demo
  echo "Starting bundled BT demo…"
  setsid "$BT_DEMO_BIN" &
  BT_DEMO_PID=$!
}

if [[ "$MODE" == "full" || "$MODE" == "demo" ]]; then
  require_ros
fi

"$ROOT_DIR/scripts/setup_python_env.sh"

# Clear any leftover processes from a previous run that didn't exit cleanly.
kill_port 8765 "bridge WebSocket"
kill_port 7260 "bridge HTTP"

if [[ "$MODE" == "demo" ]]; then
  if [[ "$NO_ROS_DEMO" == false ]]; then
    start_ros_demo
  fi
  if [[ "$NO_BT" == false && -z "$EXPLICIT_BTROS" ]]; then
    kill_port 1667 "bt_demo ZMQ"
    start_bt_demo
    EXTRA_BRIDGE_ARGS+=("--btros" "localhost:1667")
  fi
fi

export ROS_MONITOR_FRONTEND_DIR="$DIST_DIR"

BRIDGE_CMD=(
  "$ROOT_DIR/.venv/bin/python"
  "$ROOT_DIR/backend/bridge.py"
  "--mode" "$MODE"
  "${EXTRA_BRIDGE_ARGS[@]}"
)

"${BRIDGE_CMD[@]}" &
BRIDGE_PID=$!
set +e
wait "$BRIDGE_PID"
bridge_exit_code=$?
set -e
BRIDGE_PID=""
exit "$bridge_exit_code"
