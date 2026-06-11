import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';

export interface ArcEdge {
  id: string;
  sourceId: string;
  targetId: string;
  color: THREE.Color;
  width: number;
  opacity: number;
  lateral: number; // -1 to 1 lateral offset factor
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

function computeLateral(id: string): number {
  return (((hashStr(id) % 200) / 100) - 1);
}

export function buildBezierArc(
  src: THREE.Vector3, dst: THREE.Vector3, lateral: number, segments = 11
): Float32Array {
  const mid = new THREE.Vector3().addVectors(src, dst).multiplyScalar(0.5);
  const dir = new THREE.Vector3().subVectors(dst, src);
  const dist = dir.length();
  const bulge = Math.min(dist * 0.18, 2.2);
  const lift = bulge * 0.35;

  // Perpendicular in XZ
  const perp = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
  const ctrl = mid.clone().addScaledVector(perp, lateral * bulge);
  ctrl.y += lift;

  const positions = new Float32Array(segments * 3);
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const it = 1 - t;
    const x = it * it * src.x + 2 * it * t * ctrl.x + t * t * dst.x;
    const y = it * it * src.y + 2 * it * t * ctrl.y + t * t * dst.y;
    const z = it * it * src.z + 2 * it * t * ctrl.z + t * t * dst.z;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
  }
  return positions;
}

export function getPointOnArc(positions: Float32Array, t: number): THREE.Vector3 {
  const segments = positions.length / 3;
  const idx = t * (segments - 1);
  const i0 = Math.floor(idx);
  const i1 = Math.min(i0 + 1, segments - 1);
  const frac = idx - i0;
  return new THREE.Vector3(
    positions[i0 * 3] + (positions[i1 * 3] - positions[i0 * 3]) * frac,
    positions[i0 * 3 + 1] + (positions[i1 * 3 + 1] - positions[i0 * 3 + 1]) * frac,
    positions[i0 * 3 + 2] + (positions[i1 * 3 + 2] - positions[i0 * 3 + 2]) * frac,
  );
}

export class EdgeRenderer {
  private scene: THREE.Scene;
  private lines: Map<string, { line: Line2; material: LineMaterial; geometry: LineGeometry; arc: ArcEdge }> = new Map();
  private resolution = new THREE.Vector2(1920, 1080);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  setResolution(w: number, h: number) {
    this.resolution.set(w, h);
    for (const { material } of this.lines.values()) material.resolution.set(w, h);
  }

  updateEdges(
    edges: ArcEdge[],
    getPosition: (id: string) => THREE.Vector3 | null
  ) {
    const incoming = new Set(edges.map(e => e.id));

    // Remove old
    for (const [id, entry] of this.lines) {
      if (!incoming.has(id)) {
        this.scene.remove(entry.line);
        entry.geometry.dispose();
        entry.material.dispose();
        this.lines.delete(id);
      }
    }

    // Add/update
    for (const edge of edges) {
      const src = getPosition(edge.sourceId);
      const dst = getPosition(edge.targetId);
      if (!src || !dst) continue;

      const positions = buildBezierArc(src, dst, edge.lateral);

      let entry = this.lines.get(edge.id);
      if (!entry) {
        const geometry = new LineGeometry();
        geometry.setPositions(positions as unknown as number[]);
        const material = new LineMaterial({
          color: edge.color.getHex(),
          linewidth: edge.width,
          transparent: true,
          opacity: edge.opacity,
          resolution: this.resolution,
          worldUnits: false,
        });
        const line = new Line2(geometry, material);
        line.computeLineDistances();
        this.scene.add(line);
        entry = { line, material, geometry, arc: edge };
        this.lines.set(edge.id, entry);
      } else {
        entry.geometry.setPositions(positions as unknown as number[]);
        entry.line.computeLineDistances();
        entry.material.color.copy(edge.color);
        entry.material.linewidth = edge.width;
        entry.material.opacity = edge.opacity;
        entry.arc = edge;
      }
    }
  }

  getArcPositions(edgeId: string, getPosition: (id: string) => THREE.Vector3 | null): Float32Array | null {
    const entry = this.lines.get(edgeId);
    if (!entry) return null;
    const src = getPosition(entry.arc.sourceId);
    const dst = getPosition(entry.arc.targetId);
    if (!src || !dst) return null;
    return buildBezierArc(src, dst, entry.arc.lateral);
  }

  setVisibility(edgeId: string, visible: boolean) {
    const entry = this.lines.get(edgeId);
    if (entry) entry.line.visible = visible;
  }

  setEdgeOpacity(edgeId: string, opacity: number) {
    const entry = this.lines.get(edgeId);
    if (entry) entry.material.opacity = opacity;
  }

  getEdgeIds(): string[] {
    return [...this.lines.keys()];
  }

  computeLateralForEdge(edgeId: string): number {
    return computeLateral(edgeId);
  }

  dispose() {
    for (const { line, geometry, material } of this.lines.values()) {
      this.scene.remove(line);
      geometry.dispose();
      material.dispose();
    }
    this.lines.clear();
  }
}
