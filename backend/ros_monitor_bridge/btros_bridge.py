"""Real Behavior Tree source (Option B): a Groot2 v4 client.

Connects to the `Groot2Publisher` running inside a BehaviorTree.CPP **v4**
executor (e.g. the mserve / hyfleet fleet projects), pulls the tree, polls
status, and forwards the SAME `bt_blueprint` / `bt_delta` events the Python
demo emitter produces — so the frontend is identical whether the data is
simulated or real.

Protocol (from BehaviorTree.CPP `groot2_protocol.h` / `groot2_publisher.cpp`):
  * Transport: ZeroMQ. The publisher binds a **ZMQ_REP** server on `port`
    (default 1667) and a ZMQ_PUB on `port + 1`. We act as a **ZMQ_REQ** client
    against the REP server and poll, rather than subscribing.
  * RequestHeader = protocol(uint8=2) + type(char) + unique_id(uint32),
    serialized with native memcpy → little-endian on x86/ARM. 6 bytes.
  * Reply is multipart: frame 0 = ReplyHeader (RequestHeader[6] + tree UUID[16]
    = 22 bytes), frame 1 = payload.
  * FULLTREE ('T') payload = the tree XML (with `_uid` metadata attributes).
  * STATUS ('S')  payload = per node: uint16 uid + uint8 status (3 bytes each).

NOTE: validated offline against synthetic v4 XML (see test_btros_parse.py). The
live ZMQ path + little-endian assumption need confirmation against a running
executor — point `--btros HOST:PORT` at one and watch the bridge logs.
"""

import re
import struct
import threading
import time
import xml.etree.ElementTree as ET

# --- Groot2 protocol --------------------------------------------------------
PROTOCOL_ID = 2

# Named executors and their default Groot2 REP ports. Each can be overridden
# via env var GROOT_PORT_<LABEL_UPPER> (e.g. GROOT_PORT_LIFECYCLE=1667).
GROOT_NODES: dict[str, int] = {
    'lifecycle':    1667,
    'system':       1669,
    'orchestrator': 1671,
    'compressor':   1673,
    'low_booster':  1675,
    'high_booster': 1677,
    'gas_manager':  1679,
    'dispenser':    1681,
}

DEFAULT_GROOT_PORT = next(iter(GROOT_NODES.values()))  # backward-compat alias

REQ_FULLTREE = ord('T')
REQ_STATUS = ord('S')
REQ_BLACKBOARD = ord('B')

_BB_POLL_PERIOD = 0.5  # 2 Hz — independent of the faster status poll

REPLY_HEADER_SIZE = 22  # protocol(1)+type(1)+unique_id(4)+tree_uuid(16)

# BT::NodeStatus -> our contract
_STATUS_MAP = {0: 'IDLE', 1: 'RUNNING', 2: 'SUCCESS', 3: 'FAILURE', 4: 'IDLE'}  # 4 = SKIPPED

# Built-in node classification (fallback when the XML has no <TreeNodesModel>).
_CONTROL_TAGS = {
    'Sequence', 'SequenceWithMemory', 'ReactiveSequence', 'Fallback',
    'ReactiveFallback', 'Parallel', 'ParallelAll', 'IfThenElse', 'WhileDoElse',
    'Switch2', 'Switch3', 'Switch4', 'Switch5', 'Switch6', 'ManualSelector',
}
_DECORATOR_TAGS = {
    'Inverter', 'ForceSuccess', 'ForceFailure', 'Repeat', 'RetryUntilSuccessful',
    'KeepRunningUntilFailure', 'Delay', 'Timeout', 'Precondition', 'RunOnce',
    'LoopDouble', 'LoopString', 'LoopInt', 'ConsumeQueue', 'SkipUnlessUpdated',
    'EntryUpdatedAction', 'WaitValueUpdate',
}
_RESERVED_ATTRS = {'_uid', '_fullpath', 'ID', 'name'}

# Explicit form <Action ID="X"/> — the tag is the category word, ID is the
# registration name. The compact form <X/> uses the registration name as tag.
_CATEGORY_TAGS = {'Action': 'action', 'Condition': 'condition',
                  'Control': 'control', 'Decorator': 'decorator', 'SubTree': 'subtree'}


