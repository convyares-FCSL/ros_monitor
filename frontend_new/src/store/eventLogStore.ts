import { create } from 'zustand';
import { subscribeToBridgeFrames } from '../bridge/connection';
import { useSettingsStore } from './settingsStore';
import type {
  WsFrame, LogEvent, LifecycleEvent, ServiceInvokedEvent, MessageEvent,
} from '../types';

// One unified, retained timeline of everything the bridge emits. The raw WS
// pipeline is fire-and-forget (frames are processed and dropped); the Logging
// console needs history, so this store keeps a bounded ring buffer that any
// view can read. It is additive — existing per-view subscriptions are untouched.

export type LogSource = 'rosout' | 'lifecycle' | 'service' | 'topic' | 'system';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  id: string;
  ts: number;          // epoch ms
  source: LogSource;
  level: LogLevel;
  node?: string;
  topic?: string;
  text: string;        // human-readable summary
  raw: unknown;        // original frame data for the detail pane
}

export const DEFAULT_MAX_LOG_ENTRIES = 2000;

interface EventLogState {
  entries: LogEntry[];
  maxEntries: number;
  dropped: number;     // entries discarded by the ring buffer since last clear
  clear: () => void;
  setMaxEntries: (n: number) => void;
}

export const useEventLogStore = create<EventLogState>((set) => ({
  entries: [],
  maxEntries: DEFAULT_MAX_LOG_ENTRIES,
  dropped: 0,
  clear: () => set({ entries: [], dropped: 0 }),
  setMaxEntries: (n) => set((s) => {
    const maxEntries = Math.max(1, Math.floor(n));
    if (s.entries.length <= maxEntries) return { maxEntries };
    const overflow = s.entries.length - maxEntries;
    return { maxEntries, entries: s.entries.slice(overflow), dropped: s.dropped + overflow };
  }),
}));

let seq = 0;
function nextId(ts: number): string {
  seq += 1;
  return `${ts}-${seq}`;
}

// Map a single WS frame to a LogEntry, or null for frame types that don't belong
// in the console (e.g. full graph snapshots, periodic frequency updates).
function normalise(frame: WsFrame): LogEntry | null {
  const ts = frame.timestamp ? frame.timestamp * 1000 : Date.now();
  const base = { id: nextId(ts), ts, raw: frame.data };

  switch (frame.type) {
    case 'log_event': {
      const d = frame.data as LogEvent;
      return { ...base, source: 'rosout', level: d.level ?? 'info', node: d.name, text: d.msg };
    }
    case 'lifecycle_event': {
      const d = frame.data as LifecycleEvent;
      const goal = (d.goal_state ?? '').toLowerCase();
      const level: LogLevel = goal.includes('error') ? 'error' : 'info';
      return {
        ...base, source: 'lifecycle', level, node: d.node_name,
        text: `${d.start_state} → ${d.goal_state}`,
      };
    }
    case 'service_invoked': {
      const d = frame.data as ServiceInvokedEvent;
      const dir = d.event_type === 0 ? 'request sent' : 'request received';
      return { ...base, source: 'service', level: 'info', topic: d.service_name, text: `${d.service_name} — ${dir}` };
    }
    case 'message_event': {
      if (!useSettingsStore.getState().capturePayloads) return null;
      const d = frame.data as MessageEvent;
      return {
        ...base, source: 'topic', level: 'debug', topic: d.topic,
        text: `${d.topic} (${d.msg_type}, ${d.size_bytes}B)`,
      };
    }
    case 'bridge_mode': {
      const d = frame.data as { mode?: string };
      return { ...base, source: 'system', level: 'info', text: `Bridge mode: ${d.mode ?? 'unknown'}` };
    }
    default:
      // graph_update, frequency_update, node_params_event, bt_* — not log material.
      return null;
  }
}

let attached = false;

// Start the single app-wide subscriber. Idempotent; call once from AppShell.
export function initEventLog(): () => void {
  if (attached) return () => {};
  attached = true;
  const unsub = subscribeToBridgeFrames(({ frame }) => {
    const entry = normalise(frame);
    if (!entry) return;
    useEventLogStore.setState((s) => {
      const entries = [...s.entries, entry];
      if (entries.length <= s.maxEntries) return { entries };
      const overflow = entries.length - s.maxEntries;
      return { entries: entries.slice(overflow), dropped: s.dropped + overflow };
    });
  });
  return () => {
    attached = false;
    unsub();
  };
}
