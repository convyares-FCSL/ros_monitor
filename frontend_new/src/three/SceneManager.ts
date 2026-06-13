import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ForceLayout } from './ForceLayout';
import { EdgeRenderer, type ArcEdge } from './EdgeRenderer';
import { ParticleSystem } from './ParticleSystem';
import { makeTextSprite, makeHzBadge, updateLabelOpacity, updateSpriteColor } from './LabelSystem';
import type {
  GraphUpdate, RosNode, RosTopic, RosService, RosAction,
  TopicHzState, SelectedEntity, LifecycleState, DeadEndMode, SceneSettings
} from '../types';

let COLORS = {
  node: 0x06b6d4,
  topic: 0xf97316,
  service: 0x10b981,
  action: 0xa855f7,
  edgeTopic: 0xf97316,
  edgeTopicJitter: 0xf59e0b,
  edgeTopicStale: 0xef4444,
  edgeService: 0x10b981,
  edgeAction: 0xa855f7,
};

const LIFECYCLE_EMISSIVE: Record<string, { color: number; intensity: number; pulse?: boolean; strobe?: boolean }> = {
  unconfigured: { color: 0x64748b, intensity: 0.08 },
  inactive: { color: 0xf59e0b, intensity: 0.18, pulse: true },
  active: { color: 0x06b6d4, intensity: 0.55 },
  shuttingdown: { color: 0xef4444, intensity: 0.85, strobe: true },
  shutting_down: { color: 0xef4444, intensity: 0.85, strobe: true },
  error_processing: { color: 0xef4444, intensity: 0.85 },
  error: { color: 0xef4444, intensity: 0.85 },
  finalized: { color: 0x334155, intensity: 0.04 },
  phantom: { color: 0xffffff, intensity: 0.3, pulse: true },
};

interface SceneVertex {
  id: string;
  entityType: 'node' | 'topic' | 'service' | 'action';
  mesh: THREE.Object3D;
  label: THREE.Sprite;
  hzBadge?: THREE.Sprite;
  outlineShells: THREE.Mesh[];
  visible: boolean;
  opacity: number;
  targetOpacity: number;
}

// Generic items that are hidden by default
const GENERIC_TOPICS = new Set(['/rosout', '/parameter_events']);
const GENERIC_SERVICE_SUFFIXES = [
  '/describe_parameters', '/get_parameter_types', '/get_parameters',
  '/list_parameters', '/set_parameters', '/set_parameters_atomically', '/get_type_description'
];
const GENERIC_NODES = new Set(['ros2_websocket_bridge', 'rosbridge_websocket', 'rosapi', 'rosapi_params']);

// User overrides: id ("topic:/x" | "node:y" | "service:/z") -> true (force
// generic) | false (force not-generic). Defaults above apply when unset.
let genericOverrides = new Map<string, boolean>();
export function setGenericOverrides(overrides: Map<string, boolean>) {
  genericOverrides = new Map(overrides);
}

export function isGenericTopic(name: string): boolean {
  const o = genericOverrides.get(`topic:${name}`);
  if (o !== undefined) return o;
  return GENERIC_TOPICS.has(name);
}
export function isGenericService(name: string): boolean {
  const o = genericOverrides.get(`service:${name}`);
  if (o !== undefined) return o;
  return GENERIC_SERVICE_SUFFIXES.some(s => name.endsWith(s));
}
export function isGenericNode(name: string): boolean {
  const o = genericOverrides.get(`node:${name}`);
  if (o !== undefined) return o;
  return GENERIC_NODES.has(name) || name.startsWith('_ros2cli_daemon_');
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h;
}

const OUTLINE_SCALE = 1.12;
const outlineMaterialCache = new Map<number, THREE.MeshBasicMaterial>();

function getOutlineMaterial(color: number): THREE.MeshBasicMaterial {
  let mat = outlineMaterialCache.get(color);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.6,
    });
    outlineMaterialCache.set(color, mat);
  }
  return mat;
}

function createOutlineShell(sourceMesh: THREE.Mesh, color: number): THREE.Mesh {
  const shell = new THREE.Mesh(sourceMesh.geometry, getOutlineMaterial(color));
  shell.scale.setScalar(OUTLINE_SCALE);
  shell.visible = false;
  shell.raycast = () => {};
  return shell;
}

function createOutlineShellsForGroup(group: THREE.Group, color: number): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  group.traverse(child => {
    if (child instanceof THREE.Mesh) {
      meshes.push(child);
    }
  });
  const shells: THREE.Mesh[] = [];
  for (const mesh of meshes) {
    const shell = new THREE.Mesh(mesh.geometry, getOutlineMaterial(color));
    shell.scale.setScalar(OUTLINE_SCALE);
    shell.visible = false;
    shell.raycast = () => {};
    mesh.add(shell);
    shells.push(shell);
  }
  return shells;
}

export class SceneManager {
  private container: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private composer: EffectComposer;
  private layout: ForceLayout;
  private edgeRenderer: EdgeRenderer;
  private particles: ParticleSystem;
  private vertices: Map<string, SceneVertex> = new Map();
  private raycaster = new THREE.Raycaster();
  private frameId = 0;
  private time = 0;

  // Data
  private graph: GraphUpdate | null = null;
  private topicHz: Map<string, TopicHzState> = new Map();
  private lifecycleStates: Map<string, LifecycleState> = new Map();
  private hiddenItems: Set<string> = new Set();
  private hiddenTypes: Set<string> = new Set();
  private genericHidden = true;
  private deadEndMode: DeadEndMode = 'hidden';
  private isolatedSet: Set<string> | null = null;

  // Service activity tracking
  private serviceActivity: Map<string, number> = new Map();

  // Callbacks
  private onSelect: (entity: SelectedEntity | null) => void = () => {};
  private onParticleClick: (data: { topic: string; msg_type: string; payload: Record<string, unknown> | null; size_bytes: number; timestamp: number; dropped_payload: boolean; fromNode: string; toNode: string }) => void = () => {};
  private onRightClick: (entity: SelectedEntity | null, x: number, y: number) => void = () => {};

  // Docked service ports
  private dockedPorts: Map<string, { mesh: THREE.Mesh; hostId: string; angle: number; label: THREE.Sprite }> = new Map();
  private selectedEntityId: string | null = null;
  private lineThicknessMultiplier = 1.0;
  private packetScale = 1.0;
  private nodeEdgesEnabled = false;
  private topicEdgesEnabled = false;
  private serviceEdgesEnabled = false;
  private actionEdgesEnabled = false;
  private edgeColor = 0xffffff;
  private entityScales: Record<string, number> = { node: 1, topic: 1, service: 1, action: 1 };
  private labelScale = 1.0;
  private labelOffset = 2.2;
  private labelColor: 'white' | 'black' | 'entity' = 'entity';

