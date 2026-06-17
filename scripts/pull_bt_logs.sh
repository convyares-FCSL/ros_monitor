#!/usr/bin/env bash
#
# pull_bt_logs.sh — Manually pull BehaviorTree .btlog.db3 files from an edge
# device to a local directory for replay/testing in the ROS Monitor dashboard.
#
# Safe to run repeatedly: rsync only transfers new or changed files (--update).
# The strict include filter means rosbag2 directories in the same remote path
# are never touched.
#
# Usage:
#   ./scripts/pull_bt_logs.sh [OPTIONS] [edge_host] [remote_dir] [local_dir]
#
# Options:
#   -n, --dry-run   Show what would be transferred without transferring
#   -h, --help      Show this help
#
# Positional defaults:
#   edge_host   = bt-edge        (set up an SSH config alias, or pass user@host)
#   remote_dir  = /var/log/bt
#   local_dir   = ./bt_logs
#
# Examples:
#   ./scripts/pull_bt_logs.sh
#   ./scripts/pull_bt_logs.sh --dry-run
#   ./scripts/pull_bt_logs.sh pi@192.168.1.50 /var/log/bt ./bt_logs
#   ./scripts/pull_bt_logs.sh --dry-run bt-edge /data/bt_logs ~/hyfleet/bt_logs

set -euo pipefail

# ── Argument parsing ─────────────────────────────────────────────────────────
DRY_RUN=false
POSITIONAL=()

for arg in "$@"; do
  case "$arg" in
    -n|--dry-run) DRY_RUN=true ;;
    -h|--help)
      sed -n '3,28p' "$0"   # print the header comment block
      exit 0
      ;;
    *) POSITIONAL+=("$arg") ;;
  esac
done

EDGE_HOST="${POSITIONAL[0]:-bt-edge}"
REMOTE_DIR="${POSITIONAL[1]:-/var/log/bt}"
LOCAL_DIR="${POSITIONAL[2]:-./bt_logs}"

# ── Run ──────────────────────────────────────────────────────────────────────
TIMESTAMP="$(date +%Y%m%dT%H%M%S)"

mkdir -p "${LOCAL_DIR}"

echo "==> Pulling .btlog.db3 files"
echo "    From : ${EDGE_HOST}:${REMOTE_DIR}/"
echo "    To   : ${LOCAL_DIR}/"
if ${DRY_RUN}; then
  echo "    Mode : DRY RUN (no files will be transferred)"
fi
echo ""

RSYNC_OPTS=(-avzh --update
  --include='*.btlog.db3'
  --exclude='*'
)
${DRY_RUN} && RSYNC_OPTS+=(--dry-run)

LOG_FILE="${LOCAL_DIR}/.pull_log_${TIMESTAMP}.txt"

rsync "${RSYNC_OPTS[@]}" \
  "${EDGE_HOST}:${REMOTE_DIR}/" \
  "${LOCAL_DIR}/" \
  | tee "${LOG_FILE}"

echo ""
if ${DRY_RUN}; then
  echo "==> Dry run complete. Re-run without --dry-run to transfer."
  rm -f "${LOG_FILE}"   # don't leave an empty log from a dry run
else
  COUNT=$(find "${LOCAL_DIR}" -maxdepth 1 -name '*.btlog.db3' | wc -l)
  echo "==> Done. ${COUNT} .btlog.db3 file(s) in ${LOCAL_DIR}/"
  echo "    Transfer log: ${LOG_FILE}"
  echo ""
  find "${LOCAL_DIR}" -maxdepth 1 -name '*.btlog.db3' \
    -exec ls -lh {} + 2>/dev/null | awk '{print "   ", $5, $9}' \
    || echo "    (none found)"
fi
