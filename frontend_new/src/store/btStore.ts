import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { BTBlueprint, BTNodeDef, NodeStatus } from '../bt/types';

// One running tree's live state. The store holds many of these keyed by
// tree_id so several executors / trees can stream at once; the UI shows the
// active one and offers a selector to switch.
interface TreeState {
  blueprint: BTBlueprint;
  nodesById: Map<number, BTNodeDef>;
  statusById: Record<number, NodeStatus>;
  blackboard: Record<string, unknown>;
  blackboardTouched: Record<string, number>;
}

interface BTState {
  trees: Record<string, TreeState>;
  activeTreeId: string | null;
  selectedNodeId: number | null;
  collapsed: Set<number>;

  loadBlueprint: (bp: BTBlueprint) => void;
  applyDelta: (treeId: string, id: number, state: NodeStatus) => void;
  setBlackboard: (treeId: string, vars: Record<string, unknown>) => void;
  setActiveTree: (treeId: string) => void;
  select: (id: number | null) => void;
  toggleCollapse: (id: number) => void;
  collapseAll: () => void;
  collapseSubtrees: () => void;
  expandAll: () => void;
  reset: () => void;
}

export const useBtStore = create<BTState>((set) => ({
  trees: {},
  activeTreeId: null,
  selectedNodeId: null,
  collapsed: new Set<number>(),

  loadBlueprint: (bp) => set((s) => {
    const existing = s.trees[bp.tree_id];
    // Preserve live status across blueprint re-broadcasts of the same version.
    if (existing && existing.blueprint.version === bp.version) return s;
    const tree: TreeState = {
      blueprint: bp,
      nodesById: new Map(bp.nodes.map((n) => [n.id, n])),
      // Include decorator ids so Precondition / Timeout / Retry caps track their
      // own status independently from the core node they wrap.
      statusById: Object.fromEntries([
        ...bp.nodes.map((n) => [n.id, 'IDLE' as NodeStatus]),
        ...bp.nodes.flatMap((n) => n.decorators.map((d) => [d.id, 'IDLE' as NodeStatus])),
      ]) as Record<number, NodeStatus>,
      blackboard: existing?.blackboard ?? {},
      blackboardTouched: existing?.blackboardTouched ?? {},
    };
    return {
      trees: { ...s.trees, [bp.tree_id]: tree },
      activeTreeId: s.activeTreeId ?? bp.tree_id,
    };
  }),

  applyDelta: (treeId, id, state) => set((s) => {
    const tree = s.trees[treeId];
    if (!tree || tree.statusById[id] === state) return s;
    return {
      trees: { ...s.trees, [treeId]: { ...tree, statusById: { ...tree.statusById, [id]: state } } },
    };
  }),

  setBlackboard: (treeId, vars) => set((s) => {
    const tree = s.trees[treeId];
    if (!tree) return s;
    const now = Date.now();
    const touched = { ...tree.blackboardTouched };
    const merged = { ...tree.blackboard };
    for (const [k, v] of Object.entries(vars)) {
      // Don't overwrite a live (non-null) value with a skeleton null — the
      // skeleton is re-emitted every ~3 s alongside the blueprint and would
      // otherwise stomp on values pushed via the HTTP side-channel.
      if (v === null && merged[k] != null) continue;
      if (merged[k] !== v) touched[k] = now;
      merged[k] = v;
    }
    return {
      trees: {
        ...s.trees,
        [treeId]: { ...tree, blackboard: merged, blackboardTouched: touched },
      },
    };
  }),

  setActiveTree: (treeId) => set({ activeTreeId: treeId, selectedNodeId: null, collapsed: new Set() }),
  select: (id) => set({ selectedNodeId: id }),
  toggleCollapse: (id) => set((s) => {
    const next = new Set(s.collapsed);
    if (next.has(id)) next.delete(id); else next.add(id);
    return { collapsed: next };
  }),

  collapseAll: () => set((s) => {
    const tree = s.activeTreeId ? s.trees[s.activeTreeId] : undefined;
    if (!tree) return s;
    const next = new Set<number>();
    for (const n of tree.blueprint.nodes) {
      if (n.children.length > 0 && n.id !== tree.blueprint.root_id) next.add(n.id);
    }
    return { collapsed: next };
  }),
  collapseSubtrees: () => set((s) => {
    const tree = s.activeTreeId ? s.trees[s.activeTreeId] : undefined;
    if (!tree) return s;
    const next = new Set(s.collapsed);
    for (const n of tree.blueprint.nodes) {
      if (n.category === 'subtree' || n.type === 'SubTree') next.add(n.id);
    }
    return { collapsed: next };
  }),
  expandAll: () => set({ collapsed: new Set() }),

  reset: () => set({ trees: {}, activeTreeId: null, selectedNodeId: null, collapsed: new Set() }),
}));

// --- Selectors scoped to the active tree -----------------------------------
const EMPTY_BB: Record<string, unknown> = {};
const EMPTY_TOUCHED: Record<string, number> = {};

function active(s: BTState): TreeState | undefined {
  return s.activeTreeId ? s.trees[s.activeTreeId] : undefined;
}

export const useActiveBlueprint = () => useBtStore((s) => active(s)?.blueprint ?? null);
export const useTreeRootStatus = (treeId: string): NodeStatus =>
  useBtStore((s) => {
    const tree = s.trees[treeId];
    if (!tree) return 'IDLE';
    return tree.statusById[tree.blueprint.root_id] ?? 'IDLE';
  });
export const useActiveNodesById = () => useBtStore((s) => active(s)?.nodesById);
export const useNodeDef = (id: number) => useBtStore((s) => active(s)?.nodesById.get(id));
export const useNodeStatus = (id: number): NodeStatus =>
  useBtStore((s) => active(s)?.statusById[id] ?? 'IDLE');
export const useActiveBlackboard = () => useBtStore((s) => active(s)?.blackboard ?? EMPTY_BB);
export const useActiveBlackboardTouched = () => useBtStore((s) => active(s)?.blackboardTouched ?? EMPTY_TOUCHED);
// useShallow: Object.keys returns a fresh array each read, which would make
// useSyncExternalStore loop forever. Shallow-compare so the ref is stable until
// the set of trees actually changes.
export const useTreeIds = () => useBtStore(useShallow((s) => Object.keys(s.trees)));

// Live status tally for the active tree — feeds the header stat chips.
export const useActiveStatusCounts = () =>
  useBtStore(useShallow((s) => {
    const counts = { running: 0, success: 0, failure: 0, idle: 0 };
    const tree = active(s);
    if (tree) {
      for (const st of Object.values(tree.statusById)) {
        if (st === 'RUNNING') counts.running++;
        else if (st === 'SUCCESS') counts.success++;
        else if (st === 'FAILURE') counts.failure++;
        else counts.idle++;
      }
    }
    return counts;
  }));
