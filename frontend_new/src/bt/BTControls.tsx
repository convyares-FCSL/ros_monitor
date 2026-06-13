import { RotateCcw, MousePointer, Move3D, ZoomIn, Pause, Play, Minimize2, Maximize2 } from 'lucide-react';
import { useBtStore } from '../store/btStore';
import { useTheme } from '../hooks/useTheme';

interface BTControlsProps {
  open: boolean;
  onResetView: () => void;
  onZoomExtents: () => void;
  paused: boolean;
  onTogglePause: () => void;
}

// Bottom-left controls overlay, mirroring ROS Introspection: recenter the view,
// pause the live stream, zoom to extents, and expand/collapse.
export function BTControls({ open, onResetView, onZoomExtents, paused, onTogglePause }: BTControlsProps) {
  const { theme } = useTheme();
  const blueprint = useBtStore((s) => s.activeTreeId ? s.trees[s.activeTreeId]?.blueprint : undefined);
  const collapsedCount = useBtStore((s) => s.collapsed.size);
  const collapseAll = useBtStore((s) => s.collapseAll);
  const expandAll = useBtStore((s) => s.expandAll);
  const collapsibleCount = (blueprint?.nodes ?? []).filter((n) => n.children.length > 0 && n.id !== blueprint?.root_id).length;
  const allCollapsed = collapsibleCount > 0 && collapsedCount >= collapsibleCount;
  const toggleCollapseAll = () => {
    if (allCollapsed) {
      expandAll();
    } else {
      collapseAll();
    }
  };

  return (
    <div
      className={`absolute left-3 bottom-3 z-30 flex flex-col gap-2 w-72 p-3 backdrop-blur-2xl rounded-2xl
      transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
      ${open ? 'translate-x-0' : '-translate-x-[calc(100%+12px)]'}`}
      style={{ background: 'var(--menu-bg)', border: `1px solid ${theme.panelBorder}` }}
    >
      <div className="space-y-1.5">
        <div className="text-[9px] font-bold uppercase tracking-widest text-white/30 pb-1 border-b border-white/[0.05]">
          Camera
        </div>
        <Hint icon={<MousePointer className="w-3 h-3" />} label="Drag — pan" />
        <Hint icon={<Move3D className="w-3 h-3" />} label="Click node — inspect" />
        <Hint icon={<ZoomIn className="w-3 h-3" />} label="Scroll — zoom" />
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Btn onClick={onResetView} icon={<RotateCcw className="w-3 h-3" />} label="Reset View" panelBg={theme.panelBg} panelBorder={theme.panelBorder} />
        <Btn onClick={onZoomExtents} icon={<ZoomIn className="w-3 h-3" />}
          label="Zoom Extents"
          panelBg={theme.panelBg} panelBorder={theme.panelBorder} />
        <Btn onClick={onTogglePause} icon={paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
          label={paused ? 'Resume' : 'Pause View'}
          active={paused} activeColor="amber" panelBg={theme.panelBg} panelBorder={theme.panelBorder} />
        <Btn
          onClick={toggleCollapseAll}
          icon={allCollapsed ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
          label={allCollapsed ? 'Expand All' : 'Collapse All'}
          active={collapsedCount > 0}
          activeColor="violet"
          panelBg={theme.panelBg}
          panelBorder={theme.panelBorder}
        />
      </div>
    </div>
  );
}

function Hint({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-white/35">
      <span className="text-white/25">{icon}</span>{label}
    </div>
  );
}

function Btn({ onClick, icon, label, active, activeColor, panelBg, panelBorder }: {
  onClick: () => void; icon: React.ReactNode; label: string; active?: boolean; activeColor?: string;
  panelBg: string; panelBorder: string;
}) {
  const colorMap: Record<string, string> = {
    cyan: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/20',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20',
    violet: 'bg-violet-500/10 border-violet-500/30 text-violet-300 hover:bg-violet-500/20',
  };

  if (active && activeColor) {
    return (
      <button onClick={onClick}
        className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[10px] font-semibold transition-all backdrop-blur-xl border ${colorMap[activeColor]}`}>
        {icon}{label}
      </button>
    );
  }

  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[10px] font-semibold transition-all backdrop-blur-xl text-white/70 hover:text-white hover:bg-slate-300/[0.14]"
      style={{ background: 'rgba(148, 163, 184, 0.12)', border: '1px solid rgba(255,255,255,0.12)' }}>
      {icon}{label}
    </button>
  );
}
