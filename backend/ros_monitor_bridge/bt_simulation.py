"""Behavior Tree demo emitter (Option A data source).

Drives the `bt_blueprint` / `bt_delta` contract from a hardcoded, realistic
BehaviorTree.CPP v4-shaped tree so the frontend layout + live pipeline can be
built and de-risked with no ROS, no C++, and no ZeroMQ. A real source
(`btros_bridge.py`, a Groot2 v4 client against the mserve/hyfleet executors)
can later emit the identical events with no frontend change.

The tree mirrors a hydrogen dispenser control flow: a reactive safety guard,
a refuel subtree with stacked decorators (Timeout + Retry) and per-node
services, and a parallel telemetry subtree. The tick engine implements enough
of BT.CPP v4 control-node semantics (Sequence/Fallback/Parallel with memory,
Inverter decorator) to produce a genuinely live, structurally-correct stream
of state transitions.

Events are pushed through the same `runtime.dispatch_event()` path as every
other event, so the existing single WebSocket broadcaster relays them to all
clients. The blueprint is re-emitted periodically (like `graph_update`) so a
browser that connects mid-stream still receives the structure.
"""

import threading
import time

IDLE = "IDLE"
RUNNING = "RUNNING"
SUCCESS = "SUCCESS"
FAILURE = "FAILURE"

TICK_PERIOD_S = 0.4          # one engine tick
BLUEPRINT_REEMIT_S = 3.0     # re-broadcast structure for late-joining clients
BLUEPRINT_VERSION = 1        # bump if the static structure below changes


# --- Static tree structure (the Blueprint) ----------------------------------
# Each node: id, name, type, category, children (ids), decorators (caps),
# services (in-block), ports. Decorators render as stacked caps on top of the
# node block; services render inside the block. This is exactly the JSON the
# `bt_blueprint` event ships.
_TREE_ID = "HydrogenDispenser"
_ROOT_ID = 0

_NODES = [
    {
        "id": 0, "name": "DispenserMain", "type": "Sequence",
        "category": "control", "children": [1, 10, 20],
        "decorators": [], "services": [], "ports": {},
    },

    # --- Safety guard (reactive fallback) ---
    {
        "id": 1, "name": "SafetyGuard", "type": "Fallback",
        "category": "control", "children": [2, 3],
        "decorators": [], "services": [], "ports": {},
    },
    {
        "id": 2, "name": "IsEmergencyClear", "type": "Condition",
        "category": "condition", "children": [],
        "decorators": [], "services": [],
        "ports": {"input": {"estop_topic": "{estop_state}"}},
    },
    {
        "id": 3, "name": "EnterSafeState", "type": "Action",
        "category": "action", "children": [],
        "decorators": [], "services": [],
        "ports": {"output": {"safe_ack": "{safe_state_ack}"}},
    },

    # --- Refuel cycle (subtree) ---
    {
        "id": 10, "name": "RefuelCycle", "type": "SubTree",
        "category": "subtree", "children": [11, 12, 13, 14, 17],
        "decorators": [], "services": [], "ports": {},
    },
    {
        "id": 11, "name": "IsVehiclePresent", "type": "Condition",
        "category": "condition", "children": [],
        "decorators": [], "services": [],
        "ports": {"input": {"bay": "{bay_id}"}},
    },
    {
        "id": 12, "name": "Authenticate", "type": "Action",
        "category": "action", "children": [],
        # Two stacked decorator caps on one block (nested decorators).
        "decorators": [
            {"id": 121, "name": "RetryUntilSuccessful", "type": "RetryUntilSuccessful",
             "ports": {"num_attempts": 3}},
            {"id": 122, "name": "Timeout", "type": "Timeout", "ports": {"msec": 8000}},
        ],
        "services": [{"id": 123, "name": "Heartbeat", "tick_ms": 200}],
        "ports": {"input": {"vehicle_id": "{vehicle_id}"},
                  "output": {"session": "{session_token}"}},
    },
    {
        "id": 13, "name": "Precool", "type": "Action",
        "category": "action", "children": [],
        "decorators": [
            {"id": 131, "name": "Timeout", "type": "Timeout", "ports": {"msec": 30000}},
        ],
        "services": [{"id": 132, "name": "MonitorTemp", "tick_ms": 100}],
        "ports": {"input": {"target_c": "{precool_target}"},
                  "output": {"temp_c": "{nozzle_temp}"}},
    },

    # --- Dispense control (reactive sequence with a guard condition) ---
    {
        "id": 14, "name": "DispenseControl", "type": "ReactiveSequence",
        "category": "control", "children": [15, 16],
        "decorators": [], "services": [], "ports": {},
    },
    {
        "id": 15, "name": "IsPressureNominal", "type": "Condition",
        "category": "condition", "children": [],
        "decorators": [],
        "services": [{"id": 151, "name": "ReadPressure", "tick_ms": 50}],
        "ports": {"input": {"max_bar": "{pressure_limit}"}},
    },
    {
        "id": 16, "name": "Dispense", "type": "Action",
        "category": "action", "children": [],
        "decorators": [
            {"id": 161, "name": "Timeout", "type": "Timeout", "ports": {"msec": 120000}},
        ],
        # Two services in one block.
        "services": [
            {"id": 162, "name": "MonitorPressure", "tick_ms": 50},
            {"id": 163, "name": "LogFlow", "tick_ms": 500},
        ],
        "ports": {"input": {"target_kg": "{fill_target}"},
                  "output": {"dispensed_kg": "{dispensed}"}},
    },
    {
        "id": 17, "name": "FinalizeReceipt", "type": "Action",
        "category": "action", "children": [],
        "decorators": [
            {"id": 171, "name": "Inverter", "type": "Inverter", "ports": {}},
        ],
        "services": [], "ports": {"input": {"session": "{session_token}"}},
    },

    # --- Telemetry (subtree, parallel) ---
    {
        "id": 20, "name": "Telemetry", "type": "SubTree",
        "category": "subtree", "children": [21],
        "decorators": [], "services": [], "ports": {},
    },
    {
        "id": 21, "name": "PublishStatus", "type": "Parallel",
        "category": "control", "children": [22, 23],
        "decorators": [], "services": [], "ports": {"success_count": 2},
    },
    {
        "id": 22, "name": "PublishMetrics", "type": "Action",
        "category": "action", "children": [],
        "decorators": [],
        "services": [{"id": 221, "name": "Tick", "tick_ms": 100}],
        "ports": {"input": {"topic": "{metrics_topic}"}},
    },
    {
        "id": 23, "name": "RecordSession", "type": "Action",
        "category": "action", "children": [],
        "decorators": [], "services": [],
        "ports": {"output": {"record_id": "{record_id}"}},
    },
]

