#!/usr/bin/env bash
# Sourceable: auto-detects the installed ROS 2 distro and sources all colcon
# overlay workspaces found under $HOME (depth ≤ 5).
# Safe to re-source; honours a pre-set ROS_DISTRO if already in the environment.
#
# Usage: source scripts/detect_ros.sh

_ros_pref=(jazzy iron humble rolling)

_detect_distro() {
  if [[ -n "${ROS_DISTRO:-}" && -f "/opt/ros/$ROS_DISTRO/setup.bash" ]]; then
    echo "$ROS_DISTRO"; return
  fi
  for _d in "${_ros_pref[@]}"; do
    [[ -f "/opt/ros/$_d/setup.bash" ]] && { echo "$_d"; return; }
  done
  ls /opt/ros/ 2>/dev/null | sort -rV | head -1
}

_source_overlays() {
  while IFS= read -r _s; do
    [[ "$_s" == *"/.venv/"* ]] && continue
    set +u
    # shellcheck disable=SC1090
    source "$_s" 2>/dev/null || true
    set -u
  done < <(find "$HOME" -maxdepth 5 -name setup.bash -path "*/install/setup.bash" 2>/dev/null | sort)
}

_ROS=$(_detect_distro)
if [[ -n "$_ROS" && -f "/opt/ros/$_ROS/setup.bash" ]]; then
  echo "[detect_ros] sourcing /opt/ros/$_ROS"
  set +u
  # shellcheck disable=SC1090
  source "/opt/ros/$_ROS/setup.bash"
  set -u
  _source_overlays
else
  echo "[detect_ros] WARNING: no ROS 2 installation found in /opt/ros/" >&2
fi

unset _ros_pref _ROS
unset -f _detect_distro _source_overlays
