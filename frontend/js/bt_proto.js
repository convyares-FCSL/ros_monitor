// Behavior Tree prototype (Phase 1 sandbox).
//
// Throwaway vanilla-JS sandbox to de-risk two things before any React work:
//   1. the top-to-bottom layout math (decorator caps, in-block services,
//      orthogonal wire routing) and
//   2. the live data pipeline (bt_blueprint handshake + bt_delta state stream
//      over the existing WebSocket on :8765).
//
// State is mutated directly on the SVG elements as deltas arrive — no
// framework, no virtual DOM — exactly the logic we later port into React.

const SVG_NS = 'http://www.w3.org/2000/svg';
const WS_URL = `ws://${window.location.hostname || 'localhost'}:8765`;

// --- Layout geometry --------------------------------------------------------
const NODE_W = 190;   // block width
const CAP_H = 22;     // decorator cap height
const SVC_H = 20;     // service row height
const CORE_H = 48;    // core task block height
const ROW_GAP = 184;  // vertical distance between depth levels
const GAP_X = 36;     // horizontal gap between sibling leaves

// Control-node glyphs (Unreal-style explicit symbols).
const SYMBOL = {
  Sequence: '→',          // →
  ReactiveSequence: '→*', // →*
  Fallback: '?',
  ReactiveFallback: '?*',
  Parallel: '⇉',          // ⇉
  SubTree: '▣',           // ▣
  Condition: '◆',         // ◆
};

const els = {
  connDot: document.getElementById('conn-dot'),
  connText: document.getElementById('conn-text'),
  viewport: document.getElementById('viewport'),
  wires: document.getElementById('wires'),
  nodes: document.getElementById('nodes'),
};

// Per-node DOM handles for direct mutation on delta.
//   id -> { core, incomingWire, flashTimer }
const nodeEls = new Map();
let currentVersion = null;

// --- Geometry helpers -------------------------------------------------------
function blockHeight(n) {
  return CAP_H * n.decorators.length + SVC_H * n.services.length + CORE_H;
}

// Tidy top-to-bottom layout: leaves take sequential x slots, internal nodes
// center over their children, depth maps to row. Returns id -> {x, y, w, h}.
function computeLayout(nodesById, rootId) {
  const pos = new Map();
  let nextLeafX = 0;

  function assign(id, depth) {
    const n = nodesById.get(id);
    const h = blockHeight(n);
    const y = depth * ROW_GAP;
    if (n.children.length === 0) {
      const x = nextLeafX;
      nextLeafX += NODE_W + GAP_X;
      pos.set(id, { x, y, w: NODE_W, h });
      return x + NODE_W / 2;
    }
    const centers = n.children.map((c) => assign(c, depth + 1));
    const center = (centers[0] + centers[centers.length - 1]) / 2;
    pos.set(id, { x: center - NODE_W / 2, y, w: NODE_W, h });
    return center;
  }
  assign(rootId, 0);
  return pos;
}

// Orthogonal wire: parent bottom-center -> down to a shared mid-rail ->
// across -> down to child top-center. No diagonals.
function orthogonalPath(parentPos, childPos) {
  const px = parentPos.x + parentPos.w / 2;
  const pBottom = parentPos.y + parentPos.h;
  const cx = childPos.x + childPos.w / 2;
  const cTop = childPos.y;
  const midY = pBottom + (cTop - pBottom) / 2;
  return `M ${px} ${pBottom} V ${midY} H ${cx} V ${cTop}`;
}

// --- SVG construction -------------------------------------------------------
function el(tag, attrs, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(node);
  return node;
}

function text(content, attrs, parent) {
  const t = el('text', attrs, parent);
  t.textContent = content;
  return t;
}

function buildTree(blueprint) {
  els.wires.replaceChildren();
  els.nodes.replaceChildren();
  nodeEls.clear();

  const nodesById = new Map(blueprint.nodes.map((n) => [n.id, n]));
  const pos = computeLayout(nodesById, blueprint.root_id);

  // Wires first (drawn behind nodes). One path per parent->child edge, keyed
  // by the CHILD id so a delta can light the wire feeding a RUNNING child.
  for (const n of blueprint.nodes) {
    for (const childId of n.children) {
      const path = el('path', {
        d: orthogonalPath(pos.get(n.id), pos.get(childId)),
        class: 'wire',
      }, els.wires);
      const handle = nodeEls.get(childId) || {};
      handle.incomingWire = path;
      nodeEls.set(childId, handle);
    }
  }

  // Node blocks: decorator caps (top) -> services -> core task block.
  for (const n of blueprint.nodes) {
    const p = pos.get(n.id);
    const g = el('g', { transform: `translate(${p.x}, ${p.y})` }, els.nodes);

    let offset = 0;
    for (const dec of n.decorators) {
      el('rect', { x: 0, y: offset, width: NODE_W, height: CAP_H, rx: 3, class: 'cap' }, g);
      text(decoratorLabel(dec), { x: 10, y: offset + CAP_H / 2 + 3.5, class: 'cap-label' }, g);
      offset += CAP_H;
    }
    for (const svc of n.services) {
      el('rect', { x: 8, y: offset, width: NODE_W - 16, height: SVC_H, rx: 3, class: 'svc' }, g);
      text(`⚙ ${svc.name} · ${svc.tick_ms}ms`,
        { x: 16, y: offset + SVC_H / 2 + 3.5, class: 'svc-label' }, g);
      offset += SVC_H;
    }

    const core = el('rect', {
      x: 0, y: offset, width: NODE_W, height: CORE_H, rx: 6,
      class: `core${n.category === 'subtree' ? ' subtree' : ''}`,
    }, g);

    const sym = SYMBOL[n.type] || (n.category === 'condition' ? SYMBOL.Condition : '');
    if (sym) {
      text(sym, { x: 14, y: offset + CORE_H / 2 + 6, class: 'node-symbol' }, g);
    }
    const textX = sym ? 36 : 14;
    text(n.name, { x: textX, y: offset + CORE_H / 2 - 2, class: 'node-name' }, g);
    text(n.type, { x: textX, y: offset + CORE_H / 2 + 13, class: 'node-type' }, g);

    const handle = nodeEls.get(n.id) || {};
    handle.core = core;
    nodeEls.set(n.id, handle);
  }

  fitView(pos);
}