_NODE_BY_ID = {n["id"]: n for n in _NODES}


def blueprint_event(now):
    """The one-time (re-emitted) structure handshake."""
    return {
        "type": "bt_blueprint",
        "timestamp": now,
        "data": {
            "tree_id": _TREE_ID,
            "version": BLUEPRINT_VERSION,
            "root_id": _ROOT_ID,
            "nodes": _NODES,
        },
    }


# --- Leaf behaviours --------------------------------------------------------
# Conditions resolve immediately; actions dwell in RUNNING for a few ticks so
# the live path is visible, then return an outcome. A small script drives
# variety across cycles (vehicle arrives, a pressure dip causes a FAILURE).

class _Leaf:
    """Scripted behaviour for an action/condition node."""

    def __init__(self, running_ticks=0, outcome=SUCCESS):
        self.running_ticks = running_ticks
        self.outcome = outcome
        self._remaining = 0
        self._active = False

    def start(self):
        self._remaining = self.running_ticks
        self._active = True

    def tick(self):
        if not self._active:
            self.start()
        if self._remaining > 0:
            self._remaining -= 1
            return RUNNING
        self._active = False
        return self.outcome

    def reset(self):
        self._remaining = 0
        self._active = False


class BTEngine:
    """Minimal BT.CPP v4-style executor over the static tree.

    Implements Sequence/ReactiveSequence/Fallback/Parallel and the Inverter
    decorator with enough fidelity to emit a realistic delta stream. Emits a
    delta only when a node's status actually changes.
    """

    def __init__(self, on_delta):
        self._on_delta = on_delta
        self._status = {n["id"]: IDLE for n in _NODES}
        # Per-control-node child cursor for "with memory" sequences/fallbacks.
        self._cursor = {}
        self._cycle = 0
        self._leaves = self._build_leaves()

    def _build_leaves(self):
        cyc = self._cycle
        # Vehicle shows up after the guard settles; one cycle in three has a
        # transient pressure failure to exercise the FAILURE flash + recovery.
        vehicle_present = SUCCESS
        pressure_ok = FAILURE if (cyc % 3 == 2) else SUCCESS
        return {
            2: _Leaf(0, SUCCESS),               # IsEmergencyClear
            3: _Leaf(2, SUCCESS),               # EnterSafeState (only if guard trips)
            11: _Leaf(0, vehicle_present),      # IsVehiclePresent
            12: _Leaf(3, SUCCESS),              # Authenticate
            13: _Leaf(4, SUCCESS),              # Precool
            15: _Leaf(0, pressure_ok),          # IsPressureNominal
            16: _Leaf(6, SUCCESS),              # Dispense
            17: _Leaf(1, FAILURE),              # FinalizeReceipt (Inverter -> SUCCESS)
            22: _Leaf(2, SUCCESS),              # PublishMetrics
            23: _Leaf(1, SUCCESS),              # RecordSession
        }

    # -- status bookkeeping --
    def _set(self, node_id, status):
        if self._status.get(node_id) != status:
            self._status[node_id] = status
            self._on_delta(node_id, status)

    def _reset_subtree(self, node_id):
        node = _NODE_BY_ID[node_id]
        self._set(node_id, IDLE)
        if node_id in self._leaves:
            self._leaves[node_id].reset()
        for child in node["children"]:
            self._reset_subtree(child)

    # -- tick dispatch --
    def _tick(self, node_id):
        node = _NODE_BY_ID[node_id]
        ntype = node["type"]
        if not node["children"]:                       # leaf
            status = self._leaves[node_id].tick()
            status = self._apply_decorators(node, status)
            self._set(node_id, status)
            return status

        if ntype in ("Sequence", "SubTree"):
            status = self._tick_sequence(node, reactive=False)
        elif ntype == "ReactiveSequence":
            status = self._tick_sequence(node, reactive=True)
        elif ntype == "Fallback":
            status = self._tick_fallback(node)
        elif ntype == "Parallel":
            status = self._tick_parallel(node)
        else:                                          # unknown control -> sequence
            status = self._tick_sequence(node, reactive=False)

        status = self._apply_decorators(node, status)
        self._set(node_id, status)
        return status

    def _apply_decorators(self, node, status):
        # Visual caps share the block, but Inverter flips the reported outcome.
        for dec in node.get("decorators", []):
            if dec["type"] == "Inverter":
                if status == SUCCESS:
                    status = FAILURE
                elif status == FAILURE:
                    status = SUCCESS
        return status

    def _tick_sequence(self, node, reactive):
        nid = node["id"]
        children = node["children"]
        start = 0 if reactive else self._cursor.get(nid, 0)
        for i in range(start, len(children)):
            child = children[i]
            cs = self._tick(child)
            if cs == RUNNING:
                if not reactive:
                    self._cursor[nid] = i
                # Children after the running one have not run this pass.
                for later in children[i + 1:]:
                    self._reset_subtree(later)
                return RUNNING
            if cs == FAILURE:
                self._cursor[nid] = 0
                for later in children[i + 1:]:
                    self._reset_subtree(later)
                return FAILURE
            # SUCCESS -> continue to next child
        self._cursor[nid] = 0
        return SUCCESS

    def _tick_fallback(self, node):
        nid = node["id"]
        children = node["children"]
        for i, child in enumerate(children):
            cs = self._tick(child)
            if cs == RUNNING:
                for later in children[i + 1:]:
                    self._reset_subtree(later)
                return RUNNING
            if cs == SUCCESS:
                self._cursor[nid] = 0
                for later in children[i + 1:]:
                    self._reset_subtree(later)
                return SUCCESS
            # FAILURE -> try next child
        return FAILURE

    def _tick_parallel(self, node):
        threshold = node.get("ports", {}).get("success_count", len(node["children"]))
        results = [self._tick(c) for c in node["children"]]
        if results.count(SUCCESS) >= threshold:
            return SUCCESS
        if results.count(FAILURE) > (len(node["children"]) - threshold):
            return FAILURE
        return RUNNING

    def tick_root(self):
        status = self._tick(_ROOT_ID)
        if status in (SUCCESS, FAILURE):
            # Cycle finished: reset everything to IDLE and rescript for variety.
            self._cycle += 1
            self._leaves = self._build_leaves()
            self._cursor.clear()
            self._reset_subtree(_ROOT_ID)
        return status


class BTSimulation:
    """Background thread: ticks the engine and emits blueprint + deltas."""

    def __init__(self, runtime, logger):
        self.runtime = runtime
        self.logger = logger
        self._thread = None
        self._running = False

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        self.logger.info("Behavior Tree simulation thread started.")

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2.0)

    def _emit_delta(self, node_id, status):
        self.runtime.dispatch_event({
            "type": "bt_delta",
            "timestamp": time.time(),
            "data": {"id": node_id, "state": status},
        })

    def _loop(self):
        engine = BTEngine(self._emit_delta)
        last_blueprint = 0.0
        while self._running:
            now = time.time()
            if now - last_blueprint >= BLUEPRINT_REEMIT_S:
                self.runtime.dispatch_event(blueprint_event(now))
                last_blueprint = now
            engine.tick_root()
            time.sleep(TICK_PERIOD_S)
