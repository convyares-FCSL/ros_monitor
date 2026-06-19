import { create } from 'zustand';

interface RosGraphStore {
  nodeParams: Map<string, Record<string, unknown>>;
  btConnectedPort: number | null;
  setNodeParams: (nodeName: string, params: Record<string, unknown>) => void;
  setBtConnectedPort: (port: number) => void;
}

export const useRosGraphStore = create<RosGraphStore>((set, get) => ({
  nodeParams: new Map(),
  btConnectedPort: null,
  setNodeParams: (nodeName, params) => {
    // Skip re-render if params are identical (prevents cycling on repeated fetches).
    const existing = get().nodeParams.get(nodeName);
    if (existing && JSON.stringify(existing) === JSON.stringify(params)) return;
    set((s) => {
      const next = new Map(s.nodeParams);
      next.set(nodeName, params);
      return { nodeParams: next };
    });
  },
  setBtConnectedPort: (port) => set({ btConnectedPort: port }),
}));
