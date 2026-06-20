import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react';
import {
  useBtStore, useNodeDef, useNodeStatus, useActiveBlackboard,
  useActiveBlackboardTouched, useActiveBlueprint,
} from '../store/btStore';
import { useRosGraphStore } from '../store/rosGraphStore';
import type { NodeStatus } from './types';

const STATUS_STYLE: Record<NodeStatus, { label: string; cls: string }> = {
  IDLE: { label: 'IDLE', cls: 'text-[color:rgb(var(--fg-rgb)/0.5)] bg-[rgb(var(--fg-rgb)/0.05)]' },
  RUNNING: { label: 'RUNNING', cls: 'text-cyan-300 bg-cyan-500/15' },
  SUCCESS: { label: 'SUCCESS', cls: 'text-emerald-300 bg-emerald-500/15' },
  FAILURE: { label: 'FAILURE', cls: 'text-red-300 bg-red-500/15' },
};

function bbKey(value: string): string | null {
  const m = /^\{(.+)\}$/.exec(value.trim());
  return m ? m[1] : null;
}

const PANEL_BG = 'var(--menu-bg, rgba(15,23,42,0.85))';

function groupByPrefix(keys: string[]): Array<{ prefix: string; keys: string[] }> {
  const map = new Map<string, string[]>();
  for (const key of keys) {
    const idx = key.indexOf('_');
    const prefix = idx > 0 ? key.slice(0, idx) : key;
    if (!map.has(prefix)) map.set(prefix, []);
    map.get(prefix)!.push(key);
  }
  return Array.from(map.entries()).map(([prefix, ks]) => ({ prefix, keys: ks }));
}

function useDivider(
  asideRef: React.RefObject<HTMLElement | null>,
  onMove: (rawPct: number) => void,
) {
  return useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const handler = (ev: MouseEvent) => {
      const el = asideRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      onMove(((ev.clientY - rect.top) / rect.height) * 100);
    };
    const up = () => {
      window.removeEventListener('mousemove', handler);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'row-resize';
    window.addEventListener('mousemove', handler);
    window.addEventListener('mouseup', up);
  }, [asideRef, onMove]);
}