function decoratorLabel(dec) {
  const port = dec.ports || {};
  if (dec.type === 'Timeout' && port.msec) return `⏱ Timeout ${port.msec / 1000}s`;
  if (dec.type === 'RetryUntilSuccessful' && port.num_attempts) return `↻ Retry ×${port.num_attempts}`;
  if (dec.type === 'Inverter') return '¬ Inverter';
  return dec.name;
}

// --- Live state binding -----------------------------------------------------
const TERMINAL = { SUCCESS: 'success', FAILURE: 'failure' };

function applyDelta(id, state) {
  const handle = nodeEls.get(id);
  if (!handle || !handle.core) return;

  // Core block: RUNNING persists (pulsing); SUCCESS/FAILURE flash ~150ms then
  // settle back to the default/idle look, matching the Unreal BT editor.
  handle.core.classList.remove('running', 'success', 'failure');
  if (handle.flashTimer) { clearTimeout(handle.flashTimer); handle.flashTimer = null; }

  if (state === 'RUNNING') {
    handle.core.classList.add('running');
  } else if (TERMINAL[state]) {
    handle.core.classList.add(TERMINAL[state]);
    handle.flashTimer = setTimeout(() => {
      handle.core.classList.remove('success', 'failure');
      handle.flashTimer = null;
    }, 150);
  }

  // Incoming wire animates only while this child is the live (RUNNING) path.
  if (handle.incomingWire) {
    handle.incomingWire.classList.toggle('running', state === 'RUNNING');
  }
}

// --- WebSocket --------------------------------------------------------------
function setConn(status, label) {
  els.connDot.className = `dot ${status}`;
  els.connText.textContent = label;
}

function connect() {
  setConn('', 'connecting…');
  let ws;
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    setConn('error', 'bad URL');
    return;
  }

  ws.onopen = () => setConn('connected', WS_URL);
  ws.onclose = () => { setConn('error', 'disconnected — retrying'); setTimeout(connect, 1500); };
  ws.onerror = () => setConn('error', 'error');
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === 'bt_blueprint') {
      // Idempotent: only rebuild when the structure version changes. Deltas
      // keep flowing onto the existing tree otherwise.
      if (msg.data.version !== currentVersion) {
        currentVersion = msg.data.version;
        buildTree(msg.data);
      }
    } else if (msg.type === 'bt_delta') {
      if (Array.isArray(msg.data.deltas)) {
        for (const d of msg.data.deltas) applyDelta(d.id, d.state);
      } else {
        applyDelta(msg.data.id, msg.data.state);
      }
    }
    // All other event types (graph_update, message_event, …) are ignored here.
  };
}

// --- Pan & zoom -------------------------------------------------------------
const view = { x: 80, y: 60, scale: 1 };
function applyView() {
  els.viewport.setAttribute('transform', `translate(${view.x}, ${view.y}) scale(${view.scale})`);
}

// Center the tree horizontally on first build.
function fitView(pos) {
  let minX = Infinity, maxX = -Infinity;
  for (const p of pos.values()) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + p.w); }
  const treeW = maxX - minX;
  view.x = (window.innerWidth - treeW * view.scale) / 2 - minX * view.scale;
  view.y = 80;
  applyView();
}

function initPanZoom() {
  const stage = document.getElementById('stage');
  let dragging = false, lastX = 0, lastY = 0;

  stage.addEventListener('pointerdown', (e) => {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    stage.classList.add('panning'); stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    view.x += e.clientX - lastX; view.y += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY; applyView();
  });
  const endDrag = (e) => { dragging = false; stage.classList.remove('panning'); try { stage.releasePointerCapture(e.pointerId); } catch {} };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.min(2.5, Math.max(0.25, view.scale * factor));
    // Zoom toward the cursor.
    view.x = e.clientX - (e.clientX - view.x) * (next / view.scale);
    view.y = e.clientY - (e.clientY - view.y) * (next / view.scale);
    view.scale = next; applyView();
  }, { passive: false });
}

applyView();
initPanZoom();
connect();
