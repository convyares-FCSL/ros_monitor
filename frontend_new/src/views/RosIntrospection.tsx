import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Header } from '../components/Header';
import { Sidebar } from '../components/Sidebar';
import { InspectorDrawer } from '../components/InspectorDrawer';
import { ControlsOverlay } from '../components/ControlsOverlay';
import { SettingsModal } from '../components/SettingsModal';
import { useRosGraph } from '../hooks/useRosGraph';
import { useThreeScene } from '../hooks/useThreeScene';
import { useTheme } from '../hooks/useTheme';
import type {
  GraphUpdate, MessageEvent, FrequencyUpdate, LifecycleEvent,
  NodeParamsEvent, ServiceInvokedEvent, ConnectionStatus,
  SelectedEntity, SelectedParticle, TopicHzState, NodeLifecycleState, DeadEndMode,
  SceneSettings,
} from '../types';
import { DEFAULT_SCENE_SETTINGS } from '../types';
import { isGenericNode, isGenericTopic, isGenericService, setGenericOverrides } from '../three/SceneManager';

// Derive the bridge host from wherever the page is served (works on Pi/remote)
const WS_URL = `ws://${window.location.hostname || 'localhost'}:8765`;
const MAX_MESSAGES = 200;
const MAX_SERVICE_CALLS = 100;
const STALE_THRESHOLD_MS = 2000;

// Generic status for a vertex id like "node:x" / "topic:/y" / "service:/z"
function isGenericById(id: string): boolean {
  const sep = id.indexOf(':');
  const kind = id.slice(0, sep);
  const name = id.slice(sep + 1);
  if (kind === 'node') return isGenericNode(name);
  if (kind === 'topic') return isGenericTopic(name);
  if (kind === 'service') return isGenericService(name);
  return false;
}

