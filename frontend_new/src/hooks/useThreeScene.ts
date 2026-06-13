import { useEffect, useRef, useCallback } from 'react';
import { SceneManager, setGenericOverrides } from '../three/SceneManager';
import type { GraphUpdate, TopicHzState, SelectedEntity, SelectedParticle, DeadEndMode, LifecycleState, SceneSettings } from '../types';

interface UseThreeSceneOptions {
  containerRef: React.RefObject<HTMLDivElement | null>;
  graph: GraphUpdate | null;
  topicHz: Map<string, TopicHzState>;
  hiddenItems: Set<string>;
  hiddenTypes: Set<string>;
  genericHidden: boolean;
  genericOverrides: Map<string, boolean>;
  deadEndMode: DeadEndMode;
  isolatedSet: Set<string> | null;
  sceneBg?: number;
  sceneFog?: number;
  entityColors?: { node: number; topic: number; service: number; action: number };
  emissiveIntensity?: number;
  onSelectEntity: (entity: SelectedEntity | null) => void;
  onParticleClick: (particle: SelectedParticle) => void;
  onRightClick?: (entity: SelectedEntity | null, x: number, y: number) => void;
}

export function useThreeScene(opts: UseThreeSceneOptions) {
  const managerRef = useRef<SceneManager | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    const container = opts.containerRef.current;
    if (!container || managerRef.current) return;

    const manager = new SceneManager(container);
    managerRef.current = manager;

    manager.setCallbacks(
      (entity) => optsRef.current.onSelectEntity(entity),
      (data) => optsRef.current.onParticleClick(data as SelectedParticle),
      (entity, x, y) => optsRef.current.onRightClick?.(entity, x, y),
    );

    manager.start();

    return () => { manager.dispose(); managerRef.current = null; };
  }, [opts.containerRef]);

  // Update graph
  useEffect(() => {
    if (opts.graph && managerRef.current) {
      managerRef.current.updateGraph(opts.graph);
    }
  }, [opts.graph]);

  // Update Hz
  useEffect(() => {
    managerRef.current?.updateHz(opts.topicHz);
  }, [opts.topicHz]);

  // Update visibility
  useEffect(() => {
    managerRef.current?.setVisibility(
      opts.hiddenItems, opts.hiddenTypes, opts.genericHidden, opts.deadEndMode, opts.isolatedSet
    );
  }, [opts.hiddenItems, opts.hiddenTypes, opts.genericHidden, opts.deadEndMode, opts.isolatedSet]);

  // Generic overrides changed: push to the module store, rebuild graph-derived
  // structures (docked ports / service edges consult isGenericService), refresh
  useEffect(() => {
    setGenericOverrides(opts.genericOverrides);
    const m = managerRef.current;
    if (!m) return;
    if (optsRef.current.graph) m.updateGraph(optsRef.current.graph);
    m.setVisibility(
      optsRef.current.hiddenItems, optsRef.current.hiddenTypes,
      optsRef.current.genericHidden, optsRef.current.deadEndMode, optsRef.current.isolatedSet
    );
  }, [opts.genericOverrides]);

  // Update scene colors on theme change
  useEffect(() => {
    if (opts.sceneBg !== undefined) managerRef.current?.setSceneColors(opts.sceneBg, opts.sceneFog ?? opts.sceneBg);
  }, [opts.sceneBg, opts.sceneFog]);

  // Update entity colors on theme change
  useEffect(() => {
    if (opts.entityColors) managerRef.current?.setEntityColors(opts.entityColors);
  }, [opts.entityColors]);

  // Update emissive intensity
  useEffect(() => {
    if (opts.emissiveIntensity !== undefined) managerRef.current?.setEmissiveIntensity(opts.emissiveIntensity);
  }, [opts.emissiveIntensity]);

  const resetCamera = useCallback(() => managerRef.current?.resetCamera(), []);
  const zoomExtents = useCallback(() => managerRef.current?.zoomToExtents(), []);
  const focusEntity = useCallback((id: string) => {
    managerRef.current?.setSelectedEntity(id);
    managerRef.current?.focusEntity(id);
  }, []);
  const releaseParticles = useCallback(() => managerRef.current?.releaseParticles(), []);

  const setSelectedEntity = useCallback((id: string | null) => {
    managerRef.current?.setSelectedEntity(id);
  }, []);

  const spawnMessageParticle = useCallback((topic: string, msg_type: string, payload: Record<string, unknown> | null, size_bytes: number, timestamp: number, dropped: boolean) => {
    managerRef.current?.spawnMessageParticle(topic, msg_type, payload, size_bytes, timestamp, dropped);
  }, []);

  const spawnServicePulse = useCallback((serviceName: string) => {
    managerRef.current?.spawnServicePulse(serviceName);
  }, []);

  const triggerServiceActivity = useCallback((serviceName: string) => {
    managerRef.current?.triggerServiceActivity(serviceName);
  }, []);

  const updateLifecycle = useCallback((nodeName: string, state: LifecycleState) => {
    managerRef.current?.updateLifecycle(nodeName, state);
  }, []);

  const clearScene = useCallback(() => managerRef.current?.clearScene(), []);

  const getDeadEndCount = useCallback(() => managerRef.current?.getDeadEndCount() ?? 0, []);

  const applySceneSettings = useCallback((settings: SceneSettings) => {
    managerRef.current?.applySceneSettings(settings);
  }, []);

  return {
    resetCamera, zoomExtents, focusEntity, releaseParticles, setSelectedEntity,
    spawnMessageParticle, spawnServicePulse, triggerServiceActivity,
    updateLifecycle, clearScene, getDeadEndCount, applySceneSettings,
  };
}
