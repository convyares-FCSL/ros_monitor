#!/usr/bin/env bash
# Container entrypoint for the ROS Monitor bridge.
#   1. Source the ROS 2 environment.
#   2. Optionally source a mounted overlay so the monitor can deserialize the
#      system-under-test's *custom* message types (e.g. HyFleet interfaces).
#   3. Exec the bridge, forwarding all CMD args (default: --mode full).
set -e

# shellcheck disable=SC1091
source /opt/ros/jazzy/setup.bash

# Optional overlay — point ROS_MONITOR_OVERLAY_SETUP at a mounted
# install/setup.bash to load custom interface packages. Without it, only the
# standard ROS message types can be decoded; topics carrying unknown custom
# types are listed but their payloads cannot be introspected.
if [[ -n "${ROS_MONITOR_OVERLAY_SETUP:-}" ]]; then
  if [[ -f "${ROS_MONITOR_OVERLAY_SETUP}" ]]; then
    echo "[entrypoint] sourcing overlay: ${ROS_MONITOR_OVERLAY_SETUP}"
    # shellcheck disable=SC1090
    source "${ROS_MONITOR_OVERLAY_SETUP}"
  else
    echo "[entrypoint] WARNING: ROS_MONITOR_OVERLAY_SETUP set but not found: ${ROS_MONITOR_OVERLAY_SETUP}" >&2
  fi
fi

echo "[entrypoint] ROS_DISTRO=${ROS_DISTRO:-?}  ROS_DOMAIN_ID=${ROS_DOMAIN_ID:-0}  RMW=${RMW_IMPLEMENTATION:-default}"
exec python3 /app/backend/bridge.py "$@"
