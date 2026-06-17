#!/usr/bin/env python3
"""gen_bt_fixture.py — Synthetic long-duration .btlog.db3 for replay testing.

Generates N transitions across a simulated run (default 1 hour) using the
exact BT.CPP 4.9.0 SqliteLogger schema, with deliberate activity clusters
that produce visible density spikes in the overlay.

Usage:
  python3 scripts/gen_bt_fixture.py
  python3 scripts/gen_bt_fixture.py out.btlog.db3 --rows 200000 --duration-s 7200
  python3 scripts/gen_bt_fixture.py --rows 50000 --duration-s 1800
"""

import argparse
import datetime
import random
import sqlite3
import sys
import time

# A realistic multi-node tree matching the ChargeManager demo structure,
# with _uid attributes so parse_tree_xml() can map status deltas.
TREE_XML = """\
<root BTCPP_format="4">
  <BehaviorTree ID="ChargeManager">
    <Sequence name="root" _uid="1">
      <IsConnected _uid="2" port="DC-FAST-1"/>
      <ReactiveSequence _uid="3" name="charge_loop">
        <CheckPressure _uid="4"/>
        <CheckTemperature _uid="5"/>
        <Fallback _uid="6" name="valve_or_abort">
          <ControlValve _uid="7"/>
          <AbortCharge _uid="8"/>
        </Fallback>
        <Timeout _uid="9" msec="60000">
          <RampCurrent _uid="10" target_a="32.0" soc="{state_of_charge}"/>
        </Timeout>
        <HoldVoltage _uid="11" target_v="400.0"/>
      </ReactiveSequence>
    </Sequence>
  </BehaviorTree>
</root>"""

NODE_UIDS  = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]
BT_STATES  = [0, 1, 2, 3]   # IDLE, RUNNING, SUCCESS, FAILURE

# Three burst windows: each covers 10% of the timeline.
# These should be clearly visible as tall bars in the density overlay.
BURST_WINDOWS = [(0.10, 0.20), (0.47, 0.57), (0.80, 0.90)]


def make_timestamps(rng, n_rows, start_us, duration_us):
    """Return sorted, deduplicated timestamps split 70/30 burst/uniform."""
    n_burst   = int(n_rows * 0.70)
    n_uniform = n_rows - n_burst

    raw = []
    for _ in range(n_burst):
        lo, hi = rng.choice(BURST_WINDOWS)
        t = rng.uniform(lo, hi)
        raw.append(start_us + int(t * duration_us))
    for _ in range(n_uniform):
        raw.append(start_us + int(rng.random() * duration_us))

    raw.sort()

    # Deduplicate (PRIMARY KEY constraint on timestamp).
    deduped = []
    prev = -1
    for ts in raw:
        if ts <= prev:
            ts = prev + 1
        deduped.append(ts)
        prev = ts
    return deduped


def write_db(path, timestamps, session_date):
    con = sqlite3.connect(path)
    con.executescript("""
        CREATE TABLE IF NOT EXISTS Definitions (
            session_id INTEGER PRIMARY KEY AUTOINCREMENT,
            date       TEXT NOT NULL,
            xml_tree   TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS Nodes (
            session_id INTEGER NOT NULL,
            fullpath   VARCHAR,
            node_uid   INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS Transitions (
            timestamp  INTEGER PRIMARY KEY NOT NULL,
            session_id INTEGER NOT NULL,
            node_uid   INTEGER NOT NULL,
            duration   INTEGER,
            state      INTEGER NOT NULL,
            extra_data VARCHAR
        );
    """)

    cur = con.execute(
        "INSERT INTO Definitions (date, xml_tree) VALUES (?, ?)",
        (session_date, TREE_XML),
    )
    session_id = cur.lastrowid

    rng = random.Random(0)  # fixed for reproducibility of state values

    batch = [
        (ts, session_id, rng.choice(NODE_UIDS), None, rng.choice(BT_STATES), "")
        for ts in timestamps
    ]
    con.executemany(
        "INSERT INTO Transitions (timestamp, session_id, node_uid, duration, state, extra_data)"
        " VALUES (?,?,?,?,?,?)",
        batch,
    )
    con.commit()
    con.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("output", nargs="?", default="bt_fixture_1h.btlog.db3",
                        help="Output .btlog.db3 path (default: bt_fixture_1h.btlog.db3)")
    parser.add_argument("--rows", type=int, default=100_000,
                        help="Number of transition rows (default: 100 000)")
    parser.add_argument("--duration-s", type=int, default=3600,
                        help="Simulated run duration in seconds (default: 3600)")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    start_us    = int(time.time() * 1_000_000)
    duration_us = args.duration_s * 1_000_000

    print(f"Generating {args.rows:,} transitions over {args.duration_s}s "
          f"({args.duration_s / 3600:.2f}h)…")

    t0 = time.perf_counter()
    timestamps = make_timestamps(rng, args.rows, start_us, duration_us)
    session_date = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    write_db(args.output, timestamps, session_date)
    elapsed = time.perf_counter() - t0

    actual = len(timestamps)
    print(f"Written {actual:,} rows to {args.output!r}  ({elapsed:.2f}s)")
    print(f"Burst windows (70% of events): "
          + ", ".join(f"{int(lo*100)}%–{int(hi*100)}%" for lo, hi in BURST_WINDOWS))
    print(f"Density overlay should show tall spikes at those positions.")


if __name__ == "__main__":
    main()
