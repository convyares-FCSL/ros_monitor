"""bt_replay.py — VCR replay of .btlog.db3 files from BT.CPP v4 SqliteLogger.

Streams bt_blueprint + bt_delta events over the same runtime channel as the
live btros_bridge so the frontend is identical regardless of data source.

Schema (BT.CPP 4.9.0, confirmed against real output):
  Definitions(session_id PK AUTOINCREMENT, date TEXT, xml_tree TEXT)
  Nodes(session_id, fullpath, node_uid)
  Transitions(timestamp INTEGER PK, session_id, node_uid, duration, state, extra_data)
    timestamp  — microseconds since Unix epoch
    state      — BT::NodeStatus int: 0=IDLE 1=RUNNING 2=SUCCESS 3=FAILURE 4=SKIPPED(→IDLE)

Control interface (called from server.py on incoming WebSocket messages):
  play(), pause(), seek(position_s), set_speed(speed)

Speed: the inter-event wall-clock delay is divided by self._speed, so 60× makes
a 1-hour log play back in ~1 minute. The _wakeup event interrupts the current
sleep immediately whenever speed, pause or seek state changes.

Seek correctness: seeking to position T folds all transitions from t=0..T to
derive the final known status of every node, emits that as one bt_delta per
node, then resumes streaming forward from T. No intermediate deltas are emitted
to the UI during the fold — only the final collapsed state.

Density histogram: computed once at load time. ~300 bins across duration_s.
Included in the first replay_status frame only (static; not repeated per-tick).
"""

import json
import sqlite3
import threading
import time
from pathlib import Path

from ros_monitor_bridge.btros_bridge import parse_tree_xml, _STATUS_MAP

_STATUS_INTERVAL_S  = 1.0 / 4.0    # emit replay_status at 4 Hz
_BLUEPRINT_REEMIT_S = 2.0          # re-broadcast blueprint so late-joining clients pick it up
_DENSITY_BINS       = 300          # histogram resolution for the scrubber density overlay


