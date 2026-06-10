"""
PidScanner — map ROS 2 node names to Linux PIDs via /proc.

Match strategy (descending confidence):
  100 — explicit ROS 2 name remapping:  __node:=<short_name>
   70 — short name as standalone word in cmdline
   30 — short name appears inside a file path argument

Returns None when no match meets the minimum threshold.  A None result
is a useful phantom signal: the node exists in the ROS 2 graph but the
bridge cannot find a live OS process backing it.
"""

import os
import re


_MIN_SCORE = 30


def _proc_cmdlines() -> dict[int, str]:
    """Return {pid: cmdline_string} for all readable /proc entries."""
    result: dict[int, str] = {}
    try:
        for entry in os.scandir('/proc'):
            if not entry.name.isdigit():
                continue
            try:
                with open(f'/proc/{entry.name}/cmdline', 'rb') as fh:
                    raw = fh.read()
                cmdline = raw.replace(b'\x00', b' ').decode('utf-8', errors='replace').strip()
                if cmdline:
                    result[int(entry.name)] = cmdline
            except OSError:
                pass
    except OSError:
        pass
    return result


def _score(short: str, cmdline: str) -> int:
    if f'__node:={short}' in cmdline:
        return 100
    # standalone word anywhere in the cmdline
    if re.search(rf'(?:^|\s){re.escape(short)}(?:\s|$)', cmdline):
        return 70
    # short name as last segment of a path arg  (e.g.  /install/pkg/lib/pkg/short_name)
    if re.search(rf'/{re.escape(short)}(?:\.py)?(?:\s|$)', cmdline):
        return 30
    return 0


def scan(node_names: list[str]) -> dict[str, int | None]:
    """
    Scan /proc once and return {node_name: pid_or_None} for every name in
    *node_names*.  Callers should pass fully-qualified names (e.g. '/compressor_sim').
    """
    if not node_names:
        return {}

    cmdlines = _proc_cmdlines()
    result: dict[str, int | None] = {}

    for node_name in node_names:
        short = node_name.lstrip('/')
        best_score, best_pid = 0, None

        for pid, cmdline in cmdlines.items():
            s = _score(short, cmdline)
            if s > best_score:
                best_score = s
                best_pid = pid

        result[node_name] = best_pid if best_score >= _MIN_SCORE else None

    return result
