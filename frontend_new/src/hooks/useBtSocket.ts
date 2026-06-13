import { useEffect, useRef, useState } from 'react';
import { useBtStore } from '../store/btStore';
import { useUIStore, type BridgeMode } from '../store/uiStore';
import { btSimulator } from '../simulation/btSimulator';
import type { BTBlueprint } from '../bt/types';

const WS_URL = `ws://${window.location.hostname || 'localhost'}:8765`;

export type BtConnStatus = 'connecting' | 'connected' | 'disconnected' | 'simulating';

// Subscribes to the bridge's bt_blueprint / bt_delta / bt_blackboard stream and
// patches the Zustand store. Per-view socket: the bridge broadcasts every event
// type to all clients, so this just ignores the ones it doesn't care about.
// When simMode is on, a client-side simulator drives the store instead (no bridge).
export function useBtSocket(paused = false, simMode = false): BtConnStatus {
  const [status, setStatus] = useState<BtConnStatus>('connecting');
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // Client-side simulator — fake tree, no bridge needed.
  useEffect(() => {
    if (!simMode) return;
    setStatus('simulating');
    btSimulator.setPaused(pausedRef.current);
    btSimulator.start();
    return () => btSimulator.stop();
  }, [simMode]);

  // Keep the simulator's pause in sync.
  useEffect(() => {
    if (simMode) btSimulator.setPaused(paused);
  }, [simMode, paused]);

  // Live bridge socket.
  useEffect(() => {
    if (simMode) return; // the simulator takes over
    const { loadBlueprint, applyDelta, setBlackboard, reset } = useBtStore.getState();
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    // Fall back to the active tree when a stream omits tree_id (single tree).
    const resolveTree = (explicit?: string) =>
      explicit ?? useBtStore.getState().activeTreeId ?? '';

    const connect = () => {
      setStatus('connecting');
      ws = new WebSocket(WS_URL);
      ws.onopen = () => setStatus('connected');

      ws.onmessage = (ev) => {
        let msg: { type: string; data: Record<string, unknown> };
        try { msg = JSON.parse(ev.data); } catch { return; }

        switch (msg.type) {
          case 'bt_blueprint':
            loadBlueprint(msg.data as unknown as BTBlueprint);
            break;
          case 'bt_delta': {
            if (pausedRef.current) break;   // frozen — keep the last live state
            const data = msg.data as { tree_id?: string; deltas?: { id: number; state: never }[]; id?: number; state?: never };
            const tid = resolveTree(data.tree_id);
            if (Array.isArray(data.deltas)) {
              for (const d of data.deltas) applyDelta(tid, d.id, d.state);
            } else if (data.id != null) {
              applyDelta(tid, data.id, data.state as never);
            }
            break;
          }
          case 'bt_blackboard': {
            if (pausedRef.current) break;
            const data = msg.data as { tree_id?: string; scope?: string; vars: Record<string, unknown> };
            setBlackboard(resolveTree(data.tree_id ?? data.scope), data.vars);
            break;
          }
          case 'bridge_mode':
            useUIStore.getState().setBridgeMode(msg.data as unknown as BridgeMode);
            break;
        }
      };

      ws.onclose = () => {
        setStatus('disconnected');
        if (!closed) retry = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
      reset();
    };
  }, [simMode]);

  return status;
}
