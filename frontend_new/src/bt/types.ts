// Behavior Tree data contract — mirrors the bridge's bt_blueprint / bt_delta /
// bt_blackboard events (see backend/ros_monitor_bridge/bt_simulation.py).

export type NodeStatus = 'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILURE';
export type NodeCategory = 'control' | 'action' | 'condition' | 'decorator' | 'subtree';

export interface BTDecorator {
  id: number;
  name: string;
  type: string;
  ports?: Record<string, unknown>;
}

export interface BTService {
  id: number;
  name: string;
  tick_ms: number;
}

export interface BTPorts {
  input?: Record<string, string>;
  output?: Record<string, string>;
}

export interface BTNodeDef {
  id: number;
  name: string;
  type: string;
  category: NodeCategory;
  children: number[];
  decorators: BTDecorator[];
  services: BTService[];
  ports: BTPorts;
}

export interface BTBlueprint {
  tree_id: string;
  version: number;
  root_id: number;
  nodes: BTNodeDef[];
}

export interface BTDelta {
  id: number;
  state: NodeStatus;
  tick_dt_ms?: number;
}

export interface BTBlackboard {
  scope: string;
  vars: Record<string, unknown>;
}
