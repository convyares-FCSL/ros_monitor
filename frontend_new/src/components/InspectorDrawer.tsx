import { useState, useRef, useMemo } from 'react';
import { ChevronRight, ChevronLeft, X, Search, AlertTriangle, ChevronDown, Activity, Shield, Code } from 'lucide-react';
import { FrequencySparkline } from './FrequencySparkline';
import { useTheme } from '../hooks/useTheme';
import type { GraphUpdate, MessageEvent, ServiceInvokedEvent, SelectedEntity, SelectedParticle, TopicHzState, NodeLifecycleState } from '../types';

interface InspectorDrawerProps {
  open: boolean;
  onToggle: () => void;
  graph: GraphUpdate | null;
  messages: MessageEvent[];
  serviceInvocations: ServiceInvokedEvent[];
  selectedEntity: SelectedEntity | null;
  selectedParticle: SelectedParticle | null;
  topicHz: Map<string, TopicHzState>;
  nodeLifecycles: Map<string, NodeLifecycleState>;
  nodeParams: Map<string, Record<string, unknown>>;
  onClearSelected: () => void;
  onReleaseParticle: () => void;
}

export function InspectorDrawer({
  open, onToggle, graph, messages, serviceInvocations,
  selectedEntity, selectedParticle, topicHz, nodeLifecycles, nodeParams,
  onClearSelected, onReleaseParticle,
}: InspectorDrawerProps) {
  const { theme } = useTheme();
  const inspectorTitle = useMemo(() => {
    if (selectedParticle) return 'PACKET INSPECTOR';
    if (!selectedEntity) return 'PACKET INSPECTOR';
    switch (selectedEntity.entityType) {
      case 'node': return 'NODE ACTIVITY';
      case 'topic': return 'TOPIC ACTIVITY';
      case 'service': return 'SERVICE ACTIVITY';
      case 'action': return 'ACTION ACTIVITY';
    }
  }, [selectedEntity, selectedParticle]);

  const inspectorColor = useMemo(() => {
    if (!selectedEntity) return theme.topicColorHex;
    switch (selectedEntity.entityType) {
      case 'node': return theme.nodeColorHex;
      case 'topic': return theme.topicColorHex;
      case 'service': return theme.serviceColorHex;
      case 'action': return theme.actionColorHex;
    }
  }, [selectedEntity, theme]);

  return (
    <>
      <button onClick={onToggle}
        className={`absolute z-30 w-6 h-10 flex items-center justify-center
          backdrop-blur-xl border border-white/[0.08] rounded-l-md
          text-white/50 hover:text-white hover:bg-white/5 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
          ${open ? 'right-[25.75rem]' : 'right-0'}`}
        style={{ background: 'var(--menu-bg)', top: '88px' }}>
        {open ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>

      <aside className={`absolute right-3 w-96 z-20 flex flex-col rounded-2xl overflow-hidden
        backdrop-blur-2xl transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
        ${open ? 'translate-x-0' : 'translate-x-[calc(100%+12px)]'}`}
        style={{ background: 'var(--menu-bg)', border: `1px solid ${theme.panelBorder}`, top: '68px', height: 'calc(100vh - 68px - 16px)' }}>

        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${theme.panelBorder}` }}>
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5" style={{ color: inspectorColor }} />
            <span className="text-xs font-bold tracking-widest uppercase" style={{ color: inspectorColor }}>{inspectorTitle}</span>
          </div>
          {(selectedEntity || selectedParticle) && (
            <button onClick={onClearSelected} className="text-white/30 hover:text-white/70 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* overflow-y-scroll (not auto): keeps the scrollbar permanently so it
            doesn't flicker in/out when content sits right at the threshold */}
        <div className="flex-1 min-h-0 overflow-y-scroll px-4 py-4 space-y-4 scrollbar-thin">
          {selectedParticle ? (
            <PacketInspector particle={selectedParticle} onRelease={onReleaseParticle} />
          ) : selectedEntity && graph ? (
            <>
              {selectedEntity.entityType === 'node' && (
                <NodeInspector entity={selectedEntity} graph={graph} messages={messages}
                  nodeLifecycles={nodeLifecycles} nodeParams={nodeParams} topicHz={topicHz} />
              )}
              {selectedEntity.entityType === 'topic' && (
                <TopicInspector entity={selectedEntity} graph={graph} messages={messages} topicHz={topicHz} />
              )}
              {selectedEntity.entityType === 'service' && (
                <ServiceInspector entity={selectedEntity} graph={graph} serviceInvocations={serviceInvocations} />
              )}
              {selectedEntity.entityType === 'action' && (
                <ActionInspector entity={selectedEntity} graph={graph} messages={messages} />
              )}
            </>
          ) : (
            <EmptyState />
          )}
        </div>
      </aside>
    </>
  );
}

// === EMPTY STATE ===
function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 text-white/25">
      <Search className="w-12 h-12 stroke-[1]" />
      <p className="text-xs text-center max-w-[220px] leading-relaxed">
        Click on any traveling 3D message icon to pause and inspect its payload
      </p>
    </div>
  );
}

// === PACKET INSPECTOR ===
function PacketInspector({ particle, onRelease }: { particle: SelectedParticle; onRelease: () => void }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <InfoRow label="Topic" value={particle.topic} color="text-orange-400" />
        <InfoRow label="Type" value={particle.msg_type} />
        <InfoRow label="From" value={particle.fromNode} />
        <InfoRow label="To" value={particle.toNode} />
        <InfoRow label="Size" value={`${particle.size_bytes.toLocaleString()} Bytes`} />
        <InfoRow label="Time" value={new Date(particle.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions)} />
      </div>

      {particle.dropped_payload && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-500/5 border border-orange-500/20 text-orange-400 text-[11px]">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          Payload trimmed for performance
        </div>
      )}

      {particle.payload && (
        <PayloadBlock payload={particle.payload}
          meta={`${particle.topic} ${new Date(particle.timestamp).toLocaleTimeString([], { hour12: false })} ${particle.size_bytes} Bytes`} />
      )}

      <button onClick={onRelease}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-xs font-semibold hover:bg-green-500/20 transition-colors">
        <Activity className="w-3.5 h-3.5" />
        Resume Telemetry Stream
      </button>
    </div>
  );
}

// === NODE INSPECTOR ===
function NodeInspector({ entity, graph, messages, nodeLifecycles, nodeParams, topicHz }: {
  entity: SelectedEntity; graph: GraphUpdate; messages: MessageEvent[];
  nodeLifecycles: Map<string, NodeLifecycleState>; nodeParams: Map<string, Record<string, unknown>>;
  topicHz: Map<string, TopicHzState>;
}) {
  const node = graph.nodes.find(n => `node:${n.name}` === entity.id);
  if (!node) return null;

  const lifecycle = nodeLifecycles.get(node.name);
  const params = nodeParams.get(node.name);
  const pubs = graph.topics.filter(t => t.publishers.includes(node.name));
  const subs = graph.topics.filter(t => t.subscribers.includes(node.name));
  const svcs = graph.services.filter(s => s.servers.includes(node.name));
  const svcClients = graph.services.filter(s => s.clients.includes(node.name));
  const actionServers = graph.actions.filter(a => a.servers.includes(node.name));
  const actionClients = graph.actions.filter(a => a.clients.includes(node.name));
  const relatedTopics = [...new Set([...pubs.map(t => t.name), ...subs.map(t => t.name)])];
  const nodeMessages = messages.filter(m => relatedTopics.includes(m.topic)).slice(0, 50);
  const [selectedMsg, setSelectedMsg] = useState<MessageEvent | null>(null);

  return (
    <div className="space-y-2">
      {/* Header info */}
      <div className="space-y-2">
        <InfoRow label="Selection" value={node.name} color="text-cyan-400" />
        <InfoRow label="Type" value="" badge="node" badgeColor="bg-cyan-500/20 text-cyan-400 border-cyan-500/30" />
        <div className="flex items-center gap-3 py-1">
          <span className="text-[11px] text-white/40 font-semibold">PID</span>
          <Badge color={node.pid === null ? 'red' : 'green'}>
            {node.pid === null ? 'PHANTOM' : String(node.pid)}
          </Badge>
          <span className="text-[11px] text-white/40 font-semibold ml-2">Lifecycle</span>
          {lifecycle
            ? <Badge color={lifecycleColor(lifecycle.state)}>{lifecycle.state.toUpperCase()}</Badge>
            : <Badge color="slate">UNKNOWN</Badge>}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-white/[0.08]" />

      {/* Parameters */}
      {params && Object.keys(params).length > 0 && (
        <CollapsedSection title="PARAMETERS" count={Object.keys(params).length}>
          <div className="space-y-1">
            {Object.entries(params).map(([k, v]) => (
              <div key={k} className="flex justify-between text-[10px] font-mono gap-2">
                <span className="text-white/40 truncate">{k}</span>
                <span className="text-white/70">{String(v)}</span>
              </div>
            ))}
          </div>
        </CollapsedSection>
      )}

      {/* Separate entity sections */}
      <CollapsedSection title="PUBLISHERS" count={pubs.length}>
        {pubs.length === 0 ? <EmptyChip /> : (
          <div className="space-y-1">
            {pubs.map(t => (
              <TopicChip key={t.name} name={t.name} hz={topicHz.get(t.name)} />
            ))}
          </div>
        )}
      </CollapsedSection>

      <CollapsedSection title="SUBSCRIBERS" count={subs.length}>
        {subs.length === 0 ? <EmptyChip /> : (
          <div className="space-y-1">
            {subs.map(t => (
              <TopicChip key={t.name} name={t.name} hz={topicHz.get(t.name)} />
            ))}
          </div>
        )}
      </CollapsedSection>

      <CollapsedSection title="SERVICES (SERVER)" count={svcs.length}>
        {svcs.length === 0 ? <EmptyChip /> : <ChipList items={svcs.map(s => s.name)} color="green" />}
      </CollapsedSection>

      <CollapsedSection title="SERVICES (CLIENT)" count={svcClients.length}>
        {svcClients.length === 0 ? <EmptyChip /> : <ChipList items={svcClients.map(s => s.name)} color="green" />}
      </CollapsedSection>

      <CollapsedSection title="ACTIONS (SERVER)" count={actionServers.length}>
        {actionServers.length === 0 ? <EmptyChip /> : <ChipList items={actionServers.map(a => a.name)} color="purple" />}
      </CollapsedSection>

      <CollapsedSection title="ACTIONS (CLIENT)" count={actionClients.length}>
        {actionClients.length === 0 ? <EmptyChip /> : <ChipList items={actionClients.map(a => a.name)} color="purple" />}
      </CollapsedSection>

      {/* Divider before live data */}
      <div className="border-t border-white/[0.08] pt-3">
        <LiveDataSection messages={nodeMessages} selected={selectedMsg} onSelect={setSelectedMsg} />
      </div>

      {/* Payload Viewer - always visible, shows selected or latest */}
      <PayloadBlock payload={selectedMsg?.payload ?? nodeMessages[0]?.payload ?? null}
        meta={selectedMsg
          ? `${selectedMsg.topic} ${selectedMsg.size_bytes} Bytes`
          : nodeMessages[0]
            ? `${nodeMessages[0].topic} ${nodeMessages[0].size_bytes} Bytes`
            : ''} />
    </div>
  );
}

// === TOPIC INSPECTOR ===
function TopicInspector({ entity, graph, messages, topicHz }: {
  entity: SelectedEntity; graph: GraphUpdate; messages: MessageEvent[]; topicHz: Map<string, TopicHzState>;
}) {
  const topic = graph.topics.find(t => `topic:${t.name}` === entity.id);
  if (!topic) return null;

  const hz = topicHz.get(topic.name);
  const topicMessages = messages.filter(m => m.topic === topic.name).slice(0, 50);
  const [selectedMsg, setSelectedMsg] = useState<MessageEvent | null>(null);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <InfoRow label="Selection" value={topic.name} color="text-orange-400" />
        <InfoRow label="Type" value="" badge="topic" badgeColor="bg-orange-500/20 text-orange-400 border-orange-500/30" />
        <InfoRow label="Msg Type" value={topic.types[0] ?? 'unknown'} />
      </div>

      <div className="border-t border-white/[0.08]" />

      <CollapsedSection title="PUBLISHERS" count={topic.publishers.length}>
        {topic.publishers.length === 0 ? <EmptyChip /> : <ChipList items={topic.publishers} color="cyan" />}
      </CollapsedSection>

      <CollapsedSection title="SUBSCRIBERS" count={topic.subscribers.length}>
        {topic.subscribers.length === 0 ? <EmptyChip /> : <ChipList items={topic.subscribers} color="cyan" />}
      </CollapsedSection>

      {/* Divider before live data */}
      <div className="border-t border-white/[0.08] pt-3 space-y-3">
        {/* Frequency card with sparkline */}
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-3.5 h-3.5 text-green-400" />
              <span className="text-[11px] font-bold uppercase tracking-widest text-white/50">FREQUENCY</span>
            </div>
            <Badge color={hz ? (hz.health === 'stable' ? 'green' : hz.health === 'jitter' ? 'amber' : 'red') : 'green'}>
              {!hz || hz.health === 'stale' ? '--' : `${hz.hz.toFixed(1)} Hz`}
            </Badge>
          </div>
          {hz && hz.history.length >= 2 && (
            <>
              <FrequencySparkline history={hz.history} health={hz.health} />
              <div className="text-[9px] text-white/25">30 s window</div>
            </>
          )}
          {(!hz || hz.history.length < 2) && (
            <div className="text-[10px] text-white/25 italic py-2">Waiting for frequency data...</div>
          )}
        </div>

        <LiveDataSection messages={topicMessages} selected={selectedMsg} onSelect={setSelectedMsg} />
      </div>

      {selectedMsg && <PayloadBlock payload={selectedMsg.payload}
        meta={`${selectedMsg.topic} ${new Date(selectedMsg.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions)} ${selectedMsg.size_bytes} Bytes`} />}

      {!selectedMsg && <PayloadBlock payload={topicMessages[0]?.payload ?? null}
        meta={topicMessages[0] ? `${topicMessages[0].topic} ${topicMessages[0].size_bytes} Bytes` : ''} />}
    </div>
  );
}

// === SERVICE INSPECTOR ===
function ServiceInspector({ entity, graph, serviceInvocations }: {
  entity: SelectedEntity; graph: GraphUpdate; serviceInvocations: ServiceInvokedEvent[];
}) {
  const svcName = entity.id.replace('service:', '');
  const svc = graph.services.find(s => s.name === svcName);
  if (!svc) return null;

  const calls = serviceInvocations.filter(si => si.service_name === svc.name).slice(0, 20);
  const [selectedCall, setSelectedCall] = useState<ServiceInvokedEvent | null>(null);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <InfoRow label="Selection" value={svc.name} color="text-green-400" />
        <InfoRow label="Type" value="" badge="service" badgeColor="bg-green-500/20 text-green-400 border-green-500/30" />
        <InfoRow label="Srv Type" value={svc.types[0] ?? 'unknown'} />
      </div>

      <div className="border-t border-white/[0.08]" />

      <CollapsedSection title="SERVERS" count={svc.servers.length}>
        {svc.servers.length === 0 ? <EmptyChip /> : <ChipList items={svc.servers} color="green" />}
      </CollapsedSection>

      <CollapsedSection title="CLIENTS" count={svc.clients.length}>
        {svc.clients.length === 0 ? <EmptyChip /> : <ChipList items={svc.clients} color="cyan" />}
      </CollapsedSection>

      <CollapsedSection title="SERVICE TYPES" count={svc.types.length}>
        {svc.types.length === 0 ? <EmptyChip /> : <ChipList items={svc.types} color="green" />}
      </CollapsedSection>

      {/* Divider before calls */}
      <div className="border-t border-white/[0.08] pt-3 space-y-2">
        <div className="text-[11px] font-bold uppercase tracking-widest text-white/50 pb-1">
          SERVICE CALLS
        </div>
        {calls.length === 0 ? (
          <p className="text-[10px] text-white/30 italic leading-relaxed">
            No calls captured yet. Enable service introspection on the server node to monitor live calls.
          </p>
        ) : (
          <div className="space-y-1.5">
            {calls.map(call => (
              <button key={call.id} onClick={() => setSelectedCall(selectedCall?.id === call.id ? null : call)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 text-left rounded-md border transition-all
                  ${selectedCall?.id === call.id ? 'border-green-500/40 bg-green-500/10' : 'border-white/[0.05] bg-black/20 hover:bg-white/[0.03]'}`}>
                <Shield className="w-3 h-3 text-green-400/60 flex-shrink-0" />
                <span className="text-[10px] font-mono text-white/50 flex-1">
                  {call.event_type === 0 ? 'REQUEST_SENT' : 'REQUEST_RECEIVED'}
                </span>
                <span className="text-[9px] text-white/30 font-mono">
                  {new Date(call.timestamp).toLocaleTimeString([], { hour12: false })}
                </span>
              </button>
            ))}
          </div>
        )}
        {selectedCall?.payload && <PayloadBlock payload={selectedCall.payload}
          meta={`${selectedCall.service_name} ${new Date(selectedCall.timestamp).toLocaleTimeString([], { hour12: false })}`} />}
        {!selectedCall && calls.length > 0 && calls[0].payload && <PayloadBlock payload={calls[0].payload}
          meta={`${calls[0].service_name} ${new Date(calls[0].timestamp).toLocaleTimeString([], { hour12: false })}`} />}
      </div>
    </div>
  );
}

