#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WS_DIR="$ROOT_DIR/ros2_demo_ws"
ROS_SETUP="/opt/ros/${ROS_DISTRO:-jazzy}/setup.bash"
WS_SETUP="$WS_DIR/install/setup.bash"

if [[ ! -f "$ROS_SETUP" ]]; then
  echo "ROS setup file not found: $ROS_SETUP" >&2
  exit 1
fi

if [[ ! -f "$WS_SETUP" ]]; then
  echo "Workspace is not built yet. Run scripts/build_demo.sh first." >&2
  exit 1
fi

set +u
source "$ROS_SETUP"
source "$WS_SETUP"
set -u

exec ros2 launch monitor_demo monitor_demo.launch.py
