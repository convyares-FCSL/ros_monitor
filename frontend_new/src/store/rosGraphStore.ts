import { create } from 'zustand';

interface RosGraphStore {
  nodeParams: Map<string, Record<string, unknown>>;
  btConnectedPort: number | null;
  setNodeParams: (nodeName: string, params: Record<string, unknown>) => void;
  setBtConnectedPort: (port: number) => void;
}

export const useRosGraphStore = create<RosGraphStore>((set) => ({
  nodeParams: new Map(),
  btConnectedPort: null,
  setNodeParams: (nodeName, params) =>
    set((s) => {
      const next = new Map(s.nodeParams);
      next.set(nodeName, params);
      return { nodeParams: next };
    }),
  setBtConnectedPort: (port) => set({ btConnectedPort: port }),
}));
