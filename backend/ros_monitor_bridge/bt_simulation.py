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


class TreeSpec:
    """A demo tree the emitter can run: structure + per-cycle leaf behaviour."""

    def __init__(self, tree_id, version, root_id, nodes, make_leaves):
        self.tree_id = tree_id
        self.version = version
        self.root_id = root_id
        self.nodes = nodes
        self.nodes_by_id = {n["id"]: n for n in nodes}
        self.make_leaves = make_leaves


def blueprint_event(spec, now):
    """The one-time (re-emitted) structure handshake for one tree."""
    return {
        "type": "bt_blueprint",
        "timestamp": now,
        "data": {
            "tree_id": spec.tree_id,
            "version": spec.version,
            "root_id": spec.root_id,
            "nodes": spec.nodes,
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

    def __init__(self, nodes_by_id, root_id, make_leaves, on_delta):
        self._nodes = nodes_by_id
        self._root_id = root_id
        self._make_leaves = make_leaves
        self._on_delta = on_delta
        self._status = {nid: IDLE for nid in nodes_by_id}
        # Per-control-node child cursor for "with memory" sequences/fallbacks.
        self._cursor = {}
        self._cycle = 0
        self._leaves = make_leaves(0)

    # -- status bookkeeping --
    def _set(self, node_id, status):
        if self._status.get(node_id) != status:
            self._status[node_id] = status
            self._on_delta(node_id, status)

    def _reset_subtree(self, node_id):
        node = self._nodes[node_id]
        self._set(node_id, IDLE)
        if node_id in self._leaves:
            self._leaves[node_id].reset()
        for child in node["children"]:
            self._reset_subtree(child)

    # -- tick dispatch --
    def _tick(self, node_id):
        node = self._nodes[node_id]
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
        status = self._tick(self._root_id)
        if status in (SUCCESS, FAILURE):
            # Cycle finished: reset everything to IDLE and rescript for variety.
            self._cycle += 1
            self._leaves = self._make_leaves(self._cycle)
            self._cursor.clear()
            self._reset_subtree(self._root_id)
        return status


# --- Tree 1: hydrogen dispenser (leaf behaviour + blackboard) ---------------
def _hydrogen_leaves(cycle):
    # Vehicle shows up after the guard settles; one cycle in three has a
    # transient pressure failure to exercise the FAILURE flash + recovery.
    pressure_ok = FAILURE if (cycle % 3 == 2) else SUCCESS
    return {
        2: _Leaf(0, SUCCESS),    # IsEmergencyClear
        3: _Leaf(2, SUCCESS),    # EnterSafeState (only if guard trips)
        11: _Leaf(0, SUCCESS),   # IsVehiclePresent
        12: _Leaf(3, SUCCESS),   # Authenticate
        13: _Leaf(4, SUCCESS),   # Precool
        15: _Leaf(0, pressure_ok),  # IsPressureNominal
        16: _Leaf(6, SUCCESS),   # Dispense
        17: _Leaf(1, FAILURE),   # FinalizeReceipt (Inverter -> SUCCESS)
        22: _Leaf(2, SUCCESS),   # PublishMetrics
        23: _Leaf(1, SUCCESS),   # RecordSession
    }


# --- Tree 2: battery pack charger (a second, smaller tree) -------------------
_CHARGE_NODES = [
    {"id": 200, "name": "ChargeManager", "type": "Sequence", "category": "control",
     "children": [201, 202], "decorators": [], "services": [], "ports": {}},
    {"id": 201, "name": "IsConnected", "type": "Condition", "category": "condition",
     "children": [], "decorators": [], "services": [],
     "ports": {"input": {"port": "{charger_port}"}}},
    {"id": 202, "name": "ChargeCycle", "type": "Sequence", "category": "control",
     "children": [203, 204, 205], "decorators": [], "services": [], "ports": {}},
    {"id": 203, "name": "IsTempSafe", "type": "Condition", "category": "condition",
     "children": [], "decorators": [],
     "services": [{"id": 231, "name": "ReadTemp", "tick_ms": 100}],
     "ports": {"input": {"max_c": "{temp_limit}"}}},
    {"id": 204, "name": "RampCurrent", "type": "Action", "category": "action",
     "children": [],
     "decorators": [{"id": 241, "name": "Timeout", "type": "Timeout", "ports": {"msec": 60000}}],
     "services": [{"id": 242, "name": "MonitorCurrent", "tick_ms": 50}],
     "ports": {"input": {"target_a": "{charge_current}"}, "output": {"soc": "{state_of_charge}"}}},
    {"id": 205, "name": "HoldVoltage", "type": "Action", "category": "action",
     "children": [], "decorators": [], "services": [],
     "ports": {"input": {"target_v": "{pack_voltage}"}}},
]


def _charge_leaves(cycle):
    temp_ok = FAILURE if (cycle % 5 == 4) else SUCCESS   # occasional thermal trip
    return {
        201: _Leaf(0, SUCCESS),    # IsConnected
        203: _Leaf(0, temp_ok),    # IsTempSafe
        204: _Leaf(5, SUCCESS),    # RampCurrent
        205: _Leaf(3, SUCCESS),    # HoldVoltage
    }


HYDROGEN_SPEC = TreeSpec(_TREE_ID, BLUEPRINT_VERSION, _ROOT_ID, _NODES, _hydrogen_leaves)
CHARGE_SPEC = TreeSpec("PackCharger", 1, 200, _CHARGE_NODES, _charge_leaves)
_DEFAULT_SPECS = [HYDROGEN_SPEC, CHARGE_SPEC]


class BTSimulation:
    """Background thread: ticks one or more demo trees and emits their events."""

    def __init__(self, runtime, logger, specs=None):
        self.runtime = runtime
        self.logger = logger
        self.specs = specs if specs is not None else _DEFAULT_SPECS
        self._thread = None
        self._running = False

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        names = ", ".join(s.tree_id for s in self.specs)
        self.logger.info(f"Behavior Tree simulation thread started ({names}).")

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2.0)

    def _emit_delta(self, tree_id):
        def emit(node_id, status):
            self.runtime.dispatch_event({
                "type": "bt_delta",
                "timestamp": time.time(),
                "data": {"tree_id": tree_id, "id": node_id, "state": status},
            })
        return emit

    def _loop(self):
        engines = [
            (spec, BTEngine(spec.nodes_by_id, spec.root_id, spec.make_leaves,
                            self._emit_delta(spec.tree_id)))
            for spec in self.specs
        ]
        last_blueprint = 0.0
        while self._running:
            now = time.time()
            if now - last_blueprint >= BLUEPRINT_REEMIT_S:
                for spec, _ in engines:
                    self.runtime.dispatch_event(blueprint_event(spec, now))
                last_blueprint = now
            for _, engine in engines:
                engine.tick_root()
            time.sleep(TICK_PERIOD_S)
