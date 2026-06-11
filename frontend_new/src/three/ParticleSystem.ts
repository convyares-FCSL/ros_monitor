import * as THREE from 'three';
import { getPointOnArc, buildBezierArc } from './EdgeRenderer';

interface ActiveParticle {
  id: string;
  edgeId: string;
  sourceId: string;
  targetId: string;
  lateral: number;
  progress: number;
  speed: number;
  mesh: THREE.Mesh;
  frozen: boolean;
  color: number;
  topic?: string;
  payload?: Record<string, unknown> | null;
  msg_type?: string;
  size_bytes?: number;
  timestamp?: number;
  dropped_payload?: boolean;
  onArrive?: () => void;
}

const MAX_PARTICLES = 60;

export class ParticleSystem {
  private scene: THREE.Scene;
  private particles: ActiveParticle[] = [];
  private throttle: Map<string, number> = new Map();
  private nextId = 0;
  public scale = 1.0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  // Per-topic spawn throttle, managed by the caller so that one message can
  // spawn a particle on EVERY publisher edge of the topic (reference behavior)
  isThrottled(topic: string): boolean {
    return Date.now() - (this.throttle.get(topic) ?? 0) < 300;
  }

  markSpawn(topic: string) {
    this.throttle.set(topic, Date.now());
  }

  spawnMessageParticle(
    edgeId: string,
    sourceId: string,
    targetId: string,
    lateral: number,
    topic: string,
    msg_type: string,
    payload: Record<string, unknown> | null,
    size_bytes: number,
    timestamp: number,
    dropped_payload: boolean,
    getPosition: (id: string) => THREE.Vector3 | null,
    onArrive?: () => void,
    color: number = 0xf97316
  ): boolean {
    if (this.particles.length >= MAX_PARTICLES) this.removeOldest();

    const src = getPosition(sourceId);
    if (!src) return false;

    const geo = new THREE.SphereGeometry(0.2, 10, 10);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(src);
    this.scene.add(mesh);

    this.particles.push({
      id: `p-${++this.nextId}`,
      edgeId, sourceId, targetId, lateral,
      // Match the reference crossing speed (~0.06 progress/frame)
      progress: 0, speed: 0.05 + Math.random() * 0.02,
      mesh, frozen: false, color,
      topic, payload, msg_type, size_bytes, timestamp, dropped_payload,
      onArrive,
    });
    return true;
  }

  spawnContinuationParticle(
    edgeId: string,
    sourceId: string,
    targetId: string,
    lateral: number,
    topic: string,
    msg_type: string,
    payload: Record<string, unknown> | null,
    size_bytes: number,
    timestamp: number,
    dropped_payload: boolean,
    getPosition: (id: string) => THREE.Vector3 | null,
    color: number = 0xf97316
  ): boolean {
    if (this.particles.length >= MAX_PARTICLES) this.removeOldest();
    const src = getPosition(sourceId);
    if (!src) return false;

    const geo = new THREE.SphereGeometry(0.18, 10, 10);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(src);
    this.scene.add(mesh);

    this.particles.push({
      id: `p-${++this.nextId}`,
      edgeId, sourceId, targetId, lateral,
      progress: 0, speed: 0.055 + Math.random() * 0.015,
      mesh, frozen: false, color,
      topic, payload, msg_type, size_bytes, timestamp, dropped_payload,
    });
    return true;
  }

  spawnServiceParticle(
    edgeId: string,
    sourceId: string,
    targetId: string,
    lateral: number,
    getPosition: (id: string) => THREE.Vector3 | null,
    onArrive?: () => void,
    color: number = 0x10b981
  ): boolean {
    if (this.particles.length >= MAX_PARTICLES) this.removeOldest();
    const src = getPosition(sourceId);
    if (!src) return false;

    const geo = new THREE.SphereGeometry(0.2, 10, 10);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(src);
    this.scene.add(mesh);

    this.particles.push({
      id: `p-${++this.nextId}`,
      edgeId, sourceId, targetId, lateral,
      progress: 0, speed: 0.06,
      mesh, frozen: false, color,
      onArrive,
    });
    return true;
  }

  spawnServiceContinuation(
    edgeId: string,
    sourceId: string,
    targetId: string,
    lateral: number,
    getPosition: (id: string) => THREE.Vector3 | null,
    color: number = 0x10b981
  ): boolean {
    if (this.particles.length >= MAX_PARTICLES) this.removeOldest();
    const src = getPosition(sourceId);
    if (!src) return false;

    const geo = new THREE.SphereGeometry(0.18, 10, 10);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(src);
    this.scene.add(mesh);

    this.particles.push({
      id: `p-${++this.nextId}`,
      edgeId, sourceId, targetId, lateral,
      progress: 0, speed: 0.065,
      mesh, frozen: false, color,
    });
    return true;
  }

  update(getPosition: (id: string) => THREE.Vector3 | null) {
    const toRemove: string[] = [];
    const arrivals: (() => void)[] = [];

    for (const p of this.particles) {
      if (p.frozen) continue;
      p.progress += p.speed;
      if (p.progress >= 1) {
        if (p.onArrive) arrivals.push(p.onArrive);
        toRemove.push(p.id);
        continue;
      }

      const src = getPosition(p.sourceId);
      const dst = getPosition(p.targetId);
      if (!src || !dst) { toRemove.push(p.id); continue; }

      const arc = buildBezierArc(src, dst, p.lateral);
      const pos = getPointOnArc(arc, p.progress);
      p.mesh.position.copy(pos);
      p.mesh.scale.setScalar(this.scale);
    }

    for (const id of toRemove) this.removeParticle(id);
    for (const fn of arrivals) fn();
  }

  freezeParticle(particleId: string) {
    const p = this.particles.find(pp => pp.id === particleId);
    if (p) {
      p.frozen = true;
      p.mesh.scale.set(2, 2, 2);
      (p.mesh.material as THREE.MeshBasicMaterial).wireframe = true;
    }
  }

  unfreezeAll() {
    for (const p of this.particles) {
      if (p.frozen) {
        p.frozen = false;
        p.mesh.scale.set(1, 1, 1);
        (p.mesh.material as THREE.MeshBasicMaterial).wireframe = false;
      }
    }
  }

  getParticleMeshes(): THREE.Mesh[] {
    return this.particles.filter(p => !p.frozen).map(p => p.mesh);
  }

  getParticleById(id: string): ActiveParticle | undefined {
    return this.particles.find(p => p.id === id);
  }

  getParticleByMesh(mesh: THREE.Object3D): ActiveParticle | undefined {
    return this.particles.find(p => p.mesh === mesh);
  }

  private removeOldest() {
    const oldest = this.particles.find(p => !p.frozen);
    if (oldest) this.removeParticle(oldest.id);
  }

  private removeParticle(id: string) {
    const idx = this.particles.findIndex(p => p.id === id);
    if (idx < 0) return;
    const p = this.particles[idx];
    this.scene.remove(p.mesh);
    p.mesh.geometry.dispose();
    (p.mesh.material as THREE.Material).dispose();
    this.particles.splice(idx, 1);
  }

  clear() {
    for (const p of [...this.particles]) this.removeParticle(p.id);
  }

  dispose() {
    this.clear();
  }
}