export function BTInspector() {
  const [open, setOpen] = useState(true);
  const [bbPct, setBbPct] = useState(33);
  const [paramPct, setParamPct] = useState(33);
  const asideRef = useRef<HTMLElement>(null);

  const selectedId = useBtStore((s) => s.selectedNodeId);
  const node = useNodeDef(selectedId ?? -1);
  const status = useNodeStatus(selectedId ?? -1);
  const blackboard = useActiveBlackboard();
  const touched = useActiveBlackboardTouched();
  const blueprint = useActiveBlueprint();
  const select = useBtStore((s) => s.select);

  const nodeParams = useRosGraphStore((s) => s.nodeParams);
  const btConnectedPort = useRosGraphStore((s) => s.btConnectedPort);

  // All ROS nodes that expose a Groot2 port — these are BT executor nodes.
  const btHosts = useMemo(() => {
    const hosts: Array<{ name: string; params: Record<string, unknown> }> = [];
    nodeParams.forEach((params, name) => {
      if ('groot_port' in params || 'groot2_port' in params) {
        hosts.push({ name, params });
      }
    });
    hosts.sort((a, b) => a.name.localeCompare(b.name));
    return hosts;
  }, [nodeParams]);

  // Selected node for the param panel — defaults to the currently connected
  // executor (matched by ZMQ port). User can override by clicking any row.
  const [selectedParamNode, setSelectedParamNode] = useState<string | null>(null);
  const userPickedRef = useRef(false);

  useEffect(() => {
    if (userPickedRef.current) return;
    if (btConnectedPort == null) return;
    for (const { name, params } of btHosts) {
      const p = params['groot_port'] ?? params['groot2_port'];
      if (Number(p) === btConnectedPort) {
        setSelectedParamNode(name);
        return;
      }
    }
  }, [btHosts, btConnectedPort]);

  const hostParams = selectedParamNode ? nodeParams.get(selectedParamNode) ?? null : null;

  // Blackboard keys the selected BT node's ports remap.
  const referenced = useMemo(() => {
    const keys = new Set<string>();
    if (node) {
      for (const grp of [node.ports.input, node.ports.output]) {
        if (!grp) continue;
        for (const v of Object.values(grp)) {
          const k = bbKey(v);
          if (k) keys.add(k);
        }
      }
    }
    return keys;
  }, [node]);

  const startResizeBb = useDivider(asideRef, useCallback((raw) => {
    // Leave at least 15% each for params and inspector.
    setBbPct((prev) => Math.max(10, Math.min(100 - paramPct - 15, raw)));
  }, [paramPct]));

  const startResizeParam = useDivider(asideRef, useCallback((raw) => {
    // raw = distance from top as % of aside; subtract bb to get param height.
    // Clamp so inspector keeps at least 15%.
    setParamPct(Math.max(10, Math.min(100 - bbPct - 15, raw - bbPct)));
  }, [bbPct]));

  const [openBbGroups, setOpenBbGroups] = useState<Set<string>>(new Set());
  const [openParamGroups, setOpenParamGroups] = useState<Set<string>>(new Set());
  const toggleBbGroup = (p: string) =>
    setOpenBbGroups((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });
  const toggleParamGroup = (p: string) =>
    setOpenParamGroups((s) => { const n = new Set(s); n.has(p) ? n.delete(p) : n.add(p); return n; });

  const bbGroups = useMemo(
    () => groupByPrefix(Object.keys(blackboard).sort()),
    [blackboard],
  );
  const paramGroups = useMemo(
    () => hostParams ? groupByPrefix(Object.keys(hostParams).sort()) : [],
    [hostParams],
  );

  const inputs = node ? Object.entries(node.ports.input ?? {}) : [];
  const outputs = node ? Object.entries(node.ports.output ?? {}) : [];
  const st = STATUS_STYLE[status ?? 'IDLE'];

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className="absolute z-30 w-6 h-10 flex items-center justify-center backdrop-blur-xl border border-[rgb(var(--fg-rgb)/0.08)] rounded-l-md text-[color:rgb(var(--fg-rgb)/0.5)] hover:text-[color:rgb(var(--fg-rgb))] hover:bg-[rgb(var(--fg-rgb)/0.05)] transition-all duration-300"
        style={{ background: PANEL_BG, top: '88px', right: open ? '21rem' : '0' }}
        title={open ? 'Collapse' : 'Expand'}
      >
        {open ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
      </button>

      <aside
        ref={asideRef}
        className={`absolute right-3 top-[68px] bottom-3 w-80 z-20 rounded-2xl backdrop-blur-2xl border flex flex-col overflow-hidden transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${open ? 'translate-x-0' : 'translate-x-[calc(100%+1.5rem)]'}`}
        style={{ background: PANEL_BG, borderColor: 'rgba(255,255,255,0.08)' }}
      >
        {/* ── Blackboard ── */}
        <div className="min-h-0 flex flex-col shrink-0" style={{ flexBasis: `${bbPct}%` }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[rgb(var(--fg-rgb)/0.07)]">
            <span className="text-[9px] font-bold tracking-[0.18em] text-[color:rgb(var(--fg-rgb)/0.4)]">BLACKBOARD</span>
            {blueprint && <span className="text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.35)] truncate max-w-[55%]">{blueprint.tree_id}</span>}
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 space-y-0.5">
            {bbGroups.length === 0 ? (
              <Empty>no blackboard data</Empty>
            ) : bbGroups.map(({ prefix, keys }) => {
              if (keys.length === 1) {
                const k = keys[0];
                const v = blackboard[k];
                return (
                  <div key={k} className={`flex items-center justify-between gap-2 px-2 py-1 rounded ${referenced.has(k) ? 'bg-cyan-500/10 border border-cyan-500/20' : ''}`}>
                    <span className={`text-[10px] font-mono truncate ${referenced.has(k) ? 'text-cyan-300' : 'text-[color:rgb(var(--fg-rgb)/0.55)]'}`}>{k}</span>
                    <span key={touched[k] ?? 0} className="bt-bb-value text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.8)] truncate max-w-[55%] text-right">{formatVal(v)}</span>
                  </div>
                );
              }
              const isOpen = openBbGroups.has(prefix);
              return (
                <div key={prefix}>
                  <button onClick={() => toggleBbGroup(prefix)} className="flex items-center gap-1 w-full text-left px-1 py-0.5 rounded hover:bg-[rgb(var(--fg-rgb)/0.04)]">
                    <ChevronDown className="w-2.5 h-2.5 shrink-0 transition-transform duration-150" style={{ color: 'rgb(var(--fg-rgb)/0.35)', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                    <span className="flex-1 text-[9px] font-mono font-semibold text-[color:rgb(var(--fg-rgb)/0.4)]">{prefix}</span>
                    <span className="text-[9px] font-mono text-[color:rgb(var(--fg-rgb)/0.25)]">{keys.length}</span>
                  </button>
                  {isOpen && keys.map((k) => {
                    const v = blackboard[k];
                    return (
                      <div key={k} className={`flex items-center justify-between gap-2 pl-5 pr-2 py-1 rounded ${referenced.has(k) ? 'bg-cyan-500/10 border border-cyan-500/20' : ''}`}>
                        <span className={`text-[10px] font-mono truncate ${referenced.has(k) ? 'text-cyan-300' : 'text-[color:rgb(var(--fg-rgb)/0.55)]'}`}>{k}</span>
                        <span key={touched[k] ?? 0} className="bt-bb-value text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.8)] truncate max-w-[55%] text-right">{formatVal(v)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Node Params ── */}
        <Divider onMouseDown={startResizeBb} />
        <div className="min-h-0 flex flex-col shrink-0" style={{ flexBasis: `${paramPct}%` }}>
          <div className="px-4 py-2.5 border-b border-[rgb(var(--fg-rgb)/0.07)]">
            <span className="text-[9px] font-bold tracking-[0.18em] text-[color:rgb(var(--fg-rgb)/0.4)]">NODE PARAMS</span>
          </div>
          {btHosts.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <Empty>no BT executor nodes</Empty>
            </div>
          ) : (
            <>
              {/* Node selector dropdown */}
              <div className="shrink-0 border-b border-[rgb(var(--fg-rgb)/0.06)] px-2 py-2">
                <select
                  value={selectedParamNode ?? ''}
                  onChange={(e) => { userPickedRef.current = true; setSelectedParamNode(e.target.value || null); }}
                  className="w-full px-2 py-1 rounded text-[10px] font-mono outline-none"
                  style={{ background: 'var(--menu-bg)', border: '1px solid rgb(var(--fg-rgb) / 0.12)', color: 'rgb(var(--fg-rgb) / 0.75)' }}
                >
                  <option value="">— select node —</option>
                  {btHosts.map(({ name }) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </div>
              {/* Params for selected node */}
              <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 space-y-0.5">
                {!hostParams ? (
                  <Empty>select a node above</Empty>
                ) : paramGroups.map(({ prefix, keys }) => {
                  if (keys.length === 1) {
                    const k = keys[0];
                    return (
                      <div key={k} className="flex items-center justify-between gap-2 px-2 py-1 rounded">
                        <span className="text-[10px] font-mono truncate text-[color:rgb(var(--fg-rgb)/0.45)]">{k}</span>
                        <span className="text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.7)] truncate max-w-[55%] text-right">{String(hostParams[k])}</span>
                      </div>
                    );
                  }
                  const isOpen = openParamGroups.has(prefix);
                  return (
                    <div key={prefix}>
                      <button onClick={() => toggleParamGroup(prefix)} className="flex items-center gap-1 w-full text-left px-1 py-0.5 rounded hover:bg-[rgb(var(--fg-rgb)/0.04)]">
                        <ChevronDown className="w-2.5 h-2.5 shrink-0 transition-transform duration-150" style={{ color: 'rgb(var(--fg-rgb)/0.35)', transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
                        <span className="flex-1 text-[9px] font-mono font-semibold text-[color:rgb(var(--fg-rgb)/0.4)]">{prefix}</span>
                        <span className="text-[9px] font-mono text-[color:rgb(var(--fg-rgb)/0.25)]">{keys.length}</span>
                      </button>
                      {isOpen && keys.map((k) => (
                        <div key={k} className="flex items-center justify-between gap-2 pl-5 pr-2 py-1 rounded">
                          <span className="text-[10px] font-mono truncate text-[color:rgb(var(--fg-rgb)/0.45)]">{k}</span>
                          <span className="text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.7)] truncate max-w-[55%] text-right">{String(hostParams[k])}</span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* ── Node Inspector ── */}
        <Divider onMouseDown={startResizeParam} />
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[rgb(var(--fg-rgb)/0.07)]">
            <span className="text-[9px] font-bold tracking-[0.18em] text-[color:rgb(var(--fg-rgb)/0.4)]">NODE INSPECTOR</span>
            {node && (
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-wider ${st.cls}`}>{st.label}</span>
                <button onClick={() => select(null)} className="text-[color:rgb(var(--fg-rgb)/0.4)] hover:text-[color:rgb(var(--fg-rgb))]"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-4">
            {!node ? (
              <div className="h-full flex items-center justify-center">
                <span className="text-[11px] font-mono text-[color:rgb(var(--fg-rgb)/0.3)] text-center">Click a node to inspect its ports</span>
              </div>
            ) : (
              <>
                <div>
                  <div className="text-sm font-bold text-[color:rgb(var(--fg-rgb))] truncate">{node.name}</div>
                  <div className="text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.4)] truncate">{node.type} · {node.category}</div>
                </div>
                <Section title="PORT REMAPPINGS">
                  {inputs.length === 0 && outputs.length === 0 ? (
                    <Empty>no ports</Empty>
                  ) : (
                    <div className="space-y-1">
                      {inputs.map(([port, val]) => <PortRow key={`in-${port}`} dir="in" port={port} val={val} />)}
                      {outputs.map(([port, val]) => <PortRow key={`out-${port}`} dir="out" port={port} val={val} />)}
                    </div>
                  )}
                </Section>
                {node.services.length > 0 && (
                  <Section title="SERVICES">
                    <div className="space-y-1">
                      {node.services.map((svc) => (
                        <div key={svc.id} className="flex items-center justify-between text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.55)]">
                          <span className="truncate">⚙ {svc.name}</span>
                          <span className="text-[color:rgb(var(--fg-rgb)/0.35)]">{svc.tick_ms}ms</span>
                        </div>
                      ))}
                    </div>
                  </Section>
                )}
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

function Divider({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="group relative h-1.5 shrink-0 cursor-row-resize flex items-center justify-center border-y border-[rgb(var(--fg-rgb)/0.1)] hover:bg-[rgb(var(--fg-rgb)/0.06)] transition-colors"
      title="Drag to resize"
    >
      <span className="w-8 h-0.5 rounded-full bg-[rgb(var(--fg-rgb)/0.2)] group-hover:bg-[rgb(var(--fg-rgb)/0.4)] transition-colors" />
    </div>
  );
}

function PortRow({ dir, port, val }: { dir: 'in' | 'out'; port: string; val: string }) {
  const key = bbKey(val);
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono">
      <span className={`px-1.5 py-0.5 rounded shrink-0 ${dir === 'in' ? 'text-sky-300 bg-sky-500/15' : 'text-amber-300 bg-amber-500/15'}`}>{dir}</span>
      <span className="text-[color:rgb(var(--fg-rgb)/0.55)] truncate">{port}</span>
      <span className="text-[color:rgb(var(--fg-rgb)/0.25)]">←</span>
      <span className={`truncate ${key ? 'text-cyan-300' : 'text-[color:rgb(var(--fg-rgb)/0.7)]'}`}>{val}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] font-bold tracking-[0.18em] text-[color:rgb(var(--fg-rgb)/0.35)] mb-1.5">{title}</div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.25)] italic px-1">{children}</div>;
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}
