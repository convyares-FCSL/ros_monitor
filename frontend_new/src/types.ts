// === WebSocket protocol types (match backend contract) ===

export type ConnectionStatus = 'connected' | 'simulating' | 'disconnected';

export interface WsFrame {
  type: string;
  timestamp: number;
  data: unknown;
}

// graph_update
export interface RosNode {
  name: string;
  namespace: string;
  pid?: number | null; // number = alive, null = phantom, undefined = no scan (sim)
}

export interface RosTopic {
  name: string;
  types: string[];
  publishers: string[];
  subscribers: string[];
}

export interface RosService {
  name: string;
  types: string[];
  servers: string[];
  clients: string[];
}

export interface RosAction {
  name: string;
  type: string;
  servers: string[];
  clients: string[];
}

export interface GraphUpdate {
  nodes: RosNode[];
  topics: RosTopic[];
  services: RosService[];
  actions: RosAction[];
}

// message_event
export interface MessageEvent {
  id: string;
  topic: string;
  msg_type: string;
  payload: Record<string, unknown> | null;
  dropped_payload: boolean;
  size_bytes: number;
  timestamp: number;
}

// frequency_update
export interface FrequencyUpdate {
  updates: Record<string, number>;
}

// lifecycle_event
export type LifecycleState = 'unconfigured' | 'inactive' | 'active' | 'shuttingdown' | 'shutting_down' | 'error_processing' | 'error' | 'finalized';

export interface LifecycleEvent {
  node_name: string;
  start_state: string;
  goal_state: LifecycleState;
  transition_id: number;
}

// node_params_event
export interface NodeParamsEvent {
  node_name: string;
  params: Record<string, unknown>;
}

// service_invoked
export interface ServiceInvokedEvent {
  id: string;
  service_name: string;
  event_type: 0 | 1; // 0 = REQUEST_SENT, 1 = REQUEST_RECEIVED
  payload: Record<string, unknown> | null;
  timestamp: number;
}

// === App state types ===

export type TopicHealth = 'stable' | 'jitter' | 'stale';

export interface TopicHzState {
  hz: number;
  health: TopicHealth;
  lastUpdate: number;
  prevHz: number;
  history: Array<{ hz: number; t: number }>;
}

export type DeadEndMode = 'hidden' | 'dimmed' | 'shown';

export interface SelectedEntity {
  entityType: 'node' | 'topic' | 'service' | 'action';
  id: string;
}

export interface SelectedParticle {
  topic: string;
  msg_type: string;
  payload: Record<string, unknown> | null;
  dropped_payload: boolean;
  size_bytes: number;
  timestamp: number;
  fromNode: string;
  toNode: string;
}

// Visibility state
export interface VisibilityState {
  hiddenItems: Set<string>;
  hiddenTypes: Set<string>;
  genericHidden: boolean;
  isolatedRoot: string | null;
  isolatedSet: Set<string> | null;
}

// Node lifecycle state tracking
export interface NodeLifecycleState {
  state: LifecycleState;
  timestamp: number;
}

// Scene settings for the 3D visualizer
export interface EntitySettings {
  color: string;
  size: number;
  emissive: number;
}

export interface SceneSettings {
  nodes: EntitySettings;
  topics: EntitySettings;
  services: EntitySettings;
  actions: EntitySettings;
  lineThickness: number;
  packetScale: number;
  nodeEdges: boolean;
  topicEdges: boolean;
  serviceEdges: boolean;
  actionEdges: boolean;
  edgeColor: string;
  menuBg: string;
  sceneBg: string;
  gridVisible: boolean;
  gridOpacity: number;
  gridColor: string;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
  fogDensity: number;
  labelScale: number;
  labelOffset: number;
  labelColor: 'white' | 'black' | 'entity';
  edgeThickness: number;
}

export const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  nodes: { color: '#06b6d4', size: 1.0, emissive: 0.45 },
  topics: { color: '#f97316', size: 1.0, emissive: 0.4 },
  services: { color: '#10b981', size: 1.0, emissive: 0.5 },
  actions: { color: '#a855f7', size: 1.0, emissive: 0.4 },
  lineThickness: 1.0,
  packetScale: 1.5,
  nodeEdges: true,
  topicEdges: false,
  serviceEdges: false,
  actionEdges: false,
  edgeColor: '#525252',
  menuBg: '#0f172a',
  sceneBg: '#2e2f33',
  gridVisible: true,
  gridOpacity: 0.5,
  gridColor: '#1e293b',
  bloomStrength: 0.9,
  bloomRadius: 0.55,
  bloomThreshold: 0.65,
  fogDensity: 0.012,
  labelScale: 1.0,
  labelOffset: 2.2,
  labelColor: 'entity',
  edgeThickness: 1.12,
};
