import { useEffect, useRef } from 'react';
import type {
  GraphUpdate, MessageEvent, FrequencyUpdate, LifecycleEvent,
  NodeParamsEvent, ServiceInvokedEvent, ConnectionStatus
} from '../types';
import { useUIStore, type BridgeMode } from '../store/uiStore';
import { startBridgeConnection, subscribeToBridgeFrames, useBridgeConnectionStore } from '../bridge/connection';

export interface RosGraphCallbacks {
  onGraphUpdate: (data: GraphUpdate) => void;
  onMessage: (event: MessageEvent) => void;
  onFrequency: (data: FrequencyUpdate) => void;
  onLifecycle: (event: LifecycleEvent) => void;
  onNodeParams: (event: NodeParamsEvent) => void;
  onServiceInvoked: (event: ServiceInvokedEvent) => void;
  onStatusChange: (status: ConnectionStatus) => void;
  onBandwidth: (bytes: number) => void;
}

interface UseRosGraphOptions extends RosGraphCallbacks {
  paused: boolean;
}

export function useRosGraph(opts: UseRosGraphOptions) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const bridgeStatus = useBridgeConnectionStore((s) => s.status);

  useEffect(() => {
    if (bridgeStatus === 'connected') {
      optsRef.current.onStatusChange('connected');
    } else if (bridgeStatus === 'connecting') {
      optsRef.current.onStatusChange('connecting');
    } else {
      optsRef.current.onStatusChange('disconnected');
    }
  }, [bridgeStatus]);

  useEffect(() => {
    // Consume the shared app-level bridge stream instead of owning a socket
    // per page. This keeps status and reconnect behavior consistent across
    // routes while preserving the page-local paused view behavior.
    startBridgeConnection();
    const unsubscribe = subscribeToBridgeFrames(({ frame, rawSize }) => {
      const o = optsRef.current;
      if (o.paused) return;
      o.onBandwidth(rawSize);
      switch (frame.type) {
        case 'graph_update':
          o.onGraphUpdate(frame.data as GraphUpdate);
          break;
        case 'message_event': {
          const me = frame.data as MessageEvent;
          me.id = me.id ?? `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          me.timestamp = me.timestamp ?? frame.timestamp * 1000;
          o.onMessage(me);
          break;
        }
        case 'frequency_update':
          o.onFrequency(frame.data as FrequencyUpdate);
          break;
        case 'lifecycle_event':
          o.onLifecycle(frame.data as LifecycleEvent);
          break;
        case 'node_params_event':
          o.onNodeParams(frame.data as NodeParamsEvent);
          break;
        case 'service_invoked': {
          const se = frame.data as ServiceInvokedEvent;
          se.id = se.id ?? `svc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          se.timestamp = se.timestamp ?? frame.timestamp * 1000;
          o.onServiceInvoked(se);
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

  return { reconnect: startBridgeConnection };
}