// === ACTION INSPECTOR ===
function ActionInspector({ entity, graph, messages }: {
  entity: SelectedEntity; graph: GraphUpdate; messages: MessageEvent[];
}) {
  const action = graph.actions.find(a => `action:${a.name}` === entity.id);
  if (!action) return null;

  const actionMessages = messages.filter(m => m.topic.includes(action.name)).slice(0, 20);
  const [selectedMsg, setSelectedMsg] = useState<MessageEvent | null>(null);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <InfoRow label="Selection" value={action.name} color="text-purple-400" />
        <InfoRow label="Type" value="" badge="action" badgeColor="bg-purple-500/20 text-purple-400 border-purple-500/30" />
        <InfoRow label="Action Type" value={action.type} />
      </div>

      <div className="border-t border-white/[0.08]" />

      <CollapsedSection title="SERVERS" count={action.servers.length}>
        {action.servers.length === 0 ? <EmptyChip /> : <ChipList items={action.servers} color="purple" />}
      </CollapsedSection>

      <CollapsedSection title="CLIENTS" count={action.clients.length}>
        {action.clients.length === 0 ? <EmptyChip /> : <ChipList items={action.clients} color="cyan" />}
      </CollapsedSection>

      {/* Divider before live data */}
      <div className="border-t border-white/[0.08] pt-3">
        <LiveDataSection messages={actionMessages} selected={selectedMsg} onSelect={setSelectedMsg} />
      </div>

      {selectedMsg && <PayloadBlock payload={selectedMsg.payload}
        meta={`${selectedMsg.topic} ${new Date(selectedMsg.timestamp).toLocaleTimeString([], { hour12: false })}`} />}

      {!selectedMsg && <PayloadBlock payload={actionMessages[0]?.payload ?? null}
        meta={actionMessages[0] ? `${actionMessages[0].topic}` : ''} />}
    </div>
  );
}

