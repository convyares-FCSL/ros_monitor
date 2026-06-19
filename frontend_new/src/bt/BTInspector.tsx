import { useMemo, useState, useRef, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
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

// Pull the blackboard key out of a port value like "{nav_result}".
function bbKey(value: string): string | null {
  const m = /^\{(.+)\}$/.exec(value.trim());
  return m ? m[1] : null;
}

const PANEL_BG = 'var(--menu-bg, rgba(15,23,42,0.85))';

export function BTInspector() {
  const [open, setOpen] = useState(true);
  // Resizable split between the blackboard (top) and node inspector (bottom).
  const [topPct, setTopPct] = useState(50);
  const asideRef = useRef<HTMLElement>(null);
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const el = asideRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      setTopPct(Math.min(85, Math.max(15, pct)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'row-resize';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);
  const selectedId = useBtStore((s) => s.selectedNodeId);
  const node = useNodeDef(selectedId ?? -1);
  const status = useNodeStatus(selectedId ?? -1);
  const blackboard = useActiveBlackboard();
  const touched = useActiveBlackboardTouched();
  const blueprint = useActiveBlueprint();
  const select = useBtStore((s) => s.select);

  // Blackboard keys the selected node's ports remap, so we can highlight them.
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

  const nodeParams = useRosGraphStore((s) => s.nodeParams);

  // Find ROS nodes that host a BT executor (declared groot_port parameter).
  const btHostParams = useMemo(() => {
    const hosts: Array<{ name: string; params: Record<string, unknown> }> = [];
    nodeParams.forEach((params, name) => {
      if ('groot_port' in params || 'groot2_port' in params) {
        hosts.push({ name, params });
      }
    });
    return hosts;
  }, [nodeParams]);

  const bbEntries = Object.entries(blackboard);
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
        {/* --- Top: Blackboard (always shown, tree-wide) --- */}
        <div className="min-h-0 flex flex-col shrink-0" style={{ flexBasis: `${topPct}%` }}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[rgb(var(--fg-rgb)/0.07)]">
            <span className="text-[9px] font-bold tracking-[0.18em] text-[color:rgb(var(--fg-rgb)/0.4)]">BLACKBOARD</span>
            {blueprint && <span className="text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.35)] truncate max-w-[55%]">{blueprint.tree_id}</span>}
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-2 space-y-0.5">
            {bbEntries.length === 0 ? (
              <Empty>no blackboard data</Empty>
            ) : (
              bbEntries.map(([k, v]) => (
                <div key={k} className={`flex items-center justify-between gap-2 px-2 py-1 rounded ${referenced.has(k) ? 'bg-cyan-500/10 border border-cyan-500/20' : ''}`}>
                  <span className={`text-[10px] font-mono truncate ${referenced.has(k) ? 'text-cyan-300' : 'text-[color:rgb(var(--fg-rgb)/0.55)]'}`}>{k}</span>
                  <span key={touched[k] ?? 0} className="bt-bb-value text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.8)] truncate max-w-[55%] text-right">
                    {formatVal(v)}
                  </span>
                </div>
              ))
            )}

            {btHostParams.map(({ name, params }) => (
              <div key={name} className="mt-2 pt-2 border-t border-[rgb(var(--fg-rgb)/0.07)]">
                <div className="text-[9px] font-bold tracking-[0.15em] text-[color:rgb(var(--fg-rgb)/0.25)] px-2 pb-1">
                  NODE PARAMS · {name}
                </div>
                {Object.entries(params).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-2 px-2 py-0.5 rounded">
                    <span className="text-[10px] font-mono truncate text-[color:rgb(var(--fg-rgb)/0.4)]">{k}</span>
                    <span className="text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.65)] truncate max-w-[55%] text-right">{String(v)}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Draggable divider */}
        <div onMouseDown={startResize}
          className="group relative h-1.5 shrink-0 cursor-row-resize flex items-center justify-center border-y border-[rgb(var(--fg-rgb)/0.1)] hover:bg-[rgb(var(--fg-rgb)/0.06)] transition-colors"
          title="Drag to resize">
          <span className="w-8 h-0.5 rounded-full bg-[rgb(var(--fg-rgb)/0.2)] group-hover:bg-[rgb(var(--fg-rgb)/0.4)] transition-colors" />
        </div>

        {/* --- Bottom: Node inspector (selected item) --- */}
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
