import { useEffect, useRef } from 'react';
import { useBtStore } from '../store/btStore';
import { useUIStore, type BridgeMode } from '../store/uiStore';
import type { BTBlueprint } from '../bt/types';
import { startBridgeConnection, subscribeToBridgeFrames, useBridgeConnectionStore } from '../bridge/connection';

export type BtConnStatus = 'connecting' | 'connected' | 'disconnected';

// Consumes the app-level shared WebSocket stream and patches the Zustand BT
// store from bt_blueprint / bt_delta / bt_blackboard events.
export function useBtSocket(paused = false): BtConnStatus {
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const bridgeStatus = useBridgeConnectionStore((s) => s.status);

  // Live bridge subscription over the shared app-level socket.
  useEffect(() => {
    const { loadBlueprint, applyDelta, setBlackboard } = useBtStore.getState();

    // Fall back to the active tree when a stream omits tree_id (single tree).
    const resolveTree = (explicit?: string) =>
      explicit ?? useBtStore.getState().activeTreeId ?? '';

    startBridgeConnection();
    const unsubscribe = subscribeToBridgeFrames(({ frame }) => {
      switch (frame.type) {
        case 'bt_blueprint':
          loadBlueprint(frame.data as unknown as BTBlueprint);
          break;
        case 'bt_delta': {
          if (pausedRef.current) break;   // frozen — keep the last live state
          const data = frame.data as { tree_id?: string; deltas?: { id: number; state: never }[]; id?: number; state?: never };
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
          const data = frame.data as { tree_id?: string; scope?: string; vars: Record<string, unknown> };
          setBlackboard(resolveTree(data.tree_id ?? data.scope), data.vars);
          break;
        }
        case 'bridge_mode':
          useUIStore.getState().setBridgeMode(frame.data as unknown as BridgeMode);
          break;
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  return bridgeStatus;
}
