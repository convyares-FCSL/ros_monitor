#!/usr/bin/env bash
# Wraps run_visualizer_new.sh with:
#   - automatic ROS 2 distro detection and overlay workspace sourcing on each start
#   - automatic bridge restart when a new colcon workspace is built
#     (requires inotify-tools: sudo apt install inotify-tools)
#
# Usage: ./scripts/run_with_watch.sh [--mode sim|demo|full] [other flags]
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DETECT_ROS="$ROOT_DIR/scripts/detect_ros.sh"
VIZ="$ROOT_DIR/scripts/run_visualizer_new.sh"

if ! command -v inotifywait >/dev/null 2>&1; then
  echo "[watch] inotify-tools not installed — running without workspace watching."
  echo "[watch]   sudo apt install inotify-tools  to enable auto-restart."
  set +u
  # shellcheck disable=SC1090
  source "$DETECT_ROS"
  set -u
  exec "$VIZ" "$@"
fi

RESTART=true
_MY_PID=$BASHPID

_on_new_workspace() {
  RESTART=true
  echo ""
  echo "[watch] New ROS workspace detected — restarting bridge..."
  [[ -n "${VIZ_PID:-}" ]] && kill "$VIZ_PID" 2>/dev/null || true
  [[ -n "${WATCHER_PID:-}" ]] && kill "$WATCHER_PID" 2>/dev/null || true
}

_on_exit() {
  RESTART=false
  [[ -n "${VIZ_PID:-}" ]] && kill "$VIZ_PID" 2>/dev/null || true
  [[ -n "${WATCHER_PID:-}" ]] && kill "$WATCHER_PID" 2>/dev/null || true
}

trap '_on_new_workspace' USR1
trap '_on_exit' INT TERM

while [[ "$RESTART" == true ]]; do
  RESTART=false
  VIZ_PID=""
  WATCHER_PID=""

  # Re-detect ROS distro and source any newly built overlays
  set +u
  # shellcheck disable=SC1090
  source "$DETECT_ROS"
  set -u

  # Background inotify watcher: signals this process when a new install/setup.bash appears
  (
    inotifywait -q -r -m -e create -e moved_to \
      --format '%w%f' \
      "$HOME" 2>/dev/null \
    | while IFS= read -r _path; do
        [[ "$_path" == */install/setup.bash ]] || continue
        [[ "$_path" == *"/.venv/"* ]] && continue
        echo "[watch] found $_path"
        kill -USR1 "$_MY_PID" 2>/dev/null || true
        break
      done
  ) &
  WATCHER_PID=$!

  # Run the visualizer in the background so signals reach this script
  set +e
  "$VIZ" "$@" &
  VIZ_PID=$!
  wait "$VIZ_PID"
  VIZ_PID=""
  set -e

  [[ -n "$WATCHER_PID" ]] && { kill "$WATCHER_PID" 2>/dev/null || true; WATCHER_PID=""; }

  if [[ "$RESTART" == true ]]; then
    echo "[watch] Restarting in 2s..."
    sleep 2
  fi
done