// === LIVE DATA (entity-scoped, stable ordering) ===
function LiveDataSection({ messages, selected, onSelect }: {
  messages: MessageEvent[]; selected: MessageEvent | null; onSelect: (m: MessageEvent | null) => void;
}) {
  const topicOrderRef = useRef<string[]>([]);
  const seenRef = useRef<Set<string>>(new Set());

  for (const m of messages) {
    if (!seenRef.current.has(m.topic)) {
      seenRef.current.add(m.topic);
      topicOrderRef.current.push(m.topic);
    }
  }

  const groupsRef = useRef<Map<string, MessageEvent[]>>(new Map());
  groupsRef.current = new Map();
  for (const m of messages) {
    const arr = groupsRef.current.get(m.topic) ?? [];
    if (arr.length < 10) arr.push(m);
    groupsRef.current.set(m.topic, arr);
  }

  if (groupsRef.current.size === 0) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-green-400/60" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/50">LIVE DATA</span>
        </div>
        <p className="text-[10px] text-white/25 italic">No messages captured yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between pb-1">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-green-400/60" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-white/50">LIVE DATA</span>
        </div>
        <span className="text-[10px] font-mono text-white/25">{groupsRef.current.size}</span>
      </div>
      {topicOrderRef.current.map(topic => {
        const msgs = groupsRef.current.get(topic);
        if (!msgs || msgs.length === 0) return null;
        return (
        <details key={topic} className="group/live rounded-lg border border-white/[0.06] bg-white/[0.02]">
          <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none hover:bg-white/[0.03] text-[11px]">
            <ChevronRight className="w-3 h-3 text-white/30 transition-transform duration-150 group-open/live:rotate-90" />
            <span className="font-mono text-white/60 flex-1 truncate">{topic}</span>
            <span className="text-[9px] font-mono text-white/30">{msgs.length} entries</span>
          </summary>
          <div className="px-3 pb-2 space-y-1">
            {msgs.map(msg => (
              <button key={msg.id} onClick={() => onSelect(selected?.id === msg.id ? null : msg)}
                className={`w-full text-left px-2.5 py-2 rounded-lg border text-[10px] font-mono transition-all
                  ${selected?.id === msg.id ? 'border-cyan-500/40 bg-cyan-500/10' : 'border-transparent hover:bg-white/[0.03]'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-white/50">{new Date(msg.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions)}, {msg.size_bytes} Bytes</span>
                </div>
                <div className="mt-1">
                  <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                    {msg.msg_type}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </details>
        );
      })}
    </div>
  );
}

// === SHARED COMPONENTS ===
function PayloadBlock({ payload, meta }: { payload: Record<string, unknown> | null; meta: string }) {
  if (!payload) return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Code className="w-3.5 h-3.5 text-white/30" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-white/50">PAYLOAD VIEWER</span>
      </div>
      <div className="bg-black/50 border border-white/[0.05] rounded-lg p-3 text-[10px] text-white/30 italic">
        Payload not available (dropped or empty)
      </div>
    </div>
  );
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Code className="w-3.5 h-3.5 text-cyan-400/60" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-white/50">PAYLOAD VIEWER</span>
      </div>
      <div className="text-[9px] text-white/30 font-mono">{meta}</div>
      <div className="bg-black/50 border border-white/[0.05] rounded-lg p-3 font-mono text-[10px] text-white/60 overflow-x-auto whitespace-pre-wrap break-all max-h-52 scrollbar-thin">
        {JSON.stringify(payload, null, 2)}
      </div>
    </div>
  );
}

function TopicChip({ name, hz }: { name: string; hz?: TopicHzState }) {
  return (
    <div className="flex items-center justify-between text-[11px] font-mono px-2.5 py-1.5 rounded border border-orange-500/20 bg-orange-500/5">
      <span className="text-orange-400 truncate flex-1">{name}</span>
      {hz && (
        <span className={`text-[9px] ml-2 ${hz.health === 'stable' ? 'text-green-400' : hz.health === 'jitter' ? 'text-amber-400' : 'text-red-400'}`}>
          {hz.health === 'stale' ? '--' : `${hz.hz.toFixed(1)} Hz`}
        </span>
      )}
    </div>
  );
}

function EmptyChip() {
  return <span className="text-[10px] text-white/25 italic">None</span>;
}

function InfoRow({ label, value, color, badge, badgeColor }: { label: string; value: string; color?: string; badge?: string; badgeColor?: string }) {
  return (
    <div className="flex justify-between items-center text-[11px]">
      <span className="text-white/40 font-semibold">{label}</span>
      {badge ? (
        <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono border ${badgeColor}`}>{badge}</span>
      ) : (
        <span className={`font-mono text-right break-all max-w-[60%] ${color ?? 'text-white/70'}`}>{value}</span>
      )}
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  const colors: Record<string, string> = {
    green: 'bg-green-500/15 border-green-500/30 text-green-400',
    red: 'bg-red-500/15 border-red-500/30 text-red-400',
    amber: 'bg-amber-500/15 border-amber-500/30 text-amber-400',
    purple: 'bg-purple-500/15 border-purple-500/30 text-purple-400',
    cyan: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400',
    slate: 'bg-slate-500/15 border-slate-500/30 text-slate-400',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold font-mono border ${colors[color] ?? colors.green}`}>
      {children}
    </span>
  );
}

function lifecycleColor(state: string): string {
  if (state === 'active') return 'cyan';
  if (state === 'inactive') return 'amber';
  if (state.includes('error') || state.includes('shutdown')) return 'red';
  return 'green';
}

function CollapsedSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-white/[0.06] bg-white/[0.02]">
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none hover:bg-white/[0.03]">
        <ChevronDown className="w-3 h-3 text-white/30 -rotate-90 group-open:rotate-0 transition-transform duration-150" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-white/50 flex-1">{title}</span>
        <span className={`text-[11px] font-mono ${count === 0 ? 'text-white/20' : 'text-white/40'}`}>{count}</span>
      </summary>
      <div className="px-3 pb-2.5">{children}</div>
    </details>
  );
}

const CHIP_COLORS: Record<string, string> = {
  cyan: 'text-cyan-400 border-cyan-500/20 bg-cyan-500/5',
  orange: 'text-orange-400 border-orange-500/20 bg-orange-500/5',
  green: 'text-green-400 border-green-500/20 bg-green-500/5',
  purple: 'text-purple-400 border-purple-500/20 bg-purple-500/5',
};

function ChipList({ items, color }: { items: string[]; color: string }) {
  if (items.length === 0) return <EmptyChip />;
  return (
    <div className="space-y-1">
      {items.map(item => (
        <div key={item} className={`text-[11px] font-mono px-2.5 py-1.5 rounded border break-all ${CHIP_COLORS[color]}`}>
          {item}
        </div>
      ))}
    </div>
  );
}
