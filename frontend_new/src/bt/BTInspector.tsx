import { useMemo } from 'react';
import { X } from 'lucide-react';
import { useBtStore } from '../store/btStore';
import type { NodeStatus } from './types';

const STATUS_STYLE: Record<NodeStatus, { label: string; cls: string }> = {
  IDLE: { label: 'IDLE', cls: 'text-white/50 bg-white/5' },
  RUNNING: { label: 'RUNNING', cls: 'text-cyan-300 bg-cyan-500/15' },
  SUCCESS: { label: 'SUCCESS', cls: 'text-emerald-300 bg-emerald-500/15' },
  FAILURE: { label: 'FAILURE', cls: 'text-red-300 bg-red-500/15' },
};

// Pull the blackboard key out of a port value like "{nav_result}".
function bbKey(value: string): string | null {
  const m = /^\{(.+)\}$/.exec(value.trim());
  return m ? m[1] : null;
}

export function BTInspector() {
  const selectedId = useBtStore((s) => s.selectedNodeId);
  const node = useBtStore((s) => (selectedId != null ? s.nodesById.get(selectedId) : undefined));
  const status = useBtStore((s) => (selectedId != null ? s.statusById[selectedId] : undefined));
  const blackboard = useBtStore((s) => s.blackboard);
  const touched = useBtStore((s) => s.blackboardTouched);
  const select = useBtStore((s) => s.select);

  // Blackboard keys this node's ports remap, so we can highlight them.
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

  if (!node) {
    return (
      <aside className="absolute right-3 top-3 bottom-3 w-80 z-20 rounded-2xl backdrop-blur-2xl border flex items-center justify-center"
        style={{ background: 'var(--menu-bg, rgba(15,23,42,0.85))', borderColor: 'rgba(255,255,255,0.08)' }}>
        <div className="text-[11px] font-mono text-white/35 px-6 text-center">Select a node to inspect its ports and blackboard</div>
      </aside>
    );
  }

  const st = STATUS_STYLE[status ?? 'IDLE'];
  const inputs = Object.entries(node.ports.input ?? {});
  const outputs = Object.entries(node.ports.output ?? {});
  const bbEntries = Object.entries(blackboard);

  return (
    <aside className="absolute right-3 top-3 bottom-3 w-80 z-20 rounded-2xl backdrop-blur-2xl border flex flex-col overflow-hidden"
      style={{ background: 'var(--menu-bg, rgba(15,23,42,0.85))', borderColor: 'rgba(255,255,255,0.08)' }}>

      <div className="flex items-start justify-between px-4 py-3 border-b border-white/[0.07]">
        <div className="min-w-0">
          <div className="text-sm font-bold text-white truncate">{node.name}</div>
          <div className="text-[10px] font-mono text-white/40 truncate">{node.type} · {node.category}</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`px-2 py-0.5 rounded text-[9px] font-bold tracking-wider ${st.cls}`}>{st.label}</span>
          <button onClick={() => select(null)} className="text-white/40 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-3 space-y-4">
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

        <Section title="BLACKBOARD">
          {bbEntries.length === 0 ? (
            <Empty>no blackboard data</Empty>
          ) : (
            <div className="space-y-0.5">
              {bbEntries.map(([k, v]) => (
                <div key={k} className={`flex items-center justify-between gap-2 px-2 py-1 rounded ${referenced.has(k) ? 'bg-cyan-500/10 border border-cyan-500/20' : ''}`}>
                  <span className={`text-[10px] font-mono truncate ${referenced.has(k) ? 'text-cyan-300' : 'text-white/55'}`}>{k}</span>
                  {/* keyed by touch time so the flash animation replays on change */}
                  <span key={touched[k] ?? 0} className="bt-bb-value text-[10px] font-mono text-white/80 truncate max-w-[55%] text-right">
                    {formatVal(v)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </aside>
  );
}

function PortRow({ dir, port, val }: { dir: 'in' | 'out'; port: string; val: string }) {
  const key = bbKey(val);
  return (
    <div className="flex items-center gap-2 text-[10px] font-mono">
      <span className={`px-1.5 py-0.5 rounded shrink-0 ${dir === 'in' ? 'text-sky-300 bg-sky-500/15' : 'text-amber-300 bg-amber-500/15'}`}>{dir}</span>
      <span className="text-white/55 truncate">{port}</span>
      <span className="text-white/25">←</span>
      <span className={`truncate ${key ? 'text-cyan-300' : 'text-white/70'}`}>{val}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] font-bold tracking-[0.18em] text-white/35 mb-1.5">{title}</div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-mono text-white/25 italic">{children}</div>;
}

function formatVal(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}