class BTReplay:
    """Replays a .btlog.db3 file as bt_blueprint / bt_delta / replay_status events."""

    def __init__(self, runtime, logger, db_path: str, loop: bool = False):
        self.runtime  = runtime
        self.logger   = logger
        self.db_path  = str(db_path)
        self.loop     = loop

        self._thread: threading.Thread | None = None
        self._running = False

        # Playback state — written by control API, read by replay thread.
        # Simple assignments are GIL-safe in CPython; _wakeup interrupts sleep.
        self._playing     = True
        self._speed: float        = 1.0
        self._seek_to_s: float | None = None
        self._wakeup      = threading.Event()

    # ── Public control API ────────────────────────────────────────────────────

    def play(self):
        self._playing = True
        self._wakeup.set()

    def pause(self):
        self._playing = False
        self._wakeup.set()

    def seek(self, position_s: float):
        self._seek_to_s = max(0.0, float(position_s))
        self._wakeup.set()

    def set_speed(self, speed: float):
        self._speed = max(0.1, min(float(speed), 120.0))
        self._wakeup.set()

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True, name="bt_replay")
        self._thread.start()
        self.logger.info(f"BTReplay: started — {self.db_path}")

    def stop(self):
        self._running = False
        self._wakeup.set()
        if self._thread:
            self._thread.join(timeout=3.0)
        self.logger.info("BTReplay: stopped")

    # ── Internal ──────────────────────────────────────────────────────────────

    def _dispatch(self, event: dict):
        self.runtime.dispatch_event(event)

    def _emit_status(self, position_s: float, duration_s: float, filename: str,
                     density: list[int] | None = None):
        data: dict = {
            "position_s": round(position_s, 3),
            "duration_s": round(duration_s, 3),
            "playing":    self._playing,
            "speed":      self._speed,
            "filename":   filename,
        }
        if density is not None:
            data["density"] = density
        self._dispatch({"type": "replay_status", "timestamp": time.time(), "data": data})

    @staticmethod
    def _compute_density(transitions: list, t0_us: int, duration_us: int,
                         n_bins: int = _DENSITY_BINS) -> list[int]:
        """One-time histogram of transition counts across the timeline."""
        counts = [0] * n_bins
        if not transitions or duration_us == 0:
            return counts
        bin_width = duration_us / n_bins
        for ts_us, *_ in transitions:
            b = min(int((ts_us - t0_us) / bin_width), n_bins - 1)
            counts[b] += 1
        return counts

    def _load(self) -> tuple:
        """Return (blueprint, transitions, duration_s, density, filename)."""
        con = sqlite3.connect(f"file:{self.db_path}?mode=ro", uri=True)
        try:
            row = con.execute(
                "SELECT session_id, xml_tree FROM Definitions ORDER BY session_id DESC LIMIT 1"
            ).fetchone()
            if row is None:
                raise ValueError("Definitions table is empty")
            session_id, xml_tree = row

            blueprint = parse_tree_xml(xml_tree)

            rows = con.execute(
                "SELECT timestamp, node_uid, state, extra_data FROM Transitions "
                "WHERE session_id = ? ORDER BY timestamp ASC",
                (session_id,),
            ).fetchall()
        finally:
            con.close()

        if not rows:
            raise ValueError("Transitions table is empty — run the demo for longer")

        transitions = [(ts, uid, _STATUS_MAP.get(st, "IDLE"), ed) for ts, uid, st, ed in rows]
        t0_us      = transitions[0][0]
        t_end_us   = transitions[-1][0]
        duration_s = (t_end_us - t0_us) / 1_000_000.0
        density    = self._compute_density(transitions, t0_us, t_end_us - t0_us)
        filename   = Path(self.db_path).name
        return blueprint, transitions, duration_s, density, filename

    def _seek_index(self, transitions: list, t0_us: int, position_s: float) -> int:
        """Binary search: index of first transition with timestamp >= position_s."""
        target_us = t0_us + int(position_s * 1_000_000)
        lo, hi = 0, len(transitions) - 1
        while lo < hi:
            mid = (lo + hi) // 2
            if transitions[mid][0] < target_us:
                lo = mid + 1
            else:
                hi = mid
        return lo

    def _emit_seek_snapshot(self, transitions: list, blueprint: dict,
                            tree_id: str, target_idx: int):
        """Fold transitions[0..target_idx) → emit one bt_delta per node with
        its final known status at that point. No intermediate events are sent.
        """
        known_uids = {n["id"] for n in blueprint["nodes"]}
        final_state: dict[int, str] = {}
        for i in range(target_idx):
            uid  = transitions[i][1]
            state = transitions[i][2]
            if uid in known_uids:
                final_state[uid] = state

        now = time.time()
        for uid, state in final_state.items():
            self._dispatch({
                "type": "bt_delta",
                "timestamp": now,
                "data": {"tree_id": tree_id, "id": uid, "state": state},
                "source": "replay",
            })

    def _interruptible_sleep(self, delay_s: float):
        """Sleep up to delay_s, wake early if _wakeup fires."""
        if delay_s > 0:
            self._wakeup.wait(timeout=delay_s)
            self._wakeup.clear()

    def _loop(self):
        try:
            blueprint, transitions, duration_s, density, filename = self._load()
        except Exception as exc:
            self.logger.error(f"BTReplay: cannot load {self.db_path}: {exc}")
            return

        tree_id = blueprint["tree_id"]
        t0_us   = transitions[0][0]
        self.logger.info(
            f"BTReplay: '{tree_id}' — {len(transitions):,} transitions, "
            f"{duration_s:.1f}s, {_DENSITY_BINS} density bins"
        )

        while self._running:
            # Broadcast the tree layout before the first delta.
            self._dispatch({
                "type": "bt_blueprint",
                "timestamp": time.time(),
                "data": blueprint,
                "source": "replay",
            })
            # First status frame carries the density histogram (static, one-time).
            self._emit_status(0.0, duration_s, filename, density=density)

            idx                = 0
            last_status_wall   = time.time()
            last_blueprint_wall = time.time()
            pending_seek       = False   # True after seek fold, suppresses next sleep

            while self._running and idx < len(transitions):

                # ── Handle seek ───────────────────────────────────────────────
                seek_target = self._seek_to_s
                if seek_target is not None:
                    self._seek_to_s = None
                    new_idx = self._seek_index(transitions, t0_us, seek_target)
                    # Emit the re-blueprint so the canvas is in a clean state.
                    self._dispatch({
                        "type": "bt_blueprint",
                        "timestamp": time.time(),
                        "data": blueprint,
                        "source": "replay",
                    })
                    # Fold all prior transitions → single state snapshot.
                    self._emit_seek_snapshot(transitions, blueprint, tree_id, new_idx)
                    idx          = new_idx
                    pending_seek = True   # skip the inter-event sleep this tick

                ts_us, node_uid, state, extra_data = transitions[idx]
                position_s = (ts_us - t0_us) / 1_000_000.0
                now        = time.time()

                # ── Periodic blueprint re-broadcast for late-joining clients ──
                if now - last_blueprint_wall >= _BLUEPRINT_REEMIT_S:
                    self._dispatch({
                        "type": "bt_blueprint",
                        "timestamp": now,
                        "data": blueprint,
                        "source": "replay",
                    })
                    last_blueprint_wall = now

                # ── Periodic scrubber position update ─────────────────────────
                if now - last_status_wall >= _STATUS_INTERVAL_S:
                    self._emit_status(position_s, duration_s, filename)
                    last_status_wall = now

                # ── Pause: block until play() or seek() wakes us ──────────────
                if not self._playing:
                    self._emit_status(position_s, duration_s, filename)
                    self._wakeup.wait()
                    self._wakeup.clear()
                    continue

                # ── Emit the node state change ────────────────────────────────
                now = time.time()
                self._dispatch({
                    "type": "bt_delta",
                    "timestamp": now,
                    "data": {"tree_id": tree_id, "id": node_uid, "state": state},
                    "source": "replay",
                })

                if extra_data:
                    try:
                        vars_ = json.loads(extra_data)
                        if vars_:
                            self._dispatch({
                                "type": "bt_blackboard",
                                "timestamp": now,
                                "data": {"tree_id": tree_id, "vars": vars_},
                                "source": "replay",
                            })
                    except (json.JSONDecodeError, TypeError):
                        pass

                idx += 1

                # ── Inter-event sleep scaled by speed ─────────────────────────
                if not pending_seek and idx < len(transitions):
                    gap_s = (transitions[idx][0] - ts_us) / 1_000_000.0 / self._speed
                    self._interruptible_sleep(gap_s)
                pending_seek = False

            if not self._running:
                break

            self._emit_status(duration_s, duration_s, filename)

            if self.loop:
                self.logger.info("BTReplay: looping")
                self._interruptible_sleep(0.5)
            else:
                self.logger.info("BTReplay: playback complete")
                # Stay alive; re-broadcast blueprint so any new client can render.
                self._playing = False
                while self._running:
                    self._emit_status(duration_s, duration_s, filename)
                    self._dispatch({
                        "type": "bt_blueprint",
                        "timestamp": time.time(),
                        "data": blueprint,
                        "source": "replay",
                    })
                    self._wakeup.wait(timeout=2.0)
                    self._wakeup.clear()
                    if self._seek_to_s is not None or self._playing:
                        self._playing = True
                        break
