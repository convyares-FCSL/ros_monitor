import { useRef, useState } from 'react';
import { Workflow, ChevronDown, GitBranch } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useBtSocket, type BtConnStatus } from '../hooks/useBtSocket';
import { useBtStore, useTreeIds, useActiveBlueprint } from '../store/btStore';
import { TopBar } from '../components/TopBar';
import { BTCanvas, type BTCanvasHandle } from '../bt/BTCanvas';
import { BTInspector } from '../bt/BTInspector';
import { TreeExplorer } from '../bt/TreeExplorer';
import { BTControls } from '../bt/BTControls';

const CONN_STYLE: Record<BtConnStatus, { label: string; cls: string }> = {
  connecting: { label: 'CONNECTING', cls: 'bg-amber-400' },
  connected: { label: 'CONNECTED', cls: 'bg-green-400 shadow-[0_0_8px_#4ade80]' },
  disconnected: { label: 'DISCONNECTED', cls: 'bg-red-500' },
  simulating: { label: 'SIMULATING', cls: 'bg-sky-400 shadow-[0_0_8px_#38bdf8]' },
};

export function BehaviorTree() {
  const { theme } = useTheme();
  const [paused, setPaused] = useState(false);
  const [simMode, setSimMode] = useState(false);
  const conn = useBtSocket(paused, simMode);
  const canvasRef = useRef<BTCanvasHandle>(null);

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: theme.bg }}>
      <BTCanvas ref={canvasRef} />

      <TopBar title="Behavior Tree" icon={Workflow}>
        <TreeSelector />
        <ConnBadge conn={conn} />
      </TopBar>

      {/* Left: tree explorer (top) + controls (bottom) */}
      <TreeExplorer onFocusNode={(id) => canvasRef.current?.focusNode(id)} />
      <BTControls
        onRecenter={() => canvasRef.current?.recenter()}
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        simMode={simMode}
        onToggleSim={() => setSimMode((s) => !s)}
      />

      {/* Right: blackboard + node inspector */}
      <BTInspector />

      {/* Legend */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex gap-4 px-4 py-2 rounded-xl backdrop-blur-2xl border text-[10px] font-mono text-white/55"
        style={{ background: 'var(--menu-bg, rgba(15,23,42,0.85))', borderColor: 'rgba(255,255,255,0.08)' }}>
        <Legend color="#475569" label="IDLE" />
        <Legend color="#06b6d4" label="RUNNING" />
        <Legend color="#10b981" label="SUCCESS" />
        <Legend color="#ef4444" label="FAILURE" />
      </div>
    </div>
  );
}

// Quick tree switcher in the header (the explorer offers the full browse).
function TreeSelector() {
  const treeIds = useTreeIds();
  const activeTreeId = useBtStore((s) => s.activeTreeId);
  const setActiveTree = useBtStore((s) => s.setActiveTree);
  const blueprint = useActiveBlueprint();
  const [open, setOpen] = useState(false);

  if (treeIds.length === 0) {
    return <span className="text-[11px] font-mono text-white/35">no tree loaded</span>;
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-all">
        <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
        <span className="text-[12px] font-semibold text-white">{activeTreeId}</span>
        {blueprint && <span className="text-[10px] font-mono text-white/40">{blueprint.nodes.length} nodes</span>}
        {treeIds.length > 1 && <ChevronDown className="w-3.5 h-3.5 text-white/40" />}
      </button>
      {open && treeIds.length > 1 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-2 z-50 min-w-[200px] py-1.5 rounded-lg backdrop-blur-xl border border-white/[0.1] shadow-xl"
            style={{ background: 'var(--menu-bg-solid, rgba(15,23,42,0.95))' }}>
            {treeIds.map((id) => (
              <button key={id} onClick={() => { setActiveTree(id); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.05] transition-colors"
                style={{ color: id === activeTreeId ? '#fff' : 'rgba(255,255,255,0.6)' }}>
                <GitBranch className="w-3.5 h-3.5" style={{ color: id === activeTreeId ? '#06b6d4' : 'currentColor' }} />
                <span className="text-[12px] font-semibold">{id}</span>
                {id === activeTreeId && <span className="ml-auto text-[9px] text-white/35">active</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ConnBadge({ conn }: { conn: BtConnStatus }) {
  const c = CONN_STYLE[conn];
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08]">
      <span className={`w-2 h-2 rounded-full ${c.cls} ${conn !== 'disconnected' ? 'animate-pulse' : ''}`} />
      <span className="text-[10px] font-bold tracking-widest text-white/60">{c.label}</span>
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