  // Resolve a label colour: fixed white/black, or the entity's own colour
  private labelHexFor(entityType: string): string {
    if (this.labelColor === 'black') return '#000000';
    if (this.labelColor === 'white') return '#ffffff';
    const c = entityType === 'node' ? COLORS.node
      : entityType === 'topic' ? COLORS.topic
      : entityType === 'service' ? COLORS.service
      : COLORS.action;
    return '#' + c.toString(16).padStart(6, '0');
  }
  private edgeThickness = 1.12;
  private grid!: THREE.GridHelper;
  private bloomPass!: import('three/examples/jsm/postprocessing/UnrealBloomPass.js').UnrealBloomPass;

  constructor(container: HTMLDivElement) {
    this.container = container;

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x030712);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x030712, 0.012);

    this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 2000);
    this.camera.position.set(0, 20, 55);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxDistance = 300;
    this.controls.minDistance = 5;

    // Postprocessing
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.9, 0.55, 0.35);
    this.composer.addPass(this.bloomPass);

    // Lighting
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.3));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(50, 80, 40);
    this.scene.add(dir);

    // Floor grid
    this.grid = new THREE.GridHelper(200, 50, 0x0a1628, 0x0a1628);
    (this.grid.material as THREE.Material).opacity = 0.5;
    (this.grid.material as THREE.Material).transparent = true;
    this.grid.position.y = -15;
    this.scene.add(this.grid);

    // Starfield
    this.createStarfield();

    this.layout = new ForceLayout();
    this.edgeRenderer = new EdgeRenderer(this.scene);
    this.edgeRenderer.setResolution(container.clientWidth, container.clientHeight);
    this.particles = new ParticleSystem(this.scene);

    // Resize
    const ro = new ResizeObserver(() => this.handleResize());
    ro.observe(container);
    (this as unknown as { _ro: ResizeObserver })._ro = ro;

    // Click & right-click
    this.renderer.domElement.addEventListener('click', this.handleClick);
    this.renderer.domElement.addEventListener('contextmenu', this.handleRightClick);
  }

  private createStarfield() {
    const count = 1500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 800;
      positions[i + 1] = (Math.random() - 0.5) * 400 + 100;
      positions[i + 2] = (Math.random() - 0.5) * 800;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.3, transparent: true, opacity: 0.5 });
    this.scene.add(new THREE.Points(geo, mat));
  }

  private handleResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    this.edgeRenderer.setResolution(w, h);
  };

  private handleClick = (e: MouseEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(mouse, this.camera);

    // Check particles first
    const particleMeshes = this.particles.getParticleMeshes();
    const pHits = this.raycaster.intersectObjects(particleMeshes);
    if (pHits.length > 0) {
      const p = this.particles.getParticleByMesh(pHits[0].object);
      if (p && p.topic) {
        this.particles.freezeParticle(p.id);
        this.onParticleClick({
          topic: p.topic, msg_type: p.msg_type ?? '', payload: p.payload ?? null,
          size_bytes: p.size_bytes ?? 0, timestamp: p.timestamp ?? Date.now(),
          dropped_payload: p.dropped_payload ?? false,
          fromNode: p.sourceId, toNode: p.targetId,
        });
        return;
      }
    }

    // Check vertex meshes
    const meshes = [...this.vertices.values()].filter(v => v.visible).map(v => v.mesh);
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (hits.length > 0) {
      let hitObj: THREE.Object3D | null = hits[0].object;
      while (hitObj && !hitObj.userData.entityId) hitObj = hitObj.parent;
      if (hitObj?.userData.entityId) {
        const v = this.vertices.get(hitObj.userData.entityId);
        if (v) {
          this.selectedEntityId = v.id;
          this.onSelect({ entityType: v.entityType, id: v.id });
          return;
        }
      }
    }

    // Check docked ports
    const portMeshes = [...this.dockedPorts.values()].map(p => p.mesh);
    const portHits = this.raycaster.intersectObjects(portMeshes);
    if (portHits.length > 0) {
      const port = [...this.dockedPorts.entries()].find(([, p]) => p.mesh === portHits[0].object);
      if (port) {
        this.selectedEntityId = `service:${port[0]}`;
        this.onSelect({ entityType: 'service', id: port[0] });
        return;
      }
    }

    this.selectedEntityId = null;
    this.onSelect(null);
  };

  private handleRightClick = (e: MouseEvent) => {
    e.preventDefault();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(mouse, this.camera);

    const meshes = [...this.vertices.values()].filter(v => v.visible).map(v => v.mesh);
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (hits.length > 0) {
      let hitObj: THREE.Object3D | null = hits[0].object;
      while (hitObj && !hitObj.userData.entityId) hitObj = hitObj.parent;
      if (hitObj?.userData.entityId) {
        const v = this.vertices.get(hitObj.userData.entityId);
        if (v) {
          this.onRightClick({ entityType: v.entityType, id: v.id }, e.clientX, e.clientY);
          return;
        }
      }
    }

    // Check docked ports
    const portMeshes = [...this.dockedPorts.values()].map(p => p.mesh);
    const portHits = this.raycaster.intersectObjects(portMeshes);
    if (portHits.length > 0) {
      const port = [...this.dockedPorts.entries()].find(([, p]) => p.mesh === portHits[0].object);
      if (port) {
        this.onRightClick({ entityType: 'service', id: `service:${port[0]}` }, e.clientX, e.clientY);
        return;
      }
    }

    // Empty space right-click
    this.onRightClick(null, e.clientX, e.clientY);
  };

  setCallbacks(
    onSelect: (entity: SelectedEntity | null) => void,
    onParticleClick: typeof this.onParticleClick,
    onRightClick?: (entity: SelectedEntity | null, x: number, y: number) => void
  ) {
    this.onSelect = onSelect;
    this.onParticleClick = onParticleClick;
    if (onRightClick) this.onRightClick = onRightClick;
  }

  setSelectedEntity(id: string | null) {
    this.selectedEntityId = id;
  }

  setSceneColors(bg: number, fog: number) {
    this.renderer.setClearColor(bg);
    this.scene.background = new THREE.Color(bg);
    const fogObj = this.scene.fog as THREE.FogExp2;
    fogObj.color.setHex(fog);

    // Adjust grid to a slightly lighter shade of the background
    const gridColor = new THREE.Color(bg).lerp(new THREE.Color(0xffffff), 0.06);
    const mats = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    for (const m of mats) (m as THREE.LineBasicMaterial).color.copy(gridColor);
  }

  setEntityColors(colors: { node: number; topic: number; service: number; action: number }) {
    COLORS = {
      node: colors.node,
      topic: colors.topic,
      service: colors.service,
      action: colors.action,
      edgeTopic: colors.topic,
      edgeTopicJitter: 0xf59e0b,
      edgeTopicStale: 0xef4444,
      edgeService: colors.service,
      edgeAction: colors.action,
    };
    const hexStr = (c: number) => '#' + c.toString(16).padStart(6, '0');
    // Update existing vertex materials and labels
    for (const [, v] of this.vertices) {
      const color = v.entityType === 'node' ? colors.node
        : v.entityType === 'topic' ? colors.topic
        : v.entityType === 'service' ? colors.service
        : colors.action;
      if (v.mesh instanceof THREE.Mesh) {
        const mat = v.mesh.material as THREE.MeshStandardMaterial;
        mat.color.setHex(color);
        mat.emissive.setHex(color);
      } else if (v.mesh instanceof THREE.Group) {
        for (const child of v.mesh.children) {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            mat.color.setHex(color);
            mat.emissive.setHex(color);
          }
        }
      }
      updateSpriteColor(v.label, hexStr(color));
    }
    // Update docked ports
    for (const [, port] of this.dockedPorts) {
      const mat = port.mesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(colors.service);
      mat.emissive.setHex(colors.service);
      updateSpriteColor(port.label, hexStr(colors.service));
    }
  }

  setEmissiveIntensity(intensity: number) {
    for (const [, v] of this.vertices) {
      if (v.mesh instanceof THREE.Mesh) {
        const mat = v.mesh.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = intensity;
      } else if (v.mesh instanceof THREE.Group) {
        for (const child of v.mesh.children) {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            mat.emissiveIntensity = intensity;
          }
        }
      }
    }
    for (const [, port] of this.dockedPorts) {
      const mat = port.mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = intensity;
    }
  }

  applySceneSettings(settings: SceneSettings) {
    this.lineThicknessMultiplier = settings.lineThickness;
    this.packetScale = settings.packetScale ?? 1.5;
    this.nodeEdgesEnabled = settings.nodeEdges;
    this.topicEdgesEnabled = settings.topicEdges ?? false;
    this.serviceEdgesEnabled = settings.serviceEdges ?? false;
    this.actionEdgesEnabled = settings.actionEdges ?? false;
    this.edgeColor = parseInt((settings.edgeColor ?? '#ffffff').replace('#', ''), 16);
    if (settings.edgeThickness !== undefined) this.edgeThickness = settings.edgeThickness;

    const hexToInt = (hex: string) => parseInt(hex.replace('#', ''), 16);
    const entityMap: Record<string, { color: number; size: number; emissive: number; hex: string }> = {
      node: { color: hexToInt(settings.nodes.color), size: settings.nodes.size, emissive: settings.nodes.emissive, hex: settings.nodes.color },
      topic: { color: hexToInt(settings.topics.color), size: settings.topics.size, emissive: settings.topics.emissive, hex: settings.topics.color },
      service: { color: hexToInt(settings.services.color), size: settings.services.size, emissive: settings.services.emissive, hex: settings.services.color },
      action: { color: hexToInt(settings.actions.color), size: settings.actions.size, emissive: settings.actions.emissive, hex: settings.actions.color },
    };

    this.entityScales = {
      node: settings.nodes.size,
      topic: settings.topics.size,
      service: settings.services.size,
      action: settings.actions.size,
    };

    COLORS = {
      node: entityMap.node.color,
      topic: entityMap.topic.color,
      service: entityMap.service.color,
      action: entityMap.action.color,
      edgeTopic: entityMap.topic.color,
      edgeTopicJitter: 0xf59e0b,
      edgeTopicStale: 0xef4444,
      edgeService: entityMap.service.color,
      edgeAction: entityMap.action.color,
    };

    for (const [, v] of this.vertices) {
      const cfg = entityMap[v.entityType];
      if (!cfg) continue;

      if (v.mesh instanceof THREE.Mesh) {
        const mat = v.mesh.material as THREE.MeshStandardMaterial;
        mat.color.setHex(cfg.color);
        mat.emissive.setHex(cfg.color);
        mat.emissiveIntensity = cfg.emissive;
        mat.wireframe = false;
        v.mesh.scale.setScalar(cfg.size);
      } else if (v.mesh instanceof THREE.Group) {
        for (const child of v.mesh.children) {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial;
            mat.color.setHex(cfg.color);
            mat.emissive.setHex(cfg.color);
            mat.emissiveIntensity = cfg.emissive;
          }
        }
        v.mesh.scale.setScalar(cfg.size);
      }
      updateSpriteColor(v.label, this.labelHexFor(v.entityType));
    }

    // Toggle outline shells per entity type
    const outlineHex = this.edgeColor;
    for (const [, v] of this.vertices) {
      const shouldOutline =
        (v.entityType === 'node' && this.nodeEdgesEnabled) ||
        (v.entityType === 'topic' && this.topicEdgesEnabled) ||
        (v.entityType === 'service' && this.serviceEdgesEnabled) ||
        (v.entityType === 'action' && this.actionEdgesEnabled);
      for (const shell of v.outlineShells) {
        shell.visible = shouldOutline && v.visible;
        shell.scale.setScalar(this.edgeThickness);
        (shell.material as THREE.MeshBasicMaterial).color.setHex(outlineHex);
      }
    }

    for (const [, port] of this.dockedPorts) {
      const mat = port.mesh.material as THREE.MeshStandardMaterial;
      mat.color.setHex(entityMap.service.color);
      mat.emissive.setHex(entityMap.service.color);
      mat.emissiveIntensity = entityMap.service.emissive;
      updateSpriteColor(port.label, this.labelHexFor('service'));
    }

    // Apply scene background
    if (settings.sceneBg) {
      const bgInt = hexToInt(settings.sceneBg);
      this.setSceneColors(bgInt, bgInt);
    }

    // Grid settings
    this.grid.visible = settings.gridVisible ?? true;
    const gridMats = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    for (const m of gridMats) {
      (m as THREE.Material).opacity = settings.gridOpacity ?? 0.5;
      if (settings.gridColor) {
        (m as THREE.LineBasicMaterial).color.set(settings.gridColor);
      }
    }

    // Bloom settings
    if (settings.bloomStrength !== undefined) this.bloomPass.strength = settings.bloomStrength;
    if (settings.bloomRadius !== undefined) this.bloomPass.radius = settings.bloomRadius;
    if (settings.bloomThreshold !== undefined) this.bloomPass.threshold = settings.bloomThreshold;

    // Fog density
    if (settings.fogDensity !== undefined) {
      (this.scene.fog as THREE.FogExp2).density = settings.fogDensity;
    }

    // Label scale
    if (settings.labelScale !== undefined) {
      this.labelScale = settings.labelScale;
    }

    // Label offset
    if (settings.labelOffset !== undefined) {
      this.labelOffset = settings.labelOffset;
    }

    // Label color
    if (settings.labelColor) {
      const changed = this.labelColor !== settings.labelColor;
      this.labelColor = settings.labelColor;
      if (changed) {
        for (const [, v] of this.vertices) {
          updateSpriteColor(v.label, this.labelHexFor(v.entityType));
        }
        for (const [, port] of this.dockedPorts) {
          updateSpriteColor(port.label, this.labelHexFor('service'));
        }
      }
    }

    // Apply packet scale
    this.particles.scale = this.packetScale;
  }

  updateGraph(graph: GraphUpdate) {
    this.graph = graph;
    this.rebuildVertices();
    this.updateLayoutEdges();
  }

  private rebuildVertices() {
    if (!this.graph) return;
    const newIds = new Set<string>();

    // Nodes
    for (const node of this.graph.nodes) {
      const id = `node:${node.name}`;
      newIds.add(id);
      if (!this.vertices.has(id)) this.createNodeVertex(id, node);
    }

    // Topics
    for (const topic of this.graph.topics) {
      const id = `topic:${topic.name}`;
      newIds.add(id);
      if (!this.vertices.has(id)) this.createTopicVertex(id, topic);
    }

    // Actions
    for (const action of this.graph.actions) {
      const id = `action:${action.name}`;
      newIds.add(id);
      if (!this.vertices.has(id)) this.createActionVertex(id, action);
    }

    // Connected services (has clients) get vertices
    for (const svc of this.graph.services) {
      if (svc.clients.length > 0 && !isGenericService(svc.name)) {
        const id = `service:${svc.name}`;
        newIds.add(id);
        if (!this.vertices.has(id)) this.createServiceVertex(id, svc);
      }
    }

    // Remove old vertices
    for (const [id, v] of this.vertices) {
      if (!newIds.has(id)) {
        this.scene.remove(v.mesh);
        this.scene.remove(v.label);
        if (v.hzBadge) this.scene.remove(v.hzBadge);
        this.vertices.delete(id);
      }
    }

    // Update layout — all vertex types participate
    const layoutIds = [...newIds];
    this.layout.setNodes(layoutIds);

    // Update docked ports (orphan services)
    this.updateDockedPorts();
  }

  private createNodeVertex(id: string, node: RosNode) {
    const geo = new THREE.CylinderGeometry(1.0, 1.0, 2.0, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.node, emissive: COLORS.node, emissiveIntensity: 0.55,
      roughness: 0.25, metalness: 0.8,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.entityId = id;

    const shell = createOutlineShell(mesh, this.edgeColor);
    mesh.add(shell);

    this.scene.add(mesh);
    const label = makeTextSprite(node.name, this.labelHexFor('node'));
    this.scene.add(label);

    this.vertices.set(id, { id, entityType: 'node', mesh, label, outlineShells: [shell], visible: true, opacity: 1, targetOpacity: 1 });
  }

  private createTopicVertex(id: string, topic: RosTopic) {
    const geo = new THREE.SphereGeometry(0.7, 16, 16);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.topic, emissive: COLORS.topic, emissiveIntensity: 0.4,
      roughness: 0.4, metalness: 0.5, transparent: true, opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.entityId = id;

    const shell = createOutlineShell(mesh, this.edgeColor);
    mesh.add(shell);

    this.scene.add(mesh);

    const shortName = topic.name.split('/').pop() || topic.name;
    const label = makeTextSprite(shortName, this.labelHexFor('topic'));
    this.scene.add(label);

    const hzBadge = makeHzBadge(0, 'stable');
    this.scene.add(hzBadge);

    this.vertices.set(id, { id, entityType: 'topic', mesh, label, hzBadge, outlineShells: [shell], visible: true, opacity: 1, targetOpacity: 1 });
  }

  private createServiceVertex(id: string, _svc: RosService) {
    const geo = new THREE.OctahedronGeometry(0.9);
    const mat = new THREE.MeshStandardMaterial({
      color: COLORS.service, emissive: COLORS.service, emissiveIntensity: 0.5,
      roughness: 0.3, metalness: 0.6, transparent: true, opacity: 0.85,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.entityId = id;

    const shell = createOutlineShell(mesh, this.edgeColor);
    mesh.add(shell);

    this.scene.add(mesh);

    const shortName = _svc.name.split('/').pop() || _svc.name;
    const label = makeTextSprite(shortName, this.labelHexFor('service'));
    this.scene.add(label);

    this.vertices.set(id, { id, entityType: 'service', mesh, label, outlineShells: [shell], visible: true, opacity: 1, targetOpacity: 1 });
  }

  private createActionVertex(id: string, action: RosAction) {
    const group = new THREE.Group();
    group.userData.entityId = id;

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 16, 16),
      new THREE.MeshStandardMaterial({ color: COLORS.action, emissive: COLORS.action, emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.6 })
    );
    group.add(core);

    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(0.92, 0.06, 8, 32),
      new THREE.MeshStandardMaterial({ color: COLORS.action, emissive: COLORS.action, emissiveIntensity: 0.3, transparent: true, opacity: 0.7 })
    );
    torus.rotation.x = Math.PI / 2;
    group.add(torus);

    const shells = createOutlineShellsForGroup(group, this.edgeColor);

    this.scene.add(group);

    const shortName = action.name.split('/').pop() || action.name;
    const label = makeTextSprite(shortName, this.labelHexFor('action'));
    this.scene.add(label);

    this.vertices.set(id, { id, entityType: 'action', mesh: group, label, outlineShells: shells, visible: true, opacity: 1, targetOpacity: 1 });
  }

  private updateDockedPorts() {
    if (!this.graph) return;
    const activePortIds = new Set<string>();

    for (const svc of this.graph.services) {
      // Connected services (clients > 0) get full vertices elsewhere. Every
      // other service docks as an orbiting port — including built-in/generic
      // ones, which are hidden per-frame unless un-hidden (see positions pass).
      if (svc.clients.length > 0) continue;
      if (svc.servers.length === 0) continue;

      const svcId = svc.name;
      activePortIds.add(svcId);

      if (!this.dockedPorts.has(svcId)) {
        const geo = new THREE.OctahedronGeometry(0.45);
        const mat = new THREE.MeshStandardMaterial({
          color: COLORS.service, emissive: COLORS.service, emissiveIntensity: 0.4,
          transparent: true, opacity: 0.35, roughness: 0.3, metalness: 0.6,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.portId = svcId;
        this.scene.add(mesh);
        const shortName = svcId.split('/').pop() || svcId;
        const label = makeTextSprite(shortName, this.labelHexFor('service'));
        label.visible = false;
        this.scene.add(label);
        const startAngle = (hashStr(svcId) % 360) * (Math.PI / 180);
        this.dockedPorts.set(svcId, { mesh, hostId: `node:${svc.servers[0]}`, angle: startAngle, label });
      }
    }

    // Remove orphan ports no longer needed
    for (const [id, port] of this.dockedPorts) {
      if (!activePortIds.has(id)) {
        this.scene.remove(port.mesh);
        this.scene.remove(port.label);
        port.mesh.geometry.dispose();
        (port.mesh.material as THREE.Material).dispose();
        this.dockedPorts.delete(id);
      }
    }
  }

  private updateLayoutEdges() {
    if (!this.graph) return;
    const edges: { source: string; target: string }[] = [];

    for (const topic of this.graph.topics) {
      const topicId = `topic:${topic.name}`;
      for (const pub of topic.publishers) edges.push({ source: `node:${pub}`, target: topicId });
      for (const sub of topic.subscribers) edges.push({ source: topicId, target: `node:${sub}` });
    }

    for (const svc of this.graph.services) {
      if (svc.clients.length === 0 || isGenericService(svc.name)) continue;
      const svcId = `service:${svc.name}`;
      for (const server of svc.servers) edges.push({ source: svcId, target: `node:${server}` });
      for (const client of svc.clients) edges.push({ source: `node:${client}`, target: svcId });
    }

    for (const action of this.graph.actions) {
      const actionId = `action:${action.name}`;
      for (const server of action.servers) edges.push({ source: actionId, target: `node:${server}` });
      for (const client of action.clients) edges.push({ source: `node:${client}`, target: actionId });
    }

    this.layout.setEdges(edges);
  }

  updateHz(topicHz: Map<string, TopicHzState>) {
    this.topicHz = topicHz;
  }

  updateLifecycle(nodeName: string, state: LifecycleState) {
    this.lifecycleStates.set(nodeName, state);
  }

  triggerServiceActivity(serviceName: string) {
    this.serviceActivity.set(serviceName, Date.now());
  }

  spawnMessageParticle(topic: string, msg_type: string, payload: Record<string, unknown> | null, size_bytes: number, timestamp: number, dropped_payload: boolean) {
    if (!this.graph) return;
    const topicMeta = this.graph.topics.find(t => t.name === topic);
    if (!topicMeta || topicMeta.publishers.length === 0) return;

    const targetId = `topic:${topic}`;
    if (!this.isVisible(targetId)) return;

    // Throttle per topic (not per edge): one message animates on every
    // publisher edge at once, max once per 300 ms per topic
    if (this.particles.isThrottled(topic)) return;
    this.particles.markSpawn(topic);

    // On arrival at the topic sphere, continue to a subscriber
    const onArrive = () => {
      if (!topicMeta.subscribers.length) return;
      const sub = topicMeta.subscribers[Math.floor(Math.random() * topicMeta.subscribers.length)];
      const subTargetId = `node:${sub}`;
      if (!this.isVisible(subTargetId)) return;
      const subEdgeId = `${targetId}|${subTargetId}`;
      const subIdx = topicMeta.subscribers.indexOf(sub);
      const subCount = topicMeta.subscribers.length;
      const subLateral = subCount === 1 ? 0 : ((subIdx / (subCount - 1)) * 2 - 1) * 0.8;
      this.particles.spawnContinuationParticle(
        subEdgeId, targetId, subTargetId, subLateral,
        topic, msg_type, payload, size_bytes, timestamp, dropped_payload,
        (id) => this.getPosition(id),
        COLORS.edgeTopic
      );
    };

    // One particle per publisher edge (reference behavior), laterals matching updateEdges
    const pubCount = topicMeta.publishers.length;
    topicMeta.publishers.forEach((pub, pubIdx) => {
      const sourceId = `node:${pub}`;
      if (!this.isVisible(sourceId)) return;
      const edgeId = `${sourceId}|${targetId}`;
      const lateral = pubCount === 1 ? 0 : ((pubIdx / (pubCount - 1)) * 2 - 1) * 0.8;
      this.particles.spawnMessageParticle(
        edgeId, sourceId, targetId, lateral,
        topic, msg_type, payload, size_bytes, timestamp, dropped_payload,
        (id) => this.getPosition(id),
        pubIdx === 0 ? onArrive : undefined, // continue to subscriber once, not per publisher
        COLORS.edgeTopic
      );
    });
  }

  spawnServicePulse(serviceName: string) {
    if (!this.graph) return;
    const svc = this.graph.services.find(s => s.name === serviceName);
    if (!svc || svc.clients.length === 0 || svc.servers.length === 0) return;

    const sourceId = `node:${svc.clients[0]}`;
    const svcId = `service:${serviceName}`;
    const edgeId = `svc:${serviceName}:client:${svc.clients[0]}`;

    const onArrive = () => {
      this.serviceActivity.set(serviceName, Date.now());
      for (const server of svc.servers) {
        const targetId = `node:${server}`;
        const contEdgeId = `svc:${serviceName}:server:${server}`;
        this.particles.spawnServiceContinuation(contEdgeId, svcId, targetId, 0, (id) => this.getPosition(id), COLORS.edgeService);
      }
    };

    this.particles.spawnServiceParticle(edgeId, sourceId, svcId, 0, (id) => this.getPosition(id), onArrive, COLORS.edgeService);
  }

  setVisibility(hiddenItems: Set<string>, hiddenTypes: Set<string>, genericHidden: boolean, deadEndMode: DeadEndMode, isolatedSet: Set<string> | null) {
    this.hiddenItems = hiddenItems;
    this.hiddenTypes = hiddenTypes;
    this.genericHidden = genericHidden;
    this.deadEndMode = deadEndMode;
    this.isolatedSet = isolatedSet;
  }

  private isVisible(id: string): boolean {
    const v = this.vertices.get(id);
    return v ? v.visible : false;
  }

  private computeVisibility() {
    if (!this.graph) return;
    const deadEnds = this.computeDeadEnds();

    for (const [id, v] of this.vertices) {
      let show = true;

      // Type hidden
      if (this.hiddenTypes.has(v.entityType)) show = false;
      // Item explicitly hidden
      if (this.hiddenItems.has(id)) show = false;
      // Generic hidden
      if (this.genericHidden) {
        if (v.entityType === 'node' && isGenericNode(id.replace('node:', ''))) show = false;
        if (v.entityType === 'topic' && isGenericTopic(id.replace('topic:', ''))) show = false;
        if (v.entityType === 'service' && isGenericService(id.replace('service:', ''))) show = false;
      }
      // Isolation
      if (this.isolatedSet && !this.isolatedSet.has(id)) show = false;
      // User override: if explicitly shown, never auto-prune
      const explicitlyShown = !this.hiddenItems.has(id);

      // Dead-end handling
      if (show && deadEnds.has(id) && explicitlyShown && this.deadEndMode !== 'shown') {
        if (this.deadEndMode === 'hidden') { v.targetOpacity = 0; }
        else { v.targetOpacity = 0.18; } // dimmed
        v.visible = this.deadEndMode !== 'hidden';
      } else {
        v.targetOpacity = show ? 1 : 0;
        v.visible = show;
      }
    }
  }

  private computeDeadEnds(): Set<string> {
    const dead = new Set<string>();
    if (!this.graph) return dead;

    for (const topic of this.graph.topics) {
      const tid = `topic:${topic.name}`;
      let endpoints = 0;
      for (const pub of topic.publishers) if (this.isNodeVisible(`node:${pub}`)) endpoints++;
      for (const sub of topic.subscribers) if (this.isNodeVisible(`node:${sub}`)) endpoints++;
      if (endpoints < 2) dead.add(tid);
    }
    return dead;
  }

  private isNodeVisible(id: string): boolean {
    if (this.hiddenItems.has(id)) return false;
    if (this.hiddenTypes.has('node')) return false;
    const name = id.replace('node:', '');
    if (this.genericHidden && isGenericNode(name)) return false;
    if (this.isolatedSet && !this.isolatedSet.has(id)) return false;
    return true;
  }

  getDeadEndCount(): number {
    return this.computeDeadEnds().size;
  }

  private getPosition(id: string): THREE.Vector3 | null {
    const pos = this.layout.getPosition(id);
    if (pos) return new THREE.Vector3(pos[0], pos[1], pos[2]);
    // Connected services are not in layout — get from mesh position
    const v = this.vertices.get(id);
    if (v) return v.mesh.position.clone();
    return null;
  }

  resetCamera() {
    this.camera.position.set(0, 20, 55);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  zoomToExtents() {
    const points: THREE.Vector3[] = [];
    for (const [, v] of this.vertices) {
      if (!v.visible) continue;
      points.push(v.mesh.position.clone());
    }
    for (const [, port] of this.dockedPorts) {
      points.push(port.mesh.position.clone());
    }
    if (points.length === 0) {
      this.resetCamera();
      return;
    }

    const box = new THREE.Box3();
    for (const point of points) box.expandByPoint(point);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.x, size.y, size.z, 12);
    const distance = radius * 1.55;
    const offset = new THREE.Vector3(0.9, 0.55, 1).normalize().multiplyScalar(distance);
    this.camera.position.copy(center.clone().add(offset));
    this.controls.target.copy(center);
    this.controls.update();
  }

  focusEntity(id: string) {
    const pos = this.getPosition(id);
    if (!pos) return;
    const target = pos.clone();
    const camOffset = new THREE.Vector3(0, 8, 20);
    const startTarget = this.controls.target.clone();
    const startCam = this.camera.position.clone();
    let frame = 0;

    const animate = () => {
      frame++;
      const t = Math.min(frame / 25, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      this.controls.target.lerpVectors(startTarget, target, ease);
      this.camera.position.lerpVectors(startCam, target.clone().add(camOffset), ease);
      this.controls.update();
      if (t < 1) requestAnimationFrame(animate);
    };
    animate();
  }

  releaseParticles() {
    this.particles.unfreezeAll();
  }

  start() {
    const animate = () => {
      this.frameId = requestAnimationFrame(animate);
      this.time += 0.016;
      this.tick();
    };
    animate();
  }

  private tick() {
    this.layout.step();
    this.computeVisibility();
    this.updateOutlineObjects();
    this.updateVertexPositions();
    this.updateDockedPortPositions();
    this.updateEdges();
    this.updateLifecycleVisuals();
    this.updateServiceActivityVisuals();
    this.particles.update((id) => this.getPosition(id));
    this.updateLabelFade();
    this.controls.update();
    this.composer.render();
  }

  private updateOutlineObjects() {
    for (const [, v] of this.vertices) {
      const shouldOutline =
        (v.entityType === 'node' && this.nodeEdgesEnabled) ||
        (v.entityType === 'topic' && this.topicEdgesEnabled) ||
        (v.entityType === 'service' && this.serviceEdgesEnabled) ||
        (v.entityType === 'action' && this.actionEdgesEnabled);
      for (const shell of v.outlineShells) {
        shell.visible = shouldOutline && v.visible;
      }
    }
  }

  private updateVertexPositions() {
    for (const [id, v] of this.vertices) {
      const pos = this.layout.getPosition(id);
      if (!pos) continue;

      // Breathing scale for nodes
      if (v.entityType === 'node') {
        const base = this.entityScales.node;
        const s = base * (1 + Math.sin(this.time * 1.5 + hashStr(id)) * 0.03);
        v.mesh.scale.set(s, s, s);
        v.mesh.rotation.y += 0.003;
      }
      if (v.entityType === 'action') {
        // Torus spin
        const torus = (v.mesh as THREE.Group).children[1];
        if (torus) torus.rotation.z += 0.01;
      }
      if (v.entityType === 'service') {
        v.mesh.rotation.y += 0.01;
      }

      v.mesh.position.set(pos[0], pos[1], pos[2]);
      v.label.position.set(pos[0], pos[1] + this.labelOffset, pos[2]);
      if (v.hzBadge) v.hzBadge.position.set(pos[0], pos[1] - 1.5, pos[2]);

      // Apply label scale
      if (!v.label.userData._baseScale) {
        v.label.userData._baseScale = { x: v.label.scale.x, y: v.label.scale.y };
      }
      const bs = v.label.userData._baseScale;
      v.label.scale.set(bs.x * this.labelScale, bs.y * this.labelScale, 1);

      // Opacity lerp
      v.opacity += (v.targetOpacity - v.opacity) * 0.08;
      v.mesh.visible = v.opacity > 0.01;
      v.label.visible = v.opacity > 0.3;
      if (v.hzBadge) v.hzBadge.visible = v.opacity > 0.3;

      if (v.mesh instanceof THREE.Mesh) {
        (v.mesh.material as THREE.MeshStandardMaterial).opacity = v.opacity * 0.85;
      }
    }
  }

  private updateDockedPortPositions() {
    for (const [svcId, port] of this.dockedPorts) {
      const hostPos = this.getPosition(port.hostId);
      if (!hostPos) continue;
      port.angle += 0.004;
      const r = 2.4;
      const bob = Math.sin(this.time * 2.5 + port.angle * 3) * 0.15;
      port.mesh.position.set(
        hostPos.x + Math.cos(port.angle) * r,
        hostPos.y + bob,
        hostPos.z + Math.sin(port.angle) * r,
      );
      port.mesh.rotation.y += 0.015;
      port.mesh.rotation.x += 0.008;

      // Position label above port
      port.label.position.set(port.mesh.position.x, port.mesh.position.y + 1.0, port.mesh.position.z);

      // Show label when host node or this service is selected
      const isSelected = this.selectedEntityId === `service:${svcId}`;
      const showLabel = this.selectedEntityId === port.hostId || isSelected;
      port.label.visible = showLabel;

      // Scale label up when this port is directly selected
      const labelBaseScale = port.label.userData._baseScale;
      if (labelBaseScale) {
        const s = isSelected ? 1.4 : 1.0;
        port.label.scale.set(labelBaseScale.x * s, labelBaseScale.y * s, 1);
      } else {
        port.label.userData._baseScale = { x: port.label.scale.x, y: port.label.scale.y };
      }

      // Highlight port when selected
      const mat = port.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = isSelected ? 0.9 : 0.35;
      mat.emissiveIntensity = isSelected ? 1.2 : 0.4;

      // Visibility: inherit the host node, then apply the same hide rules the
      // sidebar uses — type-hidden, item-hidden, or generic-hidden (built-in).
      // isGenericService() honours per-item "Unmark Generic" overrides too.
      const hostV = this.vertices.get(port.hostId);
      let portVisible = hostV ? hostV.visible : true;
      if (this.hiddenTypes.has('service')) portVisible = false;
      if (this.hiddenItems.has(`service:${svcId}`)) portVisible = false;
      if (this.genericHidden && isGenericService(svcId)) portVisible = false;
      port.mesh.visible = portVisible;
      if (!portVisible) port.label.visible = false;
    }
  }

  private updateEdges() {
    if (!this.graph) return;
    const arcEdges: ArcEdge[] = [];

    // Topic edges
    for (const topic of this.graph.topics) {
      const topicId = `topic:${topic.name}`;
      const hz = this.topicHz.get(topic.name);
      const health = hz?.health ?? 'stable';
      const hzVal = hz?.hz ?? 0;

      const color = new THREE.Color(
        health === 'stable' ? COLORS.edgeTopic : health === 'jitter' ? COLORS.edgeTopicJitter : COLORS.edgeTopicStale
      );
      const width = Math.min(2.2 + hzVal * 0.35, 7.0);
      const opacity = Math.min(0.65 + hzVal / 10 * 0.25, 0.92);

      // Spread publishers symmetrically
      const pubCount = topic.publishers.length;
      for (let i = 0; i < pubCount; i++) {
        const pub = topic.publishers[i];
        const edgeId = `node:${pub}|${topicId}`;
        const lat = pubCount === 1 ? 0 : ((i / (pubCount - 1)) * 2 - 1) * 0.8;
        arcEdges.push({ id: edgeId, sourceId: `node:${pub}`, targetId: topicId, color, width, opacity, lateral: lat });
      }
      // Spread subscribers symmetrically
      const subCount = topic.subscribers.length;
      for (let i = 0; i < subCount; i++) {
        const sub = topic.subscribers[i];
        const edgeId = `${topicId}|node:${sub}`;
        const lat = subCount === 1 ? 0 : ((i / (subCount - 1)) * 2 - 1) * 0.8;
        arcEdges.push({ id: edgeId, sourceId: topicId, targetId: `node:${sub}`, color, width, opacity, lateral: lat });
      }
    }

    // Service edges (connected only — go through service vertex like topics)
    for (const svc of this.graph.services) {
      if (svc.clients.length === 0 || isGenericService(svc.name)) continue;
      const svcId = `service:${svc.name}`;

      // client -> service vertex
      const clientCount = svc.clients.length;
      for (let i = 0; i < clientCount; i++) {
        const client = svc.clients[i];
        const edgeId = `svc:${svc.name}:client:${client}`;
        const lat = clientCount === 1 ? 0 : ((i / (clientCount - 1)) * 2 - 1) * 0.7;
        arcEdges.push({
          id: edgeId, sourceId: `node:${client}`, targetId: svcId,
          color: new THREE.Color(COLORS.edgeService), width: 3.5, opacity: 0.7, lateral: lat,
        });
      }

      // service vertex -> server
      const serverCount = svc.servers.length;
      for (let i = 0; i < serverCount; i++) {
        const server = svc.servers[i];
        const edgeId = `svc:${svc.name}:server:${server}`;
        const lat = serverCount === 1 ? 0 : ((i / (serverCount - 1)) * 2 - 1) * 0.7;
        arcEdges.push({
          id: edgeId, sourceId: svcId, targetId: `node:${server}`,
          color: new THREE.Color(COLORS.edgeService), width: 3.5, opacity: 0.7, lateral: lat,
        });
      }
    }

    // Action edges
    for (const action of this.graph.actions) {
      const actionId = `action:${action.name}`;
      const serverCount = action.servers.length;
      for (let i = 0; i < serverCount; i++) {
        const server = action.servers[i];
        const edgeId = `act:${action.name}:s:${server}`;
        const lat = serverCount === 1 ? 0 : ((i / (serverCount - 1)) * 2 - 1) * 0.8;
        arcEdges.push({
          id: edgeId, sourceId: actionId, targetId: `node:${server}`,
          color: new THREE.Color(COLORS.edgeAction), width: 4, opacity: 0.65, lateral: lat,
        });
      }
      const clientCount = action.clients.length;
      for (let i = 0; i < clientCount; i++) {
        const client = action.clients[i];
        const edgeId = `act:${action.name}:c:${client}`;
        const lat = clientCount === 1 ? 0 : ((i / (clientCount - 1)) * 2 - 1) * 0.8;
        arcEdges.push({
          id: edgeId, sourceId: `node:${client}`, targetId: actionId,
          color: new THREE.Color(COLORS.edgeAction), width: 4, opacity: 0.65, lateral: lat,
        });
      }
    }

    // Filter by visibility
    const visibleEdges = arcEdges.filter(e => {
      const sv = this.vertices.get(e.sourceId);
      const tv = this.vertices.get(e.targetId);
      return (sv?.visible ?? true) && (tv?.visible ?? true);
    });

    // Apply line thickness multiplier
    if (this.lineThicknessMultiplier !== 1.0) {
      for (const e of visibleEdges) e.width *= this.lineThicknessMultiplier;
    }

    this.edgeRenderer.updateEdges(visibleEdges, (id) => this.getPosition(id));
  }

  private updateLifecycleVisuals() {
    for (const [name, state] of this.lifecycleStates) {
      const v = this.vertices.get(`node:${name}`);
      if (!v || !(v.mesh instanceof THREE.Mesh)) continue;
      const mat = v.mesh.material as THREE.MeshStandardMaterial;
      const cfg = LIFECYCLE_EMISSIVE[state] ?? LIFECYCLE_EMISSIVE.active;
      mat.emissive.setHex(cfg.color);
      let intensity = cfg.intensity;
      if (cfg.pulse) intensity += Math.sin(this.time * 3) * 0.14;
      if (cfg.strobe) intensity = Math.sin(this.time * 30) > 0 ? 0.85 : 0.1;
      mat.emissiveIntensity = intensity;
    }

    // Phantom nodes
    if (this.graph) {
      for (const node of this.graph.nodes) {
        if (node.pid === null && !this.lifecycleStates.has(node.name)) {
          const v = this.vertices.get(`node:${node.name}`);
          if (!v || !(v.mesh instanceof THREE.Mesh)) continue;
          const mat = v.mesh.material as THREE.MeshStandardMaterial;
          mat.emissive.setHex(0xffffff);
          mat.emissiveIntensity = 0.15 + Math.sin(this.time * 1.5) * 0.1;
        }
      }
    }
  }

  private updateServiceActivityVisuals() {
    const now = Date.now();
    for (const [svcName, lastTime] of this.serviceActivity) {
      const elapsed = now - lastTime;

      // Docked port flash
      const port = this.dockedPorts.get(svcName);
      if (port) {
        const mat = port.mesh.material as THREE.MeshStandardMaterial;
        if (elapsed < 450) {
          const t = elapsed / 450;
          mat.opacity = 1.0 - t * 0.5;
          const s = 2.4 - t * 1.4;
          port.mesh.scale.set(s, s, s);
        } else if (elapsed < 8000) {
          mat.opacity = 0.55;
          port.mesh.scale.set(1, 1, 1);
        } else {
          mat.opacity = 0.22;
          port.mesh.scale.set(1, 1, 1);
        }
      }

      // Connected service vertex flash
      const v = this.vertices.get(`service:${svcName}`);
      if (v && v.mesh instanceof THREE.Mesh) {
        const base = this.entityScales.service;
        const mat = v.mesh.material as THREE.MeshStandardMaterial;
        if (elapsed < 450) {
          const t = elapsed / 450;
          mat.opacity = 1.0 - t * 0.15;
          const s = base * (2.4 - t * 1.4);
          v.mesh.scale.set(s, s, s);
        } else if (elapsed < 8000) {
          mat.opacity = 0.85;
          v.mesh.scale.set(base, base, base);
        } else {
          mat.opacity = 0.6;
          v.mesh.scale.set(base, base, base);
        }
      }
    }
  }

  private updateLabelFade() {
    for (const v of this.vertices.values()) {
      updateLabelOpacity(v.label, this.camera);
      if (v.hzBadge) {
        updateLabelOpacity(v.hzBadge, this.camera);
        // Update Hz badge content
        const topicName = v.id.replace('topic:', '');
        const hz = this.topicHz.get(topicName);
        if (hz && v.hzBadge) {
          const text = hz.health === 'stale' ? '--' : `${hz.hz.toFixed(1)} Hz`;
          // Recreate badge if content changed
          const mat = v.hzBadge.material as THREE.SpriteMaterial;
          if (mat.userData?.text !== text) {
            const pos = v.hzBadge.position.clone();
            this.scene.remove(v.hzBadge);
            const newBadge = makeHzBadge(hz.hz, hz.health);
            newBadge.position.copy(pos);
            newBadge.material.userData = { text };
            this.scene.add(newBadge);
            v.hzBadge = newBadge;
          }
        }
      }
    }
  }

  clearScene() {
    for (const [id, v] of this.vertices) {
      this.scene.remove(v.mesh);
      this.scene.remove(v.label);
      if (v.hzBadge) this.scene.remove(v.hzBadge);
      this.vertices.delete(id);
    }
    for (const [id, port] of this.dockedPorts) {
      this.scene.remove(port.mesh);
      this.scene.remove(port.label);
      this.dockedPorts.delete(id);
    }
    this.edgeRenderer.dispose();
    this.particles.clear();
    this.layout.nodes.clear();
    this.layout.edges = [];
  }

  dispose() {
    cancelAnimationFrame(this.frameId);
    this.renderer.domElement.removeEventListener('click', this.handleClick);
    this.renderer.domElement.removeEventListener('contextmenu', this.handleRightClick);
    (this as unknown as { _ro?: ResizeObserver })._ro?.disconnect();
    this.edgeRenderer.dispose();
    this.particles.dispose();

    // Free GPU-resident geometries, materials and textures. renderer.dispose()
    // does NOT release these — without this, every navigation away from the
    // ROS view leaks node/edge geometries and (crucially) the canvas-backed
    // label / Hz-badge sprite textures.
    this.disposeSceneObjects();
    this.controls.dispose();
    this.composer.dispose();

    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  private disposeSceneObjects() {
    // Dedupe: outline shells reuse their source mesh's geometry, so the same
    // geometry/material can appear many times in one traversal.
    const seen = new Set<THREE.BufferGeometry | THREE.Material>();
    this.scene.traverse((obj) => {
      const geometry = (obj as Partial<THREE.Mesh>).geometry as THREE.BufferGeometry | undefined;
      if (geometry && !seen.has(geometry)) {
        seen.add(geometry);
        geometry.dispose();
      }
      const material = (obj as Partial<THREE.Mesh>).material;
      if (!material) return;
      const materials = Array.isArray(material) ? material : [material];
      for (const mat of materials) {
        if (seen.has(mat)) continue;
        seen.add(mat);
        for (const value of Object.values(mat as unknown as Record<string, unknown>)) {
          if (value && (value as THREE.Texture).isTexture) (value as THREE.Texture).dispose();
        }
        mat.dispose();
      }
    });
    // outlineMaterialCache is module-level and shared across SceneManager
    // instances. Its materials were just disposed above, so clear the map —
    // otherwise the next instance reuses disposed GPU resources and crashes.
    outlineMaterialCache.clear();
  }
}
