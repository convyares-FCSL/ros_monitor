# Project Execution Plan — Behavior Tree Visualizer & Multi-Page Dashboard

> Status: **PLAN ONLY — awaiting approval. No app code written yet.**
> Scope: add an Unreal-style Behavior Tree view to the ROS 2 visualizer, and
> restructure `frontend_new/` into a multi-page app around the existing 3D view.

---

## Context

The repo is a working ROS 2 3D network visualizer: a Python `rclpy` + `websockets`
bridge ([backend/ros_monitor_bridge/](backend/ros_monitor_bridge/)) that serves two
frontends — a vanilla JS reference ([frontend/](frontend/)) and a production React 18
+ TS + Vite + Tailwind app ([frontend_new/](frontend_new/)). Both share one WebSocket
event contract on port `8765`; static files are served on `7260`.

We want a custom Behavior Tree (BT) visualizer (BehaviorTree.CPP v4 semantics) added
as a first-class view, plus a multi-page shell so the dashboard can grow beyond the
single 3D scene. This plan de-risks the layout math and live pipeline first, then
restructures the React app, then ports the proven prototype in.

### Two findings that change the prompt's assumptions

1. **There is no C++ / BT.CPP / ZeroMQ / Groot source anywhere in the repo.** The
   `PublisherZMQ` question is therefore moot — there is nothing to enable it *in*.
   The existing "simulation" is the Python `SimulatedBridge`
   ([simulation.py](backend/ros_monitor_bridge/simulation.py)), not a C++ Groot
   publisher. **We must create the BT data source.** See "BT data source" below for
   the two options and the recommendation.
2. **`frontend_new/` is already a TS-native rewrite, not a thin shell.** The 3D view
   is fully implemented in TypeScript ([three/SceneManager.ts](frontend_new/src/three/SceneManager.ts),
   [hooks/useThreeScene.ts](frontend_new/src/hooks/useThreeScene.ts)), and WebGL
   disposal already exists (`manager.dispose()` in the `useThreeScene` cleanup). The
   app is single-page (no router, no Zustand — see [package.json](frontend_new/package.json)).
   So Phase 2 is **"wrap the working 3D view in a router + sidebar,"** not "port the
   vanilla `graph.js`." The vanilla port the prompt imagined is unnecessary.

---

## BT data source — decision required

The contract (event types + JSON schema below) is designed once and is **source-agnostic**.
Anything that calls `runtime.dispatch_event({...})` reaches every connected browser
through the existing single broadcaster in [server.py](backend/ros_monitor_bridge/server.py)
(`websocket_broadcaster`). No second WebSocket server is needed — the prompt's "stream
over the existing WebSocket" maps cleanly onto `runtime.dispatch_event()`.

| Option | What it is | Deps added | Use |
|---|---|---|---|
| **A — Python sim emitter (recommended for Phases 1–3)** | A new `bt_simulation.py` (sibling of `simulation.py`) that holds a hardcoded demo tree, ticks it on a thread, and emits `bt_blueprint` once + `bt_delta` per state change via `runtime.dispatch_event()`. | none | De-risk layout + pipeline now; no ROS, no C++, no ZMQ. |
| **B — Real BT.CPP v4 Groot2 client (later target)** | `btros_bridge.py` acting as a **Groot2 client** that connects to the live `Groot2Publisher` already running inside the **mserve / hyfleet** BT executors, requests the tree, parses it → JSON, and forwards identical events. | `pyzmq` (ZeroMQ req-reply), no C++ work here | Real integration against existing fleet trees, once the UI is proven. |

**Recommendation (CONFIRMED):** Build the contract once, drive it from **Option A** for
Phases 1–3 (perfects layout + live binding with zero new system deps), and keep
**Option B** as a drop-in real source that emits the *same* events later.

### Option B is BT.CPP **v4 / Groot2** — not v3 (correction)
The real trees live in the **mserve** and **hyfleet** projects (BehaviorTree.CPP **v4**),
not in this repo. v4 does **not** use the old v3 `PublisherZMQ` 1666/1667 pub-sub model
the prompt assumed. When we build Option B:

- The publisher is **`Groot2Publisher`** (enabled in those projects via the
  `BTCPP_GROOT_INTERFACE` build option), exposing a **single TCP port (default `1667`)**.
- The protocol is **ZeroMQ request-reply**, not passive subscribe. `btros_bridge.py`
  must be an **active Groot2 client**: send a request to fetch the full tree
  (`FullTree`) and poll/subscribe for status, then translate into our
  `bt_blueprint` / `bt_delta` events.
- Target is the running mserve/hyfleet executors — **nothing in this repo publishes BT
  data.** Do not design Option B as a passive 1666/1667 subscriber.

This is recorded now; **not implemented in this phase.**

---

## 1. File structure

