export interface LayoutNode {
  id: string;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  fixed?: boolean;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

const REPULSION = 18;
const SPRING_K = 0.08;
const REST_LENGTH = 6;
const GRAVITY = 0.05;
const DAMPING = 0.85;
const MAX_SPEED = 0.5;

export class ForceLayout {
  nodes: Map<string, LayoutNode> = new Map();
  edges: LayoutEdge[] = [];

  setNodes(ids: string[]) {
    const existing = new Set(this.nodes.keys());
    const incoming = new Set(ids);

    for (const id of ids) {
      if (!this.nodes.has(id)) {
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const r = 8 + Math.random() * 12;
        this.nodes.set(id, {
          id,
          x: r * Math.sin(phi) * Math.cos(theta),
          y: r * Math.cos(phi) * 0.3,
          z: r * Math.sin(phi) * Math.sin(theta),
          vx: 0, vy: 0, vz: 0,
        });
      }
    }

    for (const id of existing) {
      if (!incoming.has(id)) this.nodes.delete(id);
    }
  }

  setEdges(edges: LayoutEdge[]) {
    this.edges = edges;
  }

  step() {
    const nodeArr = [...this.nodes.values()].filter(n => !n.fixed);
    const allNodes = [...this.nodes.values()];

    // Repulsion (inverse-square)
    for (let i = 0; i < allNodes.length; i++) {
      for (let j = i + 1; j < allNodes.length; j++) {
        const a = allNodes[i], b = allNodes[j];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        const dist2 = dx * dx + dy * dy + dz * dz + 0.01;
        const dist = Math.sqrt(dist2);
        const force = REPULSION / dist2;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        const fz = (dz / dist) * force;
        if (!a.fixed) { a.vx -= fx; a.vy -= fy; a.vz -= fz; }
        if (!b.fixed) { b.vx += fx; b.vy += fy; b.vz += fz; }
      }
    }

    // Spring attraction along edges
    for (const edge of this.edges) {
      const a = this.nodes.get(edge.source);
      const b = this.nodes.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
      const displacement = dist - REST_LENGTH;
      const force = SPRING_K * displacement;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      const fz = (dz / dist) * force;
      if (!a.fixed) { a.vx += fx; a.vy += fy; a.vz += fz; }
      if (!b.fixed) { b.vx -= fx; b.vy -= fy; b.vz -= fz; }
    }

    // Central gravity
    for (const n of nodeArr) {
      n.vx -= n.x * GRAVITY;
      n.vy -= n.y * GRAVITY;
      n.vz -= n.z * GRAVITY;
    }

    // Integrate + damping + speed cap
    for (const n of nodeArr) {
      n.vx *= DAMPING; n.vy *= DAMPING; n.vz *= DAMPING;
      const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy + n.vz * n.vz);
      if (speed > MAX_SPEED) {
        const s = MAX_SPEED / speed;
        n.vx *= s; n.vy *= s; n.vz *= s;
      }
      n.x += n.vx; n.y += n.vy; n.z += n.vz;
    }
  }

  getPosition(id: string): [number, number, number] | null {
    const n = this.nodes.get(id);
    return n ? [n.x, n.y, n.z] : null;
  }
}