def extract_bb_ids(xml_str: str) -> list[str]:
    """Return all <BehaviorTree ID="..."> values from a FULLTREE XML response.

    These are the subtree instance names generateBlackboardsDump accepts in its
    semicolon-delimited bb_list argument.
    """
    root = ET.fromstring(xml_str)
    return [bt.get('ID') for bt in root.findall('BehaviorTree') if bt.get('ID')]


def parse_blackboard_payload(payload: bytes) -> dict:
    """Decode a BLACKBOARD ZMQ reply (MessagePack) → {tree_id: {key: value}}.

    BT.CPP 4.9.0 serialises the reply with nlohmann::json::to_msgpack(), NOT
    as UTF-8 JSON text.  The outer map key is the BehaviorTree instance name;
    the inner map contains the blackboard entries from ExportBlackboardToJSON.
    Keys whose C++ type has no registered JsonExporter converter are silently
    absent from the inner map.

    Some newer BT.CPP versions wrap each entry as {value: X, type: "typename"}.
    This function flattens those to plain values and promotes bool entries.

    Returns an empty dict on any error (bad payload, missing msgpack library).
    """
    if not payload:
        return {}
    try:
        import msgpack  # noqa: PLC0415 — optional dep, imported lazily
        raw = msgpack.unpackb(payload, raw=False)
        if not isinstance(raw, dict):
            return {}
        result: dict = {}
        for tree_id, tree_vars in raw.items():
            if not isinstance(tree_vars, dict):
                continue
            flat: dict = {}
            for key, entry in tree_vars.items():
                if isinstance(entry, dict) and 'value' in entry and 'type' in entry:
                    val = entry['value']
                    if entry['type'] == 'bool' and not isinstance(val, bool):
                        try:
                            val = bool(int(val))
                        except (TypeError, ValueError):
                            pass
                    flat[key] = val
                else:
                    flat[key] = entry
            result[tree_id] = flat
        return result
    except Exception:  # noqa: BLE001
        return {}


def build_request(req_type, unique_id):
    """RequestHeader: protocol(1) + type(1) + unique_id(4), little-endian."""
    return struct.pack('<BBI', PROTOCOL_ID, req_type, unique_id)


def parse_status_payload(payload):
    """Decode a STATUS reply payload into {uid: status_str}."""
    out = {}
    for i in range(0, len(payload) - 2, 3):
        uid, status = struct.unpack_from('<HB', payload, i)
        out[uid] = _STATUS_MAP.get(status, 'IDLE')
    return out


# --- XML -> blueprint -------------------------------------------------------
def _parse_models(root):
    """name -> {'category': str, 'ports': {port_name: {'dir': str, 'type': str}}}."""
    models = {}
    model_root = root.find('TreeNodesModel')
    if model_root is None:
        return models
    cat_by_tag = {'Action': 'action', 'Condition': 'condition',
                  'Control': 'control', 'Decorator': 'decorator', 'SubTree': 'subtree'}
    for entry in model_root:
        category = cat_by_tag.get(entry.tag, 'action')
        node_id = entry.get('ID')
        if not node_id:
            continue
        ports = {}
        for port in entry:
            pname = port.get('name')
            if not pname:
                continue
            ptype = port.get('type', '')
            if port.tag == 'input_port':
                ports[pname] = {'dir': 'input', 'type': ptype}
            elif port.tag == 'output_port':
                ports[pname] = {'dir': 'output', 'type': ptype}
            elif port.tag == 'inout_port':
                ports[pname] = {'dir': 'input', 'type': ptype}
        models[node_id] = {'category': category, 'ports': ports}
    return models


