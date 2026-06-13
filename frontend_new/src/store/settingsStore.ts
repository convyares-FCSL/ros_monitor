import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DeadEndMode } from '../types';

// Kept in sync with DEFAULT_MAX_LOG_ENTRIES in eventLogStore; inlined here to
// avoid a settingsStore <-> eventLogStore import cycle.
const DEFAULT_MAX_LOG_ENTRIES = 2000;

// App-wide preferences, persisted to localStorage. Distinct from per-scene 3D
// styling (that lives in ros3d-scene-settings, owned by the RosIntrospection
// toolbar) and from theme/accent colours (ros3d-theme / ros3d-custom-colors,
// owned by useTheme). This store holds cross-cutting, non-styling preferences.

export interface AppSettings {
  // Connection — the bridge WebSocket endpoint (was hardcoded in connection.ts).
  wsHost: string;
  wsPort: number;

  // Telemetry / rate limits.
  maxLogEntries: number;        // ring-buffer cap for the Logging console
  capturePayloads: boolean;     // include topic message payloads in the log feed
  stalenessThresholdSec: number;

  // Per-view defaults.
  defaultView: string;          // route path the app opens on
  defaultDeadEndMode: DeadEndMode;
}

interface SettingsState extends AppSettings {
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  reset: () => void;
}

const DEFAULTS: AppSettings = {
  wsHost: window.location.hostname || 'localhost',
  wsPort: 8765,
  maxLogEntries: DEFAULT_MAX_LOG_ENTRIES,
  capturePayloads: true,
  stalenessThresholdSec: 2.0,
  defaultView: 'home',
  defaultDeadEndMode: 'dimmed',
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      reset: () => set({ ...DEFAULTS }),
    }),
    {
      name: 'ros3d-settings',
      // Only persist the data fields, never the action functions.
      partialize: (s): AppSettings => ({
        wsHost: s.wsHost, wsPort: s.wsPort,
        maxLogEntries: s.maxLogEntries, capturePayloads: s.capturePayloads,
        stalenessThresholdSec: s.stalenessThresholdSec,
        defaultView: s.defaultView, defaultDeadEndMode: s.defaultDeadEndMode,
      }),
    },
  ),
);

// Non-reactive read for modules outside React (e.g. the WS connection layer).
export function getWsUrl(): string {
  const { wsHost, wsPort } = useSettingsStore.getState();
  return `ws://${wsHost || 'localhost'}:${wsPort || 8765}`;
}
