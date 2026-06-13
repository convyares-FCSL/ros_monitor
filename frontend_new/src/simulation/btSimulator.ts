import { useBtStore } from '../store/btStore';
import type { BTBlueprint, BTNodeDef, NodeStatus } from '../bt/types';

// Client-side Behavior Tree simulator — a fake tree that runs entirely in the
// browser (no bridge / --bt needed), mirroring the ROS Introspection sim toggle.
// Handy for UI development and tuning the Settings page styling offline.

const IDLE: NodeStatus = 'IDLE';
const RUNNING: NodeStatus = 'RUNNING';
const SUCCESS: NodeStatus = 'SUCCESS';
const FAILURE: NodeStatus = 'FAILURE';

const TREE_ID = 'DevTree (sim)';

const DEMO: BTBlueprint = {
  tree_id: TREE_ID,
  version: 1,
  root_id: 1,
  nodes: [
    { id: 1, name: 'DevRoot', type: 'Sequence', category: 'control', children: [2, 10, 20], decorators: [], services: [], ports: {} },
    { id: 2, name: 'IsReady', type: 'Condition', category: 'condition', children: [], decorators: [], services: [], ports: { input: { ready: '{ready_flag}' } } },
    { id: 10, name: 'ChooseRoute', type: 'Fallback', category: 'control', children: [11, 12], decorators: [], services: [], ports: {} },
    {
      id: 11, name: 'PlanFast', type: 'Action', category: 'action', children: [],
      decorators: [{ id: 111, name: 'Timeout', type: 'Timeout', ports: { msec: 3000 } }],
      services: [], ports: { input: { budget_ms: '{budget_ms}' } },
    },
    {
      id: 12, name: 'PlanSafe', type: 'Action', category: 'action', children: [],
      decorators: [], services: [{ id: 121, name: 'Replan', tick_ms: 200 }], ports: {},
    },
    { id: 20, name: 'Execute', type: 'SubTree', category: 'subtree', children: [21, 22], decorators: [], services: [], ports: {} },
    {
      id: 21, name: 'DriveTo', type: 'Action', category: 'action', children: [],
      decorators: [], services: [{ id: 211, name: 'Monitor', tick_ms: 100 }],
      ports: { input: { goal: '{goal}' }, output: { progress: '{progress}' } },
    },
    { id: 22, name: 'Confirm', type: 'Condition', category: 'condition', children: [], decorators: [], services: [], ports: { input: { at_goal: '{at_goal}' } } },
  ],
};

function makeLeaves(cycle: number): Map<number, Leaf> {
  // Variety across cycles: the fast plan fails every other run (→ fallback to
  // the safe plan), and confirmation occasionally fails (→ whole tree fails).
  const planFast = cycle % 2 === 0 ? SUCCESS : FAILURE;
  const confirm = cycle % 3 === 2 ? FAILURE : SUCCESS;
  return new Map<number, Leaf>([
    [2, new Leaf(0, SUCCESS)],
    [11, new Leaf(2, planFast)],
    [12, new Leaf(2, SUCCESS)],
    [21, new Leaf(5, SUCCESS)],
    [22, new Leaf(0, confirm)],
  ]);
}

function blackboard(t: number): Record<string, unknown> {
  return {
    ready_flag: true,
    budget_ms: 250,
    goal: 'dock_A',
    progress: Math.round((t % 10) / 10 * 100),
    at_goal: (t % 10) > 8,
  };
}

class Leaf {
  private remaining = 0;
  private active = false;
  constructor(private runningTicks: number, private outcome: NodeStatus) {}
  tick(): NodeStatus {
    if (!this.active) { this.remaining = this.runningTicks; this.active = true; }
    if (this.remaining > 0) { this.remaining--; return RUNNING; }
    this.active = false;
    return this.outcome;
  }
  reset() { this.remaining = 0; this.active = false; }
}

// Minimal BT executor (Sequence-with-memory / Fallback / leaf dwell) — enough
// to animate the tree believably for development.
class Engine {
  private nodes = new Map<number, BTNodeDef>();
  private status = new Map<number, NodeStatus>();
  private cursor = new Map<number, number>();
  private leaves = makeLeaves(0);
  private cycle = 0;

  constructor() {
    for (const n of DEMO.nodes) { this.nodes.set(n.id, n); this.status.set(n.id, IDLE); }
  }

  private set(id: number, s: NodeStatus) {
    if (this.status.get(id) !== s) {
      this.status.set(id, s);
      useBtStore.getState().applyDelta(TREE_ID, id, s);
    }
  }

  private resetSubtree(id: number) {
    this.set(id, IDLE);
    this.leaves.get(id)?.reset();
    for (const c of this.nodes.get(id)!.children) this.resetSubtree(c);
  }

  private tick(id: number): NodeStatus {
    const n = this.nodes.get(id)!;
    if (n.children.length === 0) {
      const s = this.leaves.get(id)!.tick();
      this.set(id, s);
      return s;
    }
    const s = n.type === 'Fallback' ? this.tickFallback(n) : this.tickSequence(n);
    this.set(id, s);
    return s;
  }

  private tickSequence(n: BTNodeDef): NodeStatus {
    const start = this.cursor.get(n.id) ?? 0;
    for (let i = start; i < n.children.length; i++) {
      const cs = this.tick(n.children[i]);
      if (cs === RUNNING) {
        this.cursor.set(n.id, i);
        for (const later of n.children.slice(i + 1)) this.resetSubtree(later);
        return RUNNING;
      }
      if (cs === FAILURE) {
        this.cursor.set(n.id, 0);
        for (const later of n.children.slice(i + 1)) this.resetSubtree(later);
        return FAILURE;
      }
    }
    this.cursor.set(n.id, 0);
    return SUCCESS;
  }

  private tickFallback(n: BTNodeDef): NodeStatus {
    for (let i = 0; i < n.children.length; i++) {
      const cs = this.tick(n.children[i]);
      if (cs === RUNNING || cs === SUCCESS) {
        for (const later of n.children.slice(i + 1)) this.resetSubtree(later);
        return cs;
      }
    }
    return FAILURE;
  }

  tickRoot() {
    const s = this.tick(DEMO.root_id);
    if (s === SUCCESS || s === FAILURE) {
      this.cycle++;
      this.leaves = makeLeaves(this.cycle);
      this.cursor.clear();
      this.resetSubtree(DEMO.root_id);
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let engine: Engine | null = null;
let paused = false;
let startedAt = 0;

export const btSimulator = {
  start() {
    if (timer) return;
    useBtStore.getState().loadBlueprint(DEMO);
    engine = new Engine();
    startedAt = Date.now();
    timer = setInterval(() => {
      if (paused || !engine) return;
      engine.tickRoot();
      useBtStore.getState().setBlackboard(TREE_ID, blackboard((Date.now() - startedAt) / 1000));
    }, 400);
  },
  stop() {
    if (timer) clearInterval(timer);
    timer = null;
    engine = null;
    useBtStore.getState().reset();
  },
  setPaused(p: boolean) { paused = p; },
};