def parse_tree_xml(xml_str):
    """Transform a Groot2 v4 tree XML into our bt_blueprint data dict.

    Decorators are folded into their target node as visual caps (matching the
    demo emitter's model), subtrees are resolved inline, and `_uid` attributes
    become node ids so STATUS deltas map directly.
    """
    root = ET.fromstring(xml_str)
    models = _parse_models(root)

    behavior_trees = {bt.get('ID'): bt for bt in root.findall('BehaviorTree')}
    main_id = root.get('main_tree_to_execute')
    if main_id not in behavior_trees:
        main_id = next(iter(behavior_trees), None)
    if main_id is None:
        raise ValueError('no <BehaviorTree> found in tree XML')

    nodes = []
    counter = [10_000]  # synthetic ids if _uid is ever missing

    def uid_of(elem):
        raw = elem.get('_uid')
        if raw is not None:
            return int(raw)
        counter[0] += 1
        return counter[0]

    def reg_name(elem):
        # Registration id: the ID attribute in explicit form, else the tag.
        if elem.tag in _CATEGORY_TAGS and elem.get('ID'):
            return elem.get('ID')
        return elem.tag

    def category_of(elem):
        if elem.tag in _CATEGORY_TAGS:
            return _CATEGORY_TAGS[elem.tag]
        if elem.tag in _CONTROL_TAGS:
            return 'control'
        if elem.tag in _DECORATOR_TAGS:
            return 'decorator'
        model = models.get(elem.tag)
        return model['category'] if model else 'action'

    def extract_ports(elem):
        model_ports = models.get(reg_name(elem), {}).get('ports', {})
        ports = {'input': {}, 'output': {}}
        for attr, value in elem.attrib.items():
            if attr in _RESERVED_ATTRS:
                continue
            info = model_ports.get(attr, 'input')
            direction = info['dir'] if isinstance(info, dict) else info
            ports[direction][attr] = value
        return {k: v for k, v in ports.items() if v}

    def decorator_caps(elem):
        return {
            'id': uid_of(elem),
            'name': elem.get('name', reg_name(elem)),
            'type': reg_name(elem),
            'ports': {a: v for a, v in elem.attrib.items() if a not in _RESERVED_ATTRS},
        }

    def process(elem, subtree_path):
        # Fold any decorator chain into caps; the first non-decorator is the core.
        caps = []
        cur = elem
        while category_of(cur) == 'decorator' and len(list(cur)) == 1:
            caps.append(decorator_caps(cur))
            cur = list(cur)[0]

        uid = uid_of(cur)
        category = category_of(cur)
        children_uids = []

        if category == 'subtree':
            sub_id = cur.get('ID')
            sub_bt = behavior_trees.get(sub_id)
            if sub_bt is not None and sub_id not in subtree_path and len(list(sub_bt)) == 1:
                children_uids.append(process(list(sub_bt)[0], subtree_path | {sub_id}))
        elif category == 'control':
            for child in list(cur):
                children_uids.append(process(child, subtree_path))

        nodes.append({
            'id': uid,
            'name': cur.get('name') or reg_name(cur),
            'type': reg_name(cur),
            'category': category,
            'children': children_uids,
            'decorators': caps,
            'services': [],            # BT.CPP has no Unreal-style services
            'ports': extract_ports(cur),
        })
        return uid

    main_bt = behavior_trees[main_id]
    root_id = process(list(main_bt)[0], {main_id})

    # Trace port remappings to find which blackboard keys map to bool ports.
    # Used by _session to coerce 0/1 integers → Python bool before dispatch.
    bool_keys: list = []
    for node in nodes:
        model_ports = models.get(node['type'], {}).get('ports', {})
        for port_name, info in model_ports.items():
            if not isinstance(info, dict) or info.get('type', '').lower() != 'bool':
                continue
            for direction in ('input', 'output'):
                val = node['ports'].get(direction, {}).get(port_name, '')
                m = _BB_KEY_RE.match(str(val).strip())
                if m and m.group(1) not in bool_keys:
                    bool_keys.append(m.group(1))

    return {'tree_id': main_id, 'version': 1, 'root_id': root_id, 'nodes': nodes,
            'bool_keys': bool_keys}


_BB_KEY_RE = re.compile(r'^\{(.+)\}$')


def skeleton_blackboard(blueprint: dict) -> dict:
    """Scan all port values in a blueprint for {key} remappings.

    Returns a dict of {key: None} for every discovered blackboard key.  The
    real values are not available from the Groot2 ZMQ protocol; this skeleton
    at least populates the inspector panel so the user can see which keys the
    tree uses.
    """
    keys: dict = {}
    for node in blueprint.get('nodes', []):
        ports = node.get('ports', {})
        for direction in ('input', 'output'):
            for val in (ports.get(direction) or {}).values():
                m = _BB_KEY_RE.match(str(val).strip())
                if m:
                    keys[m.group(1)] = None
    return keys