### Backend (Python)
```
backend/ros_monitor_bridge/
├── bt_simulation.py     # NEW (Option A): demo tree + ticker → bt_blueprint / bt_delta
├── btros_bridge.py      # NEW (Option B, later): pyzmq subscriber, XML→JSON, forward
├── main.py              # EDIT: --bt flag to start the BT source thread
├── runtime.py           # UNCHANGED — dispatch_event already carries any event type
├── server.py            # UNCHANGED — single broadcaster relays all event types
└── simulation.py        # UNCHANGED
```

### Phase 1 — Vanilla prototype (throwaway sandbox)
```
frontend/
├── bt_proto.html        # NEW standalone page (does not touch index.html)
└── js/
    └── bt_proto.js      # NEW: WS client + Canvas/SVG layout + orthogonal routing
```

### Phases 2–3 — React app
```
frontend_new/src/
├── main.tsx                     # EDIT: mount <Router/>
├── router.tsx                   # NEW: hash router (Home|RosIntrospection|BehaviorTree|Logs)
├── components/
│   ├── AppShell.tsx             # NEW: sidebar nav + routed <main>
│   └── NavSidebar.tsx           # NEW: persistent left nav (extensible page list)
├── views/
│   ├── Home.tsx                 # NEW: styled placeholder
│   ├── RosIntrospection.tsx     # NEW: existing App.tsx body moved here verbatim
│   ├── BehaviorTree.tsx         # NEW (Phase 3): BT canvas + inspector
│   ├── Logging.tsx              # NEW: styled placeholder
│   └── Settings.tsx             # NEW: styled placeholder (5th page)
├── bt/                          # NEW (Phase 3)
│   ├── BTCanvas.tsx             # tree render (SVG/absolute-positioned divs)
│   ├── BTNode.tsx               # decorator caps + services + core block
│   ├── BTWires.tsx              # orthogonal connectors + flowing-RUNNING anim
│   ├── BTInspector.tsx          # right panel: port remappings + blackboard table
│   └── layout.ts                # d3-hierarchy / layered-grid placement math
├── store/
│   └── btStore.ts               # NEW (Phase 3): Zustand — blueprint + node status map
├── hooks/
│   └── useBtSocket.ts           # NEW: subscribe bt_blueprint / bt_delta into btStore
└── App.tsx                      # BECOMES thin wrapper (ThemeProvider + Router)
```

---

## 2. JSON schema (new event types on the existing contract)

All events keep the established `{ type, timestamp, data }` envelope. Two new types.

### `bt_blueprint` — one-time structure handshake (sent on connect / tree load)
```json
{
  "type": "bt_blueprint",
  "timestamp": 1686000000.0,
  "data": {
    "tree_id": "MainTree",
    "root_id": 0,
    "nodes": [
      { "id": 0, "name": "Root", "type": "Sequence", "category": "control",
        "children": [1, 4], "decorators": [], "services": [], "ports": {} },
      { "id": 1, "name": "CheckBattery", "type": "Condition", "category": "condition",
        "children": [], "decorators": [], "services": [],
        "ports": { "input": { "min_level": "{battery_min}" } } },
      { "id": 4, "name": "MoveToGoal", "type": "MoveBase", "category": "action",
        "children": [],
        "decorators": [ { "id": 5, "name": "Inverter", "type": "Inverter" } ],
        "services": [ { "id": 6, "name": "KeepAlive", "tick_ms": 100 } ],
        "ports": { "input": { "goal": "{target_pose}" },
                   "output": { "result": "{nav_result}" } } }
    ]
  }
}
```
- `category ∈ {control, action, condition, decorator, subtree}` drives block styling.
- `decorators` render as stacked caps on top of the node; `services` render inside the
  block (showing `tick_ms`); `children` give parent→child wiring. This matches the
  "decorators are not free-floating nodes" rule structurally.

### `bt_delta` — continuous lightweight state stream (per tick / state change)
```json
{ "type": "bt_delta", "timestamp": 1686000000.4,
  "data": { "id": 4, "state": "RUNNING", "tick_dt_ms": 31 } }
```
- `state ∈ {IDLE, RUNNING, SUCCESS, FAILURE}` (BT::NodeStatus).
- Optional `tick_dt_ms` feeds the per-node jitter sparkline.
- Optional batched form for high tick rates: `data.deltas: [{id,state,tick_dt_ms}, ...]`.

### `bt_blackboard` (optional, Phase 3 inspector)
```json
{ "type": "bt_blackboard", "timestamp": 1686000000.4,
  "data": { "scope": "MainTree", "vars": { "battery_min": 20, "nav_result": "PENDING" } } }
```

---

## 3. Layout & wiring math (top-to-bottom, orthogonal)

