import { useEffect, useRef, useCallback } from 'react';
import type {
  GraphUpdate, MessageEvent, FrequencyUpdate, LifecycleEvent,
  NodeParamsEvent, ServiceInvokedEvent, ConnectionStatus, WsFrame
} from '../types';
import {
  generateGraphUpdate, generateFrequencyUpdate, generateMessageEvent,
  generateServiceInvoked, generateLifecycleEvent, generateNodeParams,
} from '../simulation/rosSimulator';

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
  wsUrl: string;
  simMode: boolean;
  paused: boolean;
}

export function useRosGraph(opts: UseRosGraphOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const intervalsRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stopSim = useCallback(() => {
    for (const id of intervalsRef.current) clearInterval(id);
    intervalsRef.current = [];
  }, []);

  const startSim = useCallback(() => {
    stopSim();
    const o = optsRef.current;
    o.onStatusChange('simulating');

    const graphFrame = generateGraphUpdate();
    o.onGraphUpdate(graphFrame.data as GraphUpdate);

    intervalsRef.current.push(setInterval(() => {
      if (optsRef.current.paused) return;
      const f = generateGraphUpdate();
      optsRef.current.onGraphUpdate(f.data as GraphUpdate);
    }, 2000));

    intervalsRef.current.push(setInterval(() => {
      if (optsRef.current.paused) return;
      const f = generateFrequencyUpdate();
      optsRef.current.onFrequency(f.data as FrequencyUpdate);
    }, 1000));

    intervalsRef.current.push(setInterval(() => {
      if (optsRef.current.paused) return;
      const f = generateMessageEvent();
      const ev = f.data as MessageEvent;
      optsRef.current.onMessage(ev);
      optsRef.current.onBandwidth(ev.size_bytes);
    }, 500));

    intervalsRef.current.push(setInterval(() => {
      if (optsRef.current.paused) return;
      const f = generateServiceInvoked();
      optsRef.current.onServiceInvoked(f.data as ServiceInvokedEvent);
    }, 3000));

    // One-shot lifecycle + params
    setTimeout(() => {
      if (optsRef.current.paused) return;
      const lf = generateLifecycleEvent();
      optsRef.current.onLifecycle(lf.data as LifecycleEvent);
    }, 1500);
    setTimeout(() => {
      if (optsRef.current.paused) return;
      const np = generateNodeParams();
      optsRef.current.onNodeParams(np.data as NodeParamsEvent);
    }, 2000);
  }, [stopSim]);

  const connectWs = useCallback(() => {
    const o = optsRef.current;
    if (wsRef.current) wsRef.current.close();
    o.onStatusChange('disconnected');

    const ws = new WebSocket(o.wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      stopSim();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      optsRef.current.onStatusChange('connected');
    };

    ws.onmessage = (ev) => {
      const o2 = optsRef.current;
      if (o2.paused) return;
      o2.onBandwidth(typeof ev.data === 'string' ? ev.data.length : 0);
      try {
        const frame = JSON.parse(ev.data) as WsFrame;
        switch (frame.type) {
          case 'graph_update': o2.onGraphUpdate(frame.data as GraphUpdate); break;
          case 'message_event': {
            const me = frame.data as MessageEvent;
            me.id = me.id ?? `ws-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            me.timestamp = me.timestamp ?? frame.timestamp * 1000;
            o2.onMessage(me);
            break;
          }
          case 'frequency_update': o2.onFrequency(frame.data as FrequencyUpdate); break;
          case 'lifecycle_event': o2.onLifecycle(frame.data as LifecycleEvent); break;
          case 'node_params_event': o2.onNodeParams(frame.data as NodeParamsEvent); break;
          case 'service_invoked': {
            const se = frame.data as ServiceInvokedEvent;
            se.id = se.id ?? `svc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            se.timestamp = se.timestamp ?? frame.timestamp * 1000;
            o2.onServiceInvoked(se);
            break;
          }
        }
      } catch { /* ignore malformed */ }
    };

    ws.onerror = () => {
      optsRef.current.onStatusChange('disconnected');
      if (optsRef.current.simMode) startSim();
    };

    ws.onclose = () => {
      optsRef.current.onStatusChange('disconnected');
      if (optsRef.current.simMode) {
        startSim();
      } else if (!reconnectTimerRef.current) {
        // Bridge down or restarting — retry every 4 s like the reference frontend
        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (!optsRef.current.simMode) connectWsRef.current?.();
        }, 4000);
      }
    };
  }, [stopSim, startSim]);

  // Stable self-reference so the reconnect timer always calls the latest version
  const connectWsRef = useRef<typeof connectWs | null>(null);
  connectWsRef.current = connectWs;

  useEffect(() => {
    if (optsRef.current.simMode) startSim();
    else connectWs();
    return () => {
      stopSim();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
    };
  }, [opts.simMode, startSim, connectWs, stopSim]);

  return { reconnect: connectWs };
}