export function RosIntrospection() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const themeCtx = useTheme();
  const { theme } = themeCtx;

  // Connection
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  // Connect to the real bridge by default; sim is an explicit opt-in toggle
  const [simMode, setSimMode] = useState(false);
  const [paused, setPaused] = useState(false);

  // Graph data
  const [graph, setGraph] = useState<GraphUpdate | null>(null);
  const [messages, setMessages] = useState<MessageEvent[]>([]);
  const [serviceInvocations, setServiceInvocations] = useState<ServiceInvokedEvent[]>([]);
  const [topicHz, setTopicHz] = useState<Map<string, TopicHzState>>(new Map());
  const [nodeLifecycles, setNodeLifecycles] = useState<Map<string, NodeLifecycleState>>(new Map());
  const [nodeParams, setNodeParams] = useState<Map<string, Record<string, unknown>>>(new Map());

  // UI state
  const [selectedEntity, setSelectedEntity] = useState<SelectedEntity | null>(null);
  const [selectedParticle, setSelectedParticle] = useState<SelectedParticle | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(new Set());
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [genericHidden, setGenericHidden] = useState(true);
  // Per-item generic overrides, persisted across sessions like scene settings
  const [genericOverrides, setGenericOverridesState] = useState<Map<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('ros3d-generic-overrides');
      if (saved) {
        const restored = new Map<string, boolean>(Object.entries(JSON.parse(saved)));
        setGenericOverrides(restored); // sync the module store before first render
        return restored;
      }
    } catch { /* corrupted storage — fall back to defaults */ }
    return new Map();
  });
  const [deadEndMode, setDeadEndMode] = useState<DeadEndMode>('hidden');
  const [isolatedSet, setIsolatedSet] = useState<Set<string> | null>(null);
  const [bandwidth, setBandwidth] = useState(0);
  const [sceneContextMenu, setSceneContextMenu] = useState<{ entity: SelectedEntity | null; x: number; y: number } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sceneSettings, setSceneSettings] = useState<SceneSettings>(() => {
    try {
      const saved = localStorage.getItem('ros3d-scene-settings');
      if (saved) return { ...DEFAULT_SCENE_SETTINGS, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return DEFAULT_SCENE_SETTINGS;
  });

  // Bandwidth tracker
  const bwRef = useRef({ bytes: 0, lastReset: Date.now() });
  const handleBandwidth = useCallback((bytes: number) => {
    bwRef.current.bytes += bytes;
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = (now - bwRef.current.lastReset) / 1000;
      if (elapsed > 0) setBandwidth(bwRef.current.bytes / elapsed);
      bwRef.current = { bytes: 0, lastReset: now };
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Staleness check
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTopicHz(prev => {
        const next = new Map(prev);
        let changed = false;
        for (const [topic, state] of next) {
          if (now - state.lastUpdate > STALE_THRESHOLD_MS && state.health !== 'stale') {
            next.set(topic, { ...state, health: 'stale', hz: 0 });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Callbacks for useRosGraph
  const handleGraphUpdate = useCallback((data: GraphUpdate) => setGraph(data), []);

  const handleMessage = useCallback((ev: MessageEvent) => {
    setMessages(prev => [ev, ...prev].slice(0, MAX_MESSAGES));
  }, []);

  const handleFrequency = useCallback((data: FrequencyUpdate) => {
    setTopicHz(prev => {
      const next = new Map(prev);
      const now = Date.now();
      for (const [topic, hz] of Object.entries(data.updates)) {
        const existing = next.get(topic);
        let health: TopicHzState['health'] = 'stable';
        if (existing && existing.hz > 0) {
          const change = Math.abs(hz - existing.hz) / existing.hz;
          if (change > 0.3) health = 'jitter';
        }
        const history = existing?.history ?? [];
        history.push({ hz, t: now });
        if (history.length > 30) history.shift();
        next.set(topic, { hz, health, lastUpdate: now, prevHz: existing?.hz ?? 0, history });
      }
      return next;
    });
  }, []);

  const handleLifecycle = useCallback((event: LifecycleEvent) => {
    setNodeLifecycles(prev => {
      const next = new Map(prev);
      next.set(event.node_name, { state: event.goal_state, timestamp: Date.now() });
      return next;
    });
  }, []);

  const handleNodeParams = useCallback((event: NodeParamsEvent) => {
    setNodeParams(prev => {
      const next = new Map(prev);
      next.set(event.node_name, event.params);
      return next;
    });
  }, []);

  const handleServiceInvoked = useCallback((event: ServiceInvokedEvent) => {
    setServiceInvocations(prev => [event, ...prev].slice(0, MAX_SERVICE_CALLS));
  }, []);

  const handleStatusChange = useCallback((s: ConnectionStatus) => {
    setStatus(s);
    if (s === 'disconnected') {
      setGraph(null);
      setMessages([]);
      setTopicHz(new Map());
    }
  }, []);

  useRosGraph({
    wsUrl: WS_URL, simMode, paused,
    onGraphUpdate: handleGraphUpdate,
    onMessage: handleMessage,
    onFrequency: handleFrequency,
    onLifecycle: handleLifecycle,
    onNodeParams: handleNodeParams,
    onServiceInvoked: handleServiceInvoked,
    onStatusChange: handleStatusChange,
    onBandwidth: handleBandwidth,
  });

  // Three.js scene
  const handleSelectEntity = useCallback((entity: SelectedEntity | null) => {
    setSelectedEntity(entity);
    setSelectedParticle(null);
    if (entity && !inspectorOpen) setInspectorOpen(true);
  }, [inspectorOpen]);

  const handleParticleClick = useCallback((particle: SelectedParticle) => {
    setSelectedParticle(particle);
    setSelectedEntity(null);
    if (!inspectorOpen) setInspectorOpen(true);
  }, [inspectorOpen]);

  const handleSceneRightClick = useCallback((entity: SelectedEntity | null, x: number, y: number) => {
    setSceneContextMenu({ entity, x, y });
  }, []);

  const entityColors = useMemo(() => ({
    node: theme.nodeColor, topic: theme.topicColor, service: theme.serviceColor, action: theme.actionColor,
  }), [theme.nodeColor, theme.topicColor, theme.serviceColor, theme.actionColor]);

  const {
    resetCamera, focusEntity, releaseParticles, setSelectedEntity: setSceneSelectedEntity,
    spawnMessageParticle, spawnServicePulse, triggerServiceActivity,
    updateLifecycle, clearScene, getDeadEndCount, applySceneSettings,
  } = useThreeScene({
    containerRef: canvasRef,
    graph, topicHz, hiddenItems, hiddenTypes, genericHidden, genericOverrides, deadEndMode, isolatedSet,
    sceneBg: theme.bgScene, sceneFog: theme.fog,
    entityColors,
    emissiveIntensity: theme.emissiveIntensity,
    onSelectEntity: handleSelectEntity,
    onParticleClick: handleParticleClick,
    onRightClick: handleSceneRightClick,
  });

  // Spawn particles on message events. Process every message that arrived
  // since the previous render — several can land between renders, and only
  // animating messages[0] silently drops the rest (under-representing rate).
  const lastSpawnedMsgIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (messages.length === 0) return;
    const newMessages: MessageEvent[] = [];
    for (const m of messages) {
      if (m.id === lastSpawnedMsgIdRef.current) break;
      newMessages.push(m);
    }
    lastSpawnedMsgIdRef.current = messages[0].id;
    // Oldest first so the per-topic throttle favors the most recent payloads
    for (let i = newMessages.length - 1; i >= 0; i--) {
      const m = newMessages[i];
      spawnMessageParticle(m.topic, m.msg_type, m.payload, m.size_bytes, m.timestamp, m.dropped_payload);
    }
  }, [messages, spawnMessageParticle]);

  // Spawn service pulses + flare the service's port/junction
  useEffect(() => {
    if (serviceInvocations.length === 0) return;
    const latest = serviceInvocations[0];
    spawnServicePulse(latest.service_name);
    triggerServiceActivity(latest.service_name);
  }, [serviceInvocations, spawnServicePulse, triggerServiceActivity]);

  // Update lifecycle in scene
  useEffect(() => {
    for (const [name, state] of nodeLifecycles) {
      updateLifecycle(name, state.state);
    }
  }, [nodeLifecycles, updateLifecycle]);

  // Sync selected entity into 3D scene (for sidebar-triggered selections)
  useEffect(() => {
    setSceneSelectedEntity(selectedEntity?.id ?? null);
  }, [selectedEntity, setSceneSelectedEntity]);

  // Clear scene on disconnect
  useEffect(() => {
    if (status === 'disconnected') clearScene();
  }, [status, clearScene]);

  // Apply scene settings
  useEffect(() => {
    applySceneSettings(sceneSettings);
  }, [sceneSettings, applySceneSettings]);

  // Derive settings for modal from current theme colors + persisted non-color settings
  const settingsFromTheme = useMemo<SceneSettings>(() => ({
    ...sceneSettings,
    nodes: { color: theme.nodeColorHex, size: sceneSettings.nodes.size, emissive: theme.emissiveIntensity },
    topics: { color: theme.topicColorHex, size: sceneSettings.topics.size, emissive: sceneSettings.topics.emissive },
    services: { color: theme.serviceColorHex, size: sceneSettings.services.size, emissive: sceneSettings.services.emissive },
    actions: { color: theme.actionColorHex, size: sceneSettings.actions.size, emissive: sceneSettings.actions.emissive },
    sceneBg: theme.bg,
  }), [theme, sceneSettings]);

  const handleApplySettings = useCallback((s: SceneSettings) => {
    setSceneSettings(s);
    localStorage.setItem('ros3d-scene-settings', JSON.stringify(s));
    setSettingsOpen(false);

    // Sync scene settings into the custom theme
    themeCtx.setCustomColors({
      menuBg: s.menuBg,
      sceneBg: s.sceneBg,
      node: s.nodes.color,
      topic: s.topics.color,
      service: s.services.color,
      action: s.actions.color,
      emissive: s.nodes.emissive,
    });
    themeCtx.setThemeId('custom');
  }, [themeCtx]);

  const handleResetSettings = useCallback(() => {
    setSceneSettings(DEFAULT_SCENE_SETTINGS);
    localStorage.removeItem('ros3d-scene-settings');
  }, []);

  // Visibility handlers
  const toggleItem = useCallback((id: string) => {
    setHiddenItems(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleType = useCallback((type: string) => {
    setHiddenTypes(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  }, []);

  const toggleGeneric = useCallback(() => setGenericHidden(g => !g), []);

  // Mark/unmark a single entity as generic (BUILT-IN). The module store is
  // updated synchronously so the sidebar reads fresh values on the same render.
  const toggleGenericItem = useCallback((id: string) => {
    setGenericOverridesState(prev => {
      const next = new Map(prev);
      next.set(id, !isGenericById(id));
      setGenericOverrides(next);
      try {
        localStorage.setItem('ros3d-generic-overrides', JSON.stringify(Object.fromEntries(next)));
      } catch { /* storage full/unavailable — overrides stay session-only */ }
      return next;
    });
  }, []);

  const cycleDeadEnd = useCallback(() => {
    setDeadEndMode(m => m === 'hidden' ? 'dimmed' : m === 'dimmed' ? 'shown' : 'hidden');
  }, []);

  const handleIsolate = useCallback((id: string) => {
    if (!graph) return;
    // 2-hop BFS
    const visited = new Set<string>();
    const queue = [id];
    visited.add(id);
    for (let depth = 0; depth < 2; depth++) {
      const next: string[] = [];
      for (const current of queue) {
        // Find neighbors
        for (const topic of graph.topics) {
          const tid = `topic:${topic.name}`;
          const nodeIds = [...topic.publishers.map(p => `node:${p}`), ...topic.subscribers.map(s => `node:${s}`)];
          if (current === tid || nodeIds.includes(current)) {
            visited.add(tid);
            for (const nid of nodeIds) visited.add(nid);
            if (!visited.has(tid)) next.push(tid);
            for (const nid of nodeIds) if (!visited.has(nid)) next.push(nid);
          }
        }
        for (const svc of graph.services) {
          const sid = `service:${svc.name}`;
          const nodeIds = [...svc.servers.map(s => `node:${s}`), ...svc.clients.map(c => `node:${c}`)];
          if (current === sid || nodeIds.includes(current)) {
            visited.add(sid);
            for (const nid of nodeIds) visited.add(nid);
            if (!visited.has(sid)) next.push(sid);
            for (const nid of nodeIds) if (!visited.has(nid)) next.push(nid);
          }
        }
        for (const action of graph.actions) {
          const aid = `action:${action.name}`;
          const nodeIds = [...action.servers.map(s => `node:${s}`), ...action.clients.map(c => `node:${c}`)];
          if (current === aid || nodeIds.includes(current)) {
            visited.add(aid);
            for (const nid of nodeIds) visited.add(nid);
            if (!visited.has(aid)) next.push(aid);
            for (const nid of nodeIds) if (!visited.has(nid)) next.push(nid);
          }
        }
      }
      queue.length = 0;
      queue.push(...next);
    }
    setIsolatedSet(visited);
  }, [graph]);

  const clearIsolation = useCallback(() => setIsolatedSet(null), []);

  // Reveal everything hidden via Hide / type toggles / isolation
  const showAll = useCallback(() => {
    setHiddenItems(new Set());
    setHiddenTypes(new Set());
    setIsolatedSet(null);
  }, []);

  const handleReleaseParticle = useCallback(() => {
    releaseParticles();
    setSelectedParticle(null);
  }, [releaseParticles]);

  return (
    <div className="absolute inset-0 overflow-hidden" style={{
      background: sceneSettings.sceneBg || theme.bg,
      ['--menu-bg' as string]: `${sceneSettings.menuBg}e0`,
      ['--menu-bg-solid' as string]: sceneSettings.menuBg,
      ['--menu-text' as string]: sceneSettings.labelColor === 'black' ? '#000000' : '#ffffff',
      ['--menu-text-muted' as string]: sceneSettings.labelColor === 'black' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)',
      ['--menu-text-dim' as string]: sceneSettings.labelColor === 'black' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.3)',
    }}>
      <div ref={canvasRef} className="absolute inset-0 z-0" />

      <Header status={status} graph={graph} bandwidth={bandwidth} onOpenSettings={() => setSettingsOpen(true)} onResetSettings={handleResetSettings} />

      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen(o => !o)}
        graph={graph}
        selectedEntity={selectedEntity}
        onSelectEntity={handleSelectEntity}
        onFocusEntity={focusEntity}
        hiddenItems={hiddenItems}
        hiddenTypes={hiddenTypes}
        genericHidden={genericHidden}
        onToggleItem={toggleItem}
        onToggleType={toggleType}
        onToggleGeneric={toggleGeneric}
        onToggleGenericItem={toggleGenericItem}
        genericOverrides={genericOverrides}
        onIsolate={handleIsolate}
        onClearIsolation={clearIsolation}
      />

      <InspectorDrawer
        open={inspectorOpen}
        onToggle={() => setInspectorOpen(o => !o)}
        graph={graph}
        messages={messages}
        serviceInvocations={serviceInvocations}
        selectedEntity={selectedEntity}
        selectedParticle={selectedParticle}
        topicHz={topicHz}
        nodeLifecycles={nodeLifecycles}
        nodeParams={nodeParams}
        onClearSelected={() => { setSelectedEntity(null); setSelectedParticle(null); }}
        onReleaseParticle={handleReleaseParticle}
      />

      <ControlsOverlay
        open={sidebarOpen}
        onResetCamera={resetCamera}
        simMode={simMode}
        onToggleSim={() => setSimMode(m => !m)}
        paused={paused}
        onTogglePause={() => setPaused(p => !p)}
        deadEndMode={deadEndMode}
        deadEndCount={getDeadEndCount()}
        onCycleDeadEnd={cycleDeadEnd}
      />

      {/* 3D viewport context menu */}
      {sceneContextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setSceneContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setSceneContextMenu(null); }} />
          <div className="fixed z-50 min-w-[160px] py-1.5 px-1.5 rounded-lg backdrop-blur-xl border border-white/[0.1] shadow-xl"
            style={{ left: sceneContextMenu.x, top: sceneContextMenu.y, background: 'var(--menu-bg-solid)' }}>
            {sceneContextMenu.entity && (
              <>
                <SceneCtxItem onClick={() => { toggleItem(sceneContextMenu.entity!.id); setSceneContextMenu(null); }}>
                  {hiddenItems.has(sceneContextMenu.entity.id) ? 'Show' : 'Hide'}
                </SceneCtxItem>
                <SceneCtxItem onClick={() => { handleIsolate(sceneContextMenu.entity!.id); setSceneContextMenu(null); }}>
                  Isolate
                </SceneCtxItem>
                <SceneCtxItem onClick={() => { focusEntity(sceneContextMenu.entity!.id); setSceneContextMenu(null); }}>
                  Focus
                </SceneCtxItem>
                {sceneContextMenu.entity.entityType !== 'action' && (
                  <SceneCtxItem onClick={() => { toggleGenericItem(sceneContextMenu.entity!.id); setSceneContextMenu(null); }}>
                    {isGenericById(sceneContextMenu.entity.id) ? 'Unmark Generic' : 'Mark Generic'}
                  </SceneCtxItem>
                )}
              </>
            )}
            {isolatedSet && (
              <SceneCtxItem onClick={() => { clearIsolation(); setSceneContextMenu(null); }}>
                Clear Isolation
              </SceneCtxItem>
            )}
            {!sceneContextMenu.entity && (
              <SceneCtxItem onClick={() => { showAll(); setSceneContextMenu(null); }}>
                Show All
              </SceneCtxItem>
            )}
          </div>
        </>
      )}
      {/* Settings Modal */}
      <SettingsModal
        open={settingsOpen}
        settings={settingsFromTheme}
        onApply={handleApplySettings}
        onCancel={() => setSettingsOpen(false)}
      />
    </div>
  );
}

function SceneCtxItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-white/[0.06] rounded-md transition-colors" style={{ color: 'var(--menu-text-muted)' }}>
      {children}
    </button>
  );
}
