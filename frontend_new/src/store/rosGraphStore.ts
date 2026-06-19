import { create } from 'zustand';

interface RosGraphStore {
  nodeParams: Map<string, Record<string, unknown>>;
  setNodeParams: (nodeName: string, params: Record<string, unknown>) => void;
}

export const useRosGraphStore = create<RosGraphStore>((set) => ({
  nodeParams: new Map(),
  setNodeParams: (nodeName, params) =>
    set((s) => {
      const next = new Map(s.nodeParams);
      next.set(nodeName, params);
      return { nodeParams: next };
    }),
}));
