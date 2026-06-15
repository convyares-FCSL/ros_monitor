# Project Execution Plan — Logging & Settings Pages

> Status: **IMPLEMENTED (2026-06-13).** All phases A–E landed on branch
> `logging_settings`. Build + typecheck clean; backend tests pass.
> Scope: turn the two empty placeholder pages (`Logging`, `Settings`) in
> `frontend_new/` into working views, plus the shared infrastructure they need.

---

## Context

The repo is a working ROS 2 3D network visualizer: a Python `rclpy` + `websockets`
bridge ([backend/ros_monitor_bridge/](../backend/ros_monitor_bridge/)) and a React 18 +
TS + Vite + Tailwind app ([frontend_new/](../frontend_new/)). The multi-page shell
([components/AppShell.tsx](../frontend_new/src/components/AppShell.tsx) +
[router.tsx](../frontend_new/src/router.tsx)) already hosts Home, ROS Introspection and
Behavior Tree views. Two routes are still placeholders rendered by
[PagePlaceholder](../frontend_new/src/components/PagePlaceholder.tsx):
[views/Logging.tsx](../frontend_new/src/views/Logging.tsx) and
[views/Settings.tsx](../frontend_new/src/views/Settings.tsx).

### Decisions taken (from planning)

- **Logging source:** capture the real ROS `/rosout` topic in the backend **and**
  fold in the events the bridge already streams (lifecycle, service, message,
  frequency, mode). Sim/demo modes emit synthetic logs so the console is never empty.
- **Settings scope:** all four — configurable connection endpoint, theme &
  appearance, telemetry / rate limits, per-view defaults. Scene *styling* stays in the
  RosIntrospection toolbar modal, per that page's own design note.
- **Build order:** plan both; either page can go first since they share only Phase A.

---

## Current data flow (verified)

ROS node → `runtime.dispatch_event({type, timestamp, data})`
([runtime.py](../backend/ros_monitor_bridge/runtime.py)) → asyncio queue →
`websocket_broadcaster` ([server.py](../backend/ros_monitor_bridge/server.py)) → all WS
clients on port `8765`. Frontend `subscribeToBridgeFrames`
([bridge/connection.ts](../frontend_new/src/bridge/connection.ts)) delivers each
`WsFrame` to view-local subscribers. **There is no retained history and no central
store** — frames are processed and dropped. Both new pages need retained, app-wide
state, so that is built first.

Event types currently emitted: `graph_update`, `message_event`, `lifecycle_event`,
`frequency_update`, `node_params_event`, `service_invoked`, `bridge_mode`, plus the
`bt_*` family. We add **`log_event`**.

---

## Phase A — Shared event-log store

**New `src/store/eventLogStore.ts`** (zustand). A single subscriber to
`subscribeToBridgeFrames`, started once in `AppShell`, normalises every frame to:

```ts
interface LogEntry {
  id: string; ts: number;
  source: 'rosout' | 'lifecycle' | 'service' | 'topic' | 'system';
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  node?: string; topic?: string;
  text: string;     // human summary
  raw: unknown;     // original frame data for the detail pane
}
```

- Ring buffer capped at `maxLogEntries` (from Settings → telemetry; default 2000).
- Additive: existing per-view subscriptions are untouched.

## Phase B — Backend `/rosout` capture

In [ros_bridge.py](../backend/ros_monitor_bridge/ros_bridge.py), following the existing
subscription pattern:

1. Subscribe to `/rosout` (`rcl_interfaces/msg/Log`) in the monitor node `__init__`.
2. Callback maps `msg.level` (10/20/30/40/50 → debug/info/warn/error/fatal) and emits
   `{"type": "log_event", "timestamp", "data": {level, name, msg, file, function, line}}`
   via `self.runtime.dispatch_event`.
3. Sim/demo modes ([simulation.py](../backend/ros_monitor_bridge/simulation.py),
   [bt_simulation.py](../backend/ros_monitor_bridge/bt_simulation.py)) emit synthetic
   `log_event`s so `--sim` isn't empty.
4. Forward all levels; the frontend filters. Ring-buffer cap bounds memory.

## Phase C — Logging console (`views/Logging.tsx`)

- Add `LogEvent` to [types.ts](../frontend_new/src/types.ts); route `log_event` in the
  normaliser (`source: 'rosout'`).
- Virtualised scrollback off `eventLogStore`.
- Filter bar: level chips, source toggles, free-text search, node filter.
- Auto-scroll-to-tail with pause / jump-to-live (pauses on scroll-up).
- Row click → detail drawer (styling from
  [InspectorDrawer](../frontend_new/src/components/InspectorDrawer.tsx)): `raw` JSON,
  `file:function:line` for rosout.
- Toolbar: clear, copy/export visible rows as JSON, live count + dropped indicator.
- `bridge_mode` banner (from `useUIStore`) → live `/rosout` vs simulated.

## Phase D — Settings store + connection endpoint

**New `src/store/settingsStore.ts`** (zustand + localStorage key `ros3d-settings`).

- WS URL is hardcoded at [connection.ts:17](../frontend_new/src/bridge/connection.ts#L17).
  Refactor `connect()` to read host/port from the store (default `ws://<host>:8765`).
- UI: host + port fields, status pill (`useBridgeConnectionStore`), Reconnect button
  (`stopBridgeConnection()` → `startBridgeConnection()`).

## Phase E — Settings page remainder

- **Theme & appearance:** surface `useTheme` (theme id + custom accent) on the page;
  header `ThemeSwitcher` stays as the quick toggle. Reuse existing `ros3d-theme` /
  `ros3d-custom-colors` keys.
- **Telemetry / rate limits:** log buffer cap, payload capture on/off, frequency
  cadence, staleness threshold. Frontend-applied values read by the relevant hooks;
  any backend-applied limit needs a client→server control channel (the bridge is
  currently broadcast-only — flagged, scoped separately if required).
- **Per-view defaults:** default landing view (replaces hardcoded `DEFAULT_PATH` in
  [router.tsx:26](../frontend_new/src/router.tsx#L26)), default dead-end visibility,
  "Reset scene settings" (clears `ros3d-scene-settings`).
- Extract `SettingRow` / `Toggle` / `SliderInput` from
  [SettingsModal.tsx](../frontend_new/src/components/SettingsModal.tsx) into
  `src/components/settings/controls.tsx`, shared by modal and page.

---

## Phasing

| Phase | Deliverable | Depends on |
|---|---|---|
| A | `eventLogStore` + central subscriber | — |
| B | backend `/rosout` + sim logs | — |
| C | Logging console UI | A, B |
| D | settingsStore + connection endpoint | — |
| E | Settings page remainder | D |

A→B→C delivers Logging; D→E delivers Settings. Shared only at Phase A.

## Open items

- **Backend control channel:** bridge looks broadcast-only. Backend-applied telemetry
  limits would need a small protocol addition; frontend-side limits need nothing.
- **`/rosout` volume:** chatty systems flood it — cap + level filter handle the UI;
  default to forwarding all levels unless gating at source is preferred.
