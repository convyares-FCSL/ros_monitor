import { create } from 'zustand';
import type { WsFrame } from '../types';
import { getWsUrl } from '../store/settingsStore';

export type BridgeConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface BridgeEnvelope {
  frame: WsFrame;
  rawSize: number;
}

type FrameListener = (envelope: BridgeEnvelope) => void;

interface BridgeConnectionState {
  status: BridgeConnectionStatus;
}

const listeners = new Set<FrameListener>();
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

export const useBridgeConnectionStore = create<BridgeConnectionState>(() => ({
  status: 'connecting',
}));

function setStatus(status: BridgeConnectionStatus) {
  useBridgeConnectionStore.setState({ status });
}

function detachSocket(ws: WebSocket) {
  ws.onopen = null;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
}

function dispatchEnvelope(envelope: BridgeEnvelope) {
  for (const listener of listeners) {
    listener(envelope);
  }
}

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (!running || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (running) connect();
  }, 4000);
}

function connect() {
  if (!running) return;
  if (socket) {
    const prev = socket;
    socket = null;
    detachSocket(prev);
    prev.close();
  }

  setStatus('connecting');
  const ws = new WebSocket(getWsUrl());
  socket = ws;

  ws.onopen = () => {
    if (socket !== ws || !running) {
      detachSocket(ws);
      ws.close();
      return;
    }
    clearReconnectTimer();
    setStatus('connected');
  };

  ws.onmessage = (ev) => {
    if (socket !== ws || !running) return;
    try {
      const frame = JSON.parse(ev.data) as WsFrame;
      dispatchEnvelope({ frame, rawSize: typeof ev.data === 'string' ? ev.data.length : 0 });
    } catch {
      // Ignore malformed frames; the backend owns the protocol.
    }
  };

  ws.onerror = () => {
    if (socket !== ws || !running) return;
    ws.close();
  };

  ws.onclose = () => {
    if (socket === ws) socket = null;
    if (!running) {
      setStatus('disconnected');
      return;
    }
    setStatus('disconnected');
    scheduleReconnect();
  };
}

export function startBridgeConnection() {
  if (running) return;
  running = true;
  connect();
}

export function stopBridgeConnection() {
  running = false;
  clearReconnectTimer();
  if (socket) {
    const ws = socket;
    socket = null;
    detachSocket(ws);
    ws.close();
  }
  setStatus('disconnected');
}

// Tear down the current socket and reconnect using the latest settings
// (e.g. after the endpoint changed on the Settings page).
export function reconnectBridge() {
  if (!running) {
    startBridgeConnection();
    return;
  }
  clearReconnectTimer();
  connect();
}

export function subscribeToBridgeFrames(listener: FrameListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