- **Placement:** treat each node *including its decorator caps + services* as one
  layout box. Use `d3-hierarchy` (`d3.hierarchy` + `d3.tree()`) for x/y, or an
  equivalent layered grid: depth = row (y = depth · rowGap), and `d3.tree` resolves
  sibling x with no overlap. Node box height = `capHeight·decoratorCount +
  serviceHeight·serviceCount + coreHeight`; feed per-node `nodeSize` so tall stacks
  don't collide.
- **Orthogonal wires (no diagonals):** from parent bottom-center `(px, pBottom)` to
  child top-center `(cx, cTop)` route as 3 segments — down to a mid-rail
  `midY = pBottom + (cTop - pBottom)/2`, across to `cx`, down to `cTop`. As an SVG
  path: `M px pBottom V midY H cx V cTop`. A shared mid-rail per parent gives the
  clean "bus" look.
- **Collapse/expand:** prune collapsed subtrees before the `d3.hierarchy` pass so the
  layout reflows without hidden nodes; memoize layout keyed by
  `(blueprint version, collapsedSet)` so high-frequency `bt_delta` updates never
  recompute geometry — deltas only recolor.

---

## 4. React state strategy

- **Zustand `btStore`** (add `zustand` dep — not currently installed):
  - `blueprint: BTBlueprint | null` — set once on `bt_blueprint`.
  - `statusById: Record<number, NodeStatus>` — patched per `bt_delta`.
  - `tickDtById`, `blackboard`, `collapsedSet`, `selectedNodeId`.
  - Actions: `loadBlueprint`, `applyDelta`, `toggleCollapse`, `select`.
- **No-rerender patching:** `BTNode` subscribes with a *selector*
  `useBtStore(s => s.statusById[id])`, so a delta to node 4 re-renders only node 4.
  Layout geometry lives in `useMemo` keyed by blueprint+collapsedSet, untouched by
  deltas.
- **Why a separate store:** the existing RosIntrospection view uses local `useState`
  + `Map`s in [App.tsx](frontend_new/src/App.tsx) and works — we do **not** rewrite it.
  BT's high-frequency, normalized, per-node updates are a textbook Zustand fit and
  stay isolated from the 3D view's state.
- **Local component state** stays for pure view concerns: pan/zoom transform, inspector
  open/closed, hover.

---

## 5. WebGL mount / unmount / cleanup (router safety)

The disposal already exists; routing makes it actually fire. In
[useThreeScene.ts](frontend_new/src/hooks/useThreeScene.ts) the init `useEffect`
returns `() => { manager.dispose(); managerRef.current = null; }`. Today the scene is
always mounted, so that path rarely runs. Under the router:

- `RosIntrospection.tsx` owns the `useThreeScene` mount. Navigating away **unmounts**
  it → cleanup runs → `SceneManager.dispose()` must (audit/confirm it does): cancel the
  `requestAnimationFrame` loop, `renderer.dispose()` + `forceContextLoss()`, dispose
  geometries/materials/textures, remove the canvas, and **close the WebSocket** opened
  by `useRosGraph`.
- Returning to the route **remounts** → fresh `SceneManager` + fresh WS connection.
- The BT view uses no WebGL (Canvas/SVG), so it has no GPU teardown burden; its
  `useBtSocket` simply unsubscribes its handlers on unmount.
- Keep one shared WS or one-per-view? **Decision:** keep per-view sockets (simplest,
  matches current `useRosGraph` lifecycle); the bridge broadcasts all types to all
  clients, so each view just ignores types it doesn't care about.

---

## 6. Phased To-Do checklist

### Phase 0 — Contract & data source ✅ DONE
- [x] Lock the `bt_blueprint` / `bt_delta` / `bt_blackboard` schema above.
- [x] **[Option A]** `bt_simulation.py`: hydrogen-dispenser demo tree + BT.CPP-v4-style
      tick engine; emits `bt_blueprint` (re-broadcast every ~3s for late joiners) +
      `bt_delta` on every status change.
- [x] `--bt` flag in [main.py](backend/ros_monitor_bridge/main.py) +
      [config.py](backend/ros_monitor_bridge/config.py); runs alongside ROS or sim.
- [x] Verified over WS: blueprint + steady delta stream, all four states, FAILURE
      propagates up the tree.

### Phase 1 — Vanilla prototype ✅ DONE (visually approved)
- [x] [bt_proto.html](frontend/bt_proto.html) + [bt_proto.js](frontend/js/bt_proto.js):
      WS client, hand-rolled tidy-tree layout (no d3 dep), decorator caps + in-block
      services, orthogonal `M..V..H..V` wires, RUNNING flow + 150ms SUCCESS/FAILURE
      flash, pan/zoom. Approved by user.

