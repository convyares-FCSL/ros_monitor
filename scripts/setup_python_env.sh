#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$ROOT_DIR/.venv"
PYVENV_CFG="$VENV_DIR/pyvenv.cfg"

if [[ -f "$PYVENV_CFG" ]] && ! grep -q '^include-system-site-packages = true$' "$PYVENV_CFG"; then
  rm -rf "$VENV_DIR"
fi

if [[ ! -d "$VENV_DIR" ]]; then
  python3 -m venv --system-site-packages "$VENV_DIR"
fi

"$VENV_DIR/bin/pip" install -r "$ROOT_DIR/requirements.txt"
