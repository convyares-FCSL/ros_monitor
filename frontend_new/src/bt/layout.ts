import type { BTBlueprint, BTNodeDef } from './types';

// Layout geometry — kept in sync with the rendered block heights in BTNode so
// the SVG wires line up with the HTML node boxes.
export const NODE_W = 200;        // interior / SubTree / default node width
export const NODE_W_CTRL = 150;   // pure structural control node (narrower)
export const NODE_W_LEAF = 170;   // true leaf node — slightly narrower for density
export const NODE_W_STAMP = 52;   // Always*/Force* square stamp (52×52 matches CORE_H)
export const CAP_H = 24;          // decorator cap
export const SVC_H = 22;          // service row
export const CORE_H = 52;         // default interior node core block
export const CORE_H_CTRL = 42;    // structural control node (Sequence/Fallback/Parallel)
export const CORE_H_LEAF = 36;    // compact leaf node (no children)
export const CORE_H_STAMP = 52;   // Always*/Force* square stamp
export const ROW_GAP = 168;       // vertical distance between depth levels
export const GAP_X = 40;          // gap for interior / collapsed nodes
export const GAP_X_LEAF = 10;     // tight gap for true leaf nodes (blueprint children = 0)

// Node types that are purely structural (flow control, no payload).
const CTRL_TYPES = new Set([
  'Sequence', 'ReactiveSequence',
  'Fallback', 'ReactiveFallback',
  'Parallel',
]);

// Node types rendered as square icon stamps (dominant ✓ / ✗ symbol, no text).
export const STAMP_TYPES = new Set([
  'AlwaysSuccess', 'ForceSuccess',
  'AlwaysFailure', 'ForceFailure',
]);

export interface NodeBox {
  id: number;
  x: number; y: number; w: number; h: number;
  capsH: number; svcsH: number;
  hasChildren: boolean;
  coreH: number;          // actual core height: CORE_H or CORE_H_LEAF
  descendantCount: number; // total descendants in blueprint (for collapse badge)
}

export interface Wire {
  childId: number;
  /** Ids of decorators folded into the child block (for wire active-state check). */
  decoratorIds: number[];
  d: string;
}

export interface BTLayout {
  boxes: Map<number, NodeBox>;
  wires: Wire[];
  width: number;
  height: number;
}

export function blockHeight(n: BTNodeDef): number {
  let coreH: number;
  if (STAMP_TYPES.has(n.type)) coreH = CORE_H_STAMP;
  else if (n.children.length === 0) coreH = CORE_H_LEAF;
  else if (CTRL_TYPES.has(n.type)) coreH = CORE_H_CTRL;
  else coreH = CORE_H;
  return CAP_H * n.decorators.length + SVC_H * n.services.length + coreH;
}

// Tidy top-to-bottom layout: leaves take sequential x slots, internal nodes
// center over their children, depth maps to row. Collapsed nodes hide their
// subtree (children not placed, no outgoing wires).
export function computeLayout(bp: BTBlueprint, collapsed: Set<number>): BTLayout {
  const byId = new Map(bp.nodes.map((n) => [n.id, n]));
  const boxes = new Map<number, NodeBox>();
  let nextLeafX = 0;

  // Pre-compute total descendant counts (all descendants in blueprint, not
  // layout-visible). Used for the collapsed-badge ("▸ 12").
  const descCount = new Map<number, number>();
  function countDesc(id: number): number {
    if (descCount.has(id)) return descCount.get(id)!;
    const n = byId.get(id);
    if (!n || n.children.length === 0) { descCount.set(id, 0); return 0; }
    const c = n.children.reduce((s, cid) => s + 1 + countDesc(cid), 0);
    descCount.set(id, c);
    return c;
  }
  for (const n of bp.nodes) countDesc(n.id);

  function assign(id: number, depth: number): number {
    const n = byId.get(id);
    if (!n) return nextLeafX;
    const capsH = CAP_H * n.decorators.length;
    const svcsH = SVC_H * n.services.length;
    const isStamp = STAMP_TYPES.has(n.type);
    const blueprintLeaf = n.children.length === 0;
    const isCtrl = !isStamp && !blueprintLeaf && CTRL_TYPES.has(n.type);
    // Width: stamps are square, ctrl nodes are narrow, blueprint leaves are
    // slightly narrower than interior nodes for denser horizontal packing.
    const w = isStamp ? NODE_W_STAMP
            : isCtrl  ? NODE_W_CTRL
            : blueprintLeaf ? NODE_W_LEAF
            : NODE_W;
    let coreH: number;
    if (isStamp) coreH = CORE_H_STAMP;
    else if (blueprintLeaf) coreH = CORE_H_LEAF;
    else if (isCtrl) coreH = CORE_H_CTRL;
    else coreH = CORE_H;
    const h = capsH + svcsH + coreH;
    const y = depth * ROW_GAP;
    const kids = collapsed.has(id) ? [] : n.children;
    const descendantCount = descCount.get(id) ?? 0;

    if (kids.length === 0) {
      // True blueprint leaves (and stamp leaves) get a tight gap; collapsed
      // interior nodes keep the wider gap because they represent hidden subtrees.
      const gap = blueprintLeaf ? GAP_X_LEAF : GAP_X;
      const x = nextLeafX;
      nextLeafX += w + gap;
      boxes.set(id, { id, x, y, w, h, capsH, svcsH, hasChildren: n.children.length > 0, coreH, descendantCount });
      return x + w / 2;
    }
    const centers = kids.map((c) => assign(c, depth + 1));
    const center = (centers[0] + centers[centers.length - 1]) / 2;
    boxes.set(id, { id, x: center - w / 2, y, w, h, capsH, svcsH, hasChildren: true, coreH, descendantCount });
    return center;
  }
  assign(bp.root_id, 0);

  const wires: Wire[] = [];
  for (const n of bp.nodes) {
    if (collapsed.has(n.id)) continue;
    const pb = boxes.get(n.id);
    if (!pb) continue;
    for (const childId of n.children) {
      const cb = boxes.get(childId);
      if (!cb) continue;
      const px = pb.x + pb.w / 2;
      const pBottom = pb.y + pb.h;
      const cx = cb.x + cb.w / 2;
      const cTop = cb.y;
      const midY = pBottom + (cTop - pBottom) / 2;
      const childNode = byId.get(childId);
      const decoratorIds = childNode?.decorators.map((d) => d.id) ?? [];
      // Orthogonal: down to a shared mid-rail, across, down to the child top.
      wires.push({ childId, decoratorIds, d: `M ${px} ${pBottom} V ${midY} H ${cx} V ${cTop}` });
    }
  }

  let width = 0;
  let height = 0;
  for (const b of boxes.values()) {
    width = Math.max(width, b.x + b.w);
    height = Math.max(height, b.y + b.h);
  }
  return { boxes, wires, width, height };
}