### Phase 2 — Production SPA shell ✅ DONE (visually approved)
- [x] [router.tsx](frontend_new/src/router.tsx) (hash router + ROUTES registry) +
      [AppShell.tsx](frontend_new/src/components/AppShell.tsx) +
      [NavSidebar.tsx](frontend_new/src/components/NavSidebar.tsx) — Home / ROS
      Introspection / Behavior Tree / Logging / Settings, collapsible, theme-aware.
- [x] Moved App.tsx body **verbatim** into
      [RosIntrospection.tsx](frontend_new/src/views/RosIntrospection.tsx); App.tsx is
      now ThemeProvider + AppShell. Docked panels switched `fixed`→`absolute` to live
      in the content area; cursor menus/modals stay `fixed`.
- [x] Home / BehaviorTree / Logging / Settings styled placeholders (shared
      [PagePlaceholder.tsx](frontend_new/src/components/PagePlaceholder.tsx)).
- [x] **Hardened `SceneManager.dispose()`**: added geometry/material/**texture**
      disposal (sprite label + Hz-badge textures were leaking), `controls.dispose()`,
      `composer.dispose()`, `forceContextLoss()`. WS already closes via `useRosGraph`
      cleanup; scene disposes via `useThreeScene` cleanup — both now fire on nav-away.
- [x] **Gate:** routing + 3D view verified working, no crashes. Fixed two crashes en
      route: cross-instance outline-material cache disposal, and the sim emitting
      services without a `clients[]` array ([simulation.py](backend/ros_monitor_bridge/simulation.py)).

### Phase 3 — BT integration in React ✅ DONE (awaiting visual gate)
- [x] Added `zustand`; [store/btStore.ts](frontend_new/src/store/btStore.ts) +
      [hooks/useBtSocket.ts](frontend_new/src/hooks/useBtSocket.ts).
- [x] [bt/layout.ts](frontend_new/src/bt/layout.ts) (ported tidy-tree + orthogonal
      math), [BTCanvas](frontend_new/src/bt/BTCanvas.tsx) (pan/zoom + SVG wires) /
      [BTNode](frontend_new/src/bt/BTNode.tsx) (caps + services + core) — HTML divs
      Tailwind-themed over an SVG wire layer; CSS states in index.css.
- [x] Per-node selector subscriptions (`useBtStore(s => s.statusById[id])`) so a
      delta repaints only the affected node + its incoming wire.
- [x] [BTInspector](frontend_new/src/bt/BTInspector.tsx): port remappings + live
      blackboard table with change-flash; collapse/expand subtrees. (Sparkline not
      chosen.) Emitter now sends `bt_blackboard`.
- [x] **[Option B]** [btros_bridge.py](backend/ros_monitor_bridge/btros_bridge.py):
      Groot2 **v4** ZMQ_REQ client — FULLTREE→blueprint (XML `_uid` mapping, decorator
      folding, subtree inlining, TreeNodesModel port directions), STATUS poll→deltas.
      `--btros HOST[:PORT]` flag. Parser + protocol framing tested offline
      ([test_btros_parse.py](backend/test_btros_parse.py)). **Needs a live
      mserve/hyfleet executor to validate the ZMQ runtime path + LE assumption.**

### Phase 3 — Gate
- [ ] Visually verify the Behavior Tree page (sim): tree renders, RUNNING path flows,
      states animate, click-to-inspect shows ports + live blackboard, collapse works.
- [ ] Validate Option B against a running Groot2 v4 executor: `--btros HOST:PORT`.

---

## Verification

- **Backend contract:** `./scripts/run_visualizer.sh --sim --bt`, then
  `websocat ws://localhost:8765` (or browser DevTools WS frames) shows one
  `bt_blueprint` followed by a steady `bt_delta` stream with valid states.
- **Phase 1:** open `http://localhost:7260/bt_proto.html` — tree renders top-to-bottom,
  decorators cap their targets, wires are orthogonal, RUNNING wires animate,
  SUCCESS/FAILURE flash.
- **Phase 2:** `./scripts/run_visualizer_new.sh` — sidebar routes between all four
  pages; the 3D view still works under "ROS Introspection"; navigating away and back
  repeatedly shows no WebGL-context leak (Chrome `chrome://gpu` / DevTools memory) and
  reconnects cleanly.
- **Phase 3:** "Behavior Tree" page shows the live tree; clicking a node opens the
  inspector with ports + blackboard; deltas recolor individual nodes; React Profiler
  confirms a delta re-renders only the affected `BTNode`.

---

## Decisions (resolved)
1. **Data source:** Option A (Python sim emitter) now; Option B = BT.CPP **v4 Groot2
   client** against mserve/hyfleet, later.
2. **Prototype canvas:** **SVG**.
3. **Vanilla `frontend/`:** separate **`bt_proto.html`** page; do not touch `index.html`.
4. **Nav pages:** Home, ROS Introspection, Behavior Tree, Logging, **Settings** (extensible).
