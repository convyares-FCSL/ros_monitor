import { create } from 'zustand';
import type { BTBlueprint, BTNodeDef, NodeStatus } from '../bt/types';

interface BTState {
  blueprint: BTBlueprint | null;
  nodesById: Map<number, BTNodeDef>;
  // Normalized status map — patched per delta. Components subscribe to a single
  // node's status via selector, so a delta re-renders only that node.
  statusById: Record<number, NodeStatus>;
  blackboard: Record<string, unknown>;
  // Wall-clock of the last change per blackboard key, for change-highlighting.
  blackboardTouched: Record<string, number>;
  selectedNodeId: number | null;
  collapsed: Set<number>;

  loadBlueprint: (bp: BTBlueprint) => void;
  applyDelta: (id: number, state: NodeStatus) => void;
  setBlackboard: (vars: Record<string, unknown>) => void;
  select: (id: number | null) => void;
  toggleCollapse: (id: number) => void;
  reset: () => void;
}

const EMPTY = {
  blueprint: null,
  nodesById: new Map<number, BTNodeDef>(),
  statusById: {} as Record<number, NodeStatus>,
  blackboard: {} as Record<string, unknown>,
  blackboardTouched: {} as Record<string, number>,
  selectedNodeId: null,
  collapsed: new Set<number>(),
};

export const useBtStore = create<BTState>((set) => ({
  ...EMPTY,

  loadBlueprint: (bp) => set(() => ({
    blueprint: bp,
    nodesById: new Map(bp.nodes.map((n) => [n.id, n])),
    statusById: Object.fromEntries(bp.nodes.map((n) => [n.id, 'IDLE'])) as Record<number, NodeStatus>,
  })),

  applyDelta: (id, state) => set((s) => {
    if (s.statusById[id] === state) return s; // no-op: skip needless updates
    return { statusById: { ...s.statusById, [id]: state } };
  }),

  setBlackboard: (vars) => set((s) => {
    const now = Date.now();
    const touched = { ...s.blackboardTouched };
    for (const [k, v] of Object.entries(vars)) {
      if (s.blackboard[k] !== v) touched[k] = now;
    }
    return { blackboard: { ...s.blackboard, ...vars }, blackboardTouched: touched };
  }),

  select: (id) => set({ selectedNodeId: id }),

  toggleCollapse: (id) => set((s) => {
    const next = new Set(s.collapsed);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { collapsed: next };
  }),

  reset: () => set(() => ({ ...EMPTY, nodesById: new Map(), statusById: {}, blackboard: {}, blackboardTouched: {}, collapsed: new Set() })),
}));