# --- Bridge thread ----------------------------------------------------------
class BTRosBridge:
    """Polls a Groot2 v4 executor and forwards bt_blueprint / bt_delta events."""

    def __init__(self, runtime, logger, host='localhost', port=DEFAULT_GROOT_PORT,
                 status_hz=15.0, blueprint_reemit_s=3.0, quiet=False, label=None):
        self.runtime = runtime
        self.logger = logger
        self.host = host
        self.port = port
        self.label = label
        self.status_period = 1.0 / status_hz
        self.blueprint_reemit_s = blueprint_reemit_s
        # quiet = auto-probe mode: don't warn on every failed connection attempt
        # (there may simply be no executor running). Connections still log.
        self.quiet = quiet
        self._thread = None
        self._running = False
        self._req_id = 0

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        if self.quiet:
            self.logger.info(f"Auto-probing for a Groot2 v4 executor on tcp://{self.host}:{self.port} …")
        else:
            self.logger.info(f"BTRos (Groot2 v4) bridge started → tcp://{self.host}:{self.port}")

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2.0)

    def _next_id(self):
        self._req_id = (self._req_id + 1) & 0xFFFFFFFF
        return self._req_id

    def _request(self, sock, req_type):
        sock.send(build_request(req_type, self._next_id()))
        frames = sock.recv_multipart()
        if len(frames) < 2 or len(frames[0]) < REPLY_HEADER_SIZE:
            return None
        return frames[1]  # payload frame (header is frames[0])

    def _request_blackboard(self, sock, bb_ids: list[str]) -> dict:
        """Send a 2-part BLACKBOARD request; return parsed {tree_id: {key: val}}.

        The REQ/REP socket is shared with the status poll — calls must never
        overlap.  Return an empty dict on timeout or any protocol error so the
        caller can skip cleanly.
        """
        bb_list = ';'.join(bb_ids).encode()
        sock.send_multipart([build_request(REQ_BLACKBOARD, self._next_id()), bb_list])
        frames = sock.recv_multipart()
        if len(frames) < 2 or len(frames[0]) < REPLY_HEADER_SIZE:
            return {}
        return parse_blackboard_payload(frames[1])

    def _loop(self):
        try:
            import zmq
        except ImportError:
            self.logger.error("BTRos bridge needs pyzmq — `pip install pyzmq`. Disabling.")
            return

        while self._running:
            ctx = zmq.Context.instance()
            sock = ctx.socket(zmq.REQ)
            sock.setsockopt(zmq.LINGER, 0)
            sock.setsockopt(zmq.RCVTIMEO, 1500)
            sock.setsockopt(zmq.SNDTIMEO, 1500)
            try:
                sock.connect(f"tcp://{self.host}:{self.port}")
                self._session(sock, zmq)
            except Exception as exc:  # noqa: BLE001 — keep retrying any failure
                if self.quiet:
                    self.logger.debug(f"BTRos probe: no executor on {self.host}:{self.port} ({exc})")
                else:
                    self.logger.warning(f"BTRos session error ({exc}); retrying in 2s")
            finally:
                sock.close()
            if self._running:
                time.sleep(2.0)

    def _emit_blueprint(self, blueprint, now):
        """Emit the tree blueprint for (re-)broadcast to clients."""
        self.runtime.dispatch_event({
            "type": "bt_blueprint", "timestamp": now, "data": blueprint,
            "source": self.label,
        })
        # Tell the frontend which ZMQ port this executor is on so it can match
        # the active tree to the correct ROS node's parameter set.
        self.runtime.dispatch_event({
            "type": "bt_executor_info", "timestamp": now,
            "data": {"host": self.host, "port": self.port,
                     "tree_id": blueprint.get("tree_id", "")},
            "source": self.label,
        })

    def _emit_skeleton(self, blueprint, now):
        """Emit a skeleton blackboard (all known port keys → null) so the UI
        shows which keys the tree uses before the first real poll returns.
        Null values render as '—' (unavailable) in the frontend.
        """
        skeleton = skeleton_blackboard(blueprint)
        if skeleton:
            self.runtime.dispatch_event({
                "type": "bt_blackboard", "timestamp": now,
                "data": {"tree_id": blueprint['tree_id'], "vars": skeleton},
                "source": self.label,
            })

    def _session(self, sock, zmq):
        # 1) Fetch + publish the tree structure.
        xml_payload = self._request(sock, REQ_FULLTREE)
        if not xml_payload:
            raise RuntimeError("no FULLTREE reply")
        xml_str = xml_payload.decode('utf-8')
        blueprint = parse_tree_xml(xml_str)
        bool_keys = set(blueprint.pop('bool_keys', []))
        tree_id = blueprint['tree_id']
        # All BehaviorTree IDs in the XML — sent as the bb_list for BLACKBOARD requests.
        bb_ids = extract_bb_ids(xml_str)

        # Include decorator uids so their status deltas aren't filtered out.
        # Decorators (Precondition, Timeout, Retry, etc.) get their own uid in
        # the Groot2 STATUS payload and need to be tracked independently.
        known_ids: set[int] = set()
        for n in blueprint['nodes']:
            known_ids.add(n['id'])
            for dec in n.get('decorators', []):
                known_ids.add(dec['id'])

        now = time.time()
        self._emit_blueprint(blueprint, now)
        self._emit_skeleton(blueprint, now)
        prefix = f"[{self.label}] " if self.label else ""
        self.logger.info(
            f"BTRos: {prefix}tree '{blueprint['tree_id']}' with {len(known_ids)} nodes"
            f" | blackboard IDs: {bb_ids}"
        )

        last_status = {}
        last_blueprint = now
        last_blackboard = 0.0  # force immediate first poll

        # 2) Poll status and blackboard; emit deltas on change.
        # Both share the single REQ socket — requests are strictly sequential.
        while self._running:
            now = time.time()
            if now - last_blueprint >= self.blueprint_reemit_s:
                self._emit_blueprint(blueprint, now)
                self._emit_skeleton(blueprint, now)
                last_blueprint = now

            # Blackboard poll at 2 Hz, interleaved with the faster status poll.
            if bb_ids and now - last_blackboard >= _BB_POLL_PERIOD:
                try:
                    bb_data = self._request_blackboard(sock, bb_ids)
                except Exception:  # noqa: BLE001 — treat any ZMQ error as empty
                    bb_data = {}
                if bb_data:
                    # Merge all subtree blackboards into one flat snapshot.
                    # Start with skeleton nulls so silently-dropped keys (types
                    # with no registered JsonExporter) show as '—' not zero.
                    merged: dict = dict(skeleton_blackboard(blueprint))
                    for tree_vars in bb_data.values():
                        if isinstance(tree_vars, dict):
                            merged.update(tree_vars)
                    # Coerce known-bool keys: BT.CPP 4.x exports bool as 0/1 int.
                    # Promoting to Python bool → JSON true/false → JS boolean so
                    # the frontend renders them as "true"/"false" not "0"/"1".
                    for key in bool_keys:
                        v = merged.get(key)
                        if v is not None and not isinstance(v, bool):
                            try:
                                merged[key] = bool(int(v))
                            except (TypeError, ValueError):
                                pass
                    self.runtime.dispatch_event({
                        "type": "bt_blackboard", "timestamp": now,
                        "data": {
                            "tree_id": tree_id, "vars": merged,
                            "real": True,  # authoritative — frontend should replace, not merge
                        },
                        "source": self.label,
                    })
                last_blackboard = now

            payload = self._request(sock, REQ_STATUS)
            if payload is None:
                raise RuntimeError("no STATUS reply")
            status = parse_status_payload(payload)
            for uid, state in status.items():
                if uid in known_ids and last_status.get(uid) != state:
                    self.runtime.dispatch_event({
                        "type": "bt_delta", "timestamp": now,
                        "data": {"tree_id": tree_id, "id": uid, "state": state},
                        "source": self.label,
                    })
            last_status = status
            time.sleep(self.status_period)
