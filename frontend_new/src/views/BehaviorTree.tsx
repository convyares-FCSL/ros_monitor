import { Workflow } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useBtSocket } from '../hooks/useBtSocket';
import { useBtStore } from '../store/btStore';
import { BTCanvas } from '../bt/BTCanvas';
import { BTInspector } from '../bt/BTInspector';

const CONN_STYLE = {
  connecting: { label: 'CONNECTING', cls: 'bg-amber-400' },
  connected: { label: 'CONNECTED', cls: 'bg-green-400 shadow-[0_0_8px_#4ade80]' },
  disconnected: { label: 'DISCONNECTED', cls: 'bg-red-500' },
};

export function BehaviorTree() {
  const { theme } = useTheme();
  const conn = useBtSocket();
  const blueprint = useBtStore((s) => s.blueprint);
  const nodeCount = blueprint?.nodes.length ?? 0;
  const c = CONN_STYLE[conn];

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: theme.bg }}>
      <BTCanvas />

      {/* Header overlay */}
      <header className="absolute top-3 left-3 z-20 flex items-center gap-3 px-4 py-2.5 rounded-2xl backdrop-blur-2xl border"
        style={{ background: 'var(--menu-bg, rgba(15,23,42,0.85))', borderColor: 'rgba(255,255,255,0.08)' }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${theme.nodeColorHex}15`, border: `1px solid ${theme.nodeColorHex}4d` }}>
          <Workflow className="w-4 h-4" style={{ color: theme.nodeColorHex }} strokeWidth={2.5} />
        </div>
        <div>
          <div className="text-sm font-extrabold tracking-wide leading-none text-white">
            Behavior<span style={{ color: theme.nodeColorHex }} className="font-light">.Tree</span>
          </div>
          <div className="text-[9px] font-mono tracking-wide leading-none mt-1 text-white/45">
            {blueprint ? `${blueprint.tree_id} · ${nodeCount} nodes` : 'no tree loaded'}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-2 pl-3 border-l border-white/10">
          <span className={`w-2 h-2 rounded-full ${c.cls} ${conn !== 'disconnected' ? 'animate-pulse' : ''}`} />
          <span className="text-[10px] font-bold tracking-widest text-white/60">{c.label}</span>
        </div>
      </header>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-20 flex gap-4 px-4 py-2 rounded-xl backdrop-blur-2xl border text-[10px] font-mono text-white/55"
        style={{ background: 'var(--menu-bg, rgba(15,23,42,0.85))', borderColor: 'rgba(255,255,255,0.08)' }}>
        <Legend color="#475569" label="IDLE" />
        <Legend color="#06b6d4" label="RUNNING" />
        <Legend color="#10b981" label="SUCCESS" />
        <Legend color="#ef4444" label="FAILURE" />
      </div>

      <div className="absolute bottom-3 right-[21.5rem] z-20 text-[9px] font-mono text-white/30 pointer-events-none">
        scroll = zoom · drag = pan · click a node to inspect
      </div>

      <BTInspector />
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
