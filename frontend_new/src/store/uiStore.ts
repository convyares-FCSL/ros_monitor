import { create } from 'zustand';

// Run mode reported by the bridge (bridge_mode event). Lets the UI show clearly
// whether each view is on real, demo, or no-ROS data.
export interface BridgeMode {
  no_ros: boolean;
  introspection: 'live' | 'demo';
  behavior_tree: 'real' | 'demo' | 'auto' | 'off';
}

interface UIState {
  bridgeMode: BridgeMode | null;
  setBridgeMode: (m: BridgeMode) => void;
}

export const useUIStore = create<UIState>((set) => ({
  bridgeMode: null,
  setBridgeMode: (m) => set((s) => {
    const cur = s.bridgeMode;
    // Skip the periodic re-announcements when nothing changed.
    if (cur && cur.no_ros === m.no_ros && cur.introspection === m.introspection && cur.behavior_tree === m.behavior_tree) {
      return s;
    }
    return { bridgeMode: m };
  }),
}));
