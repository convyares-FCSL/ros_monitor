import type { BTBlueprint, BTNodeDef } from './types';

// Layout geometry — kept in sync with the rendered block heights in BTNode so
// the SVG wires line up with the HTML node boxes.
export const NODE_W = 200;
export const CAP_H = 24;   // decorator cap
export const SVC_H = 22;   // service row
export const CORE_H = 52;  // core task block
export const ROW_GAP = 168; // vertical distance between depth levels
export const GAP_X = 40;   // horizontal gap between sibling leaves

export interface NodeBox {
  id: number;
  x: number; y: number; w: number; h: number;
  capsH: number; svcsH: number;
  hasChildren: boolean;
}

export interface Wire {
  childId: number;
  d: string;
}

export interface BTLayout {
  boxes: Map<number, NodeBox>;
  wires: Wire[];
  width: number;
  height: number;
}

export function blockHeight(n: BTNodeDef): number {
  return CAP_H * n.decorators.length + SVC_H * n.services.length + CORE_H;
}

// Tidy top-to-bottom layout: leaves take sequential x slots, internal nodes
// center over their children, depth maps to row. Collapsed nodes hide their
// subtree (children not placed, no outgoing wires).
export function computeLayout(bp: BTBlueprint, collapsed: Set<number>): BTLayout {
  const byId = new Map(bp.nodes.map((n) => [n.id, n]));
  const boxes = new Map<number, NodeBox>();
  let nextLeafX = 0;

  function assign(id: number, depth: number): number {
    const n = byId.get(id);
    if (!n) return nextLeafX;
    const capsH = CAP_H * n.decorators.length;
    const svcsH = SVC_H * n.services.length;
    const h = capsH + svcsH + CORE_H;
    const y = depth * ROW_GAP;
    const kids = collapsed.has(id) ? [] : n.children;

    if (kids.length === 0) {
      const x = nextLeafX;
      nextLeafX += NODE_W + GAP_X;
      boxes.set(id, { id, x, y, w: NODE_W, h, capsH, svcsH, hasChildren: n.children.length > 0 });
      return x + NODE_W / 2;
    }
    const centers = kids.map((c) => assign(c, depth + 1));
    const center = (centers[0] + centers[centers.length - 1]) / 2;
    boxes.set(id, { id, x: center - NODE_W / 2, y, w: NODE_W, h, capsH, svcsH, hasChildren: true });
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
      // Orthogonal: down to a shared mid-rail, across, down to the child top.
      wires.push({ childId, d: `M ${px} ${pBottom} V ${midY} H ${cx} V ${cTop}` });
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
