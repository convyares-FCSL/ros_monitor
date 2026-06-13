import { useEffect, useState } from 'react';
import { useBtStore } from '../store/btStore';
import type { BTBlueprint } from '../bt/types';

const WS_URL = `ws://${window.location.hostname || 'localhost'}:8765`;

export type BtConnStatus = 'connecting' | 'connected' | 'disconnected';

// Subscribes to the bridge's bt_blueprint / bt_delta / bt_blackboard stream and
// patches the Zustand store. Per-view socket: the bridge broadcasts every event
// type to all clients, so this just ignores the ones it doesn't care about.
export function useBtSocket(): BtConnStatus {
  const [status, setStatus] = useState<BtConnStatus>('connecting');

  useEffect(() => {
    const { loadBlueprint, applyDelta, setBlackboard, reset } = useBtStore.getState();
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let version: number | null = null;

    const connect = () => {
      setStatus('connecting');
      ws = new WebSocket(WS_URL);

      ws.onopen = () => setStatus('connected');

      ws.onmessage = (ev) => {
        let msg: { type: string; data: Record<string, unknown> };
        try { msg = JSON.parse(ev.data); } catch { return; }

        switch (msg.type) {
          case 'bt_blueprint': {
            const bp = msg.data as unknown as BTBlueprint;
            // Idempotent: only reload when the structure version changes.
            if (bp.version !== version) { version = bp.version; loadBlueprint(bp); }
            break;
          }
          case 'bt_delta': {
            const deltas = (msg.data as { deltas?: { id: number; state: never }[] }).deltas;
            if (Array.isArray(deltas)) {
              for (const d of deltas) applyDelta(d.id, d.state);
            } else {
              const d = msg.data as unknown as { id: number; state: never };
              applyDelta(d.id, d.state);
            }
            break;
          }
          case 'bt_blackboard':
            setBlackboard((msg.data as { vars: Record<string, unknown> }).vars);
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
  }, []);

  return status;
}
