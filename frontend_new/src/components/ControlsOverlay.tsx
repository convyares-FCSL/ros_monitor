import { RotateCcw, MousePointer, Move3D, ZoomIn, Pause, Play, Ghost } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import type { DeadEndMode } from '../types';

interface ControlsOverlayProps {
  open: boolean;
  onResetCamera: () => void;
  onZoomExtents: () => void;
  paused: boolean;
  onTogglePause: () => void;
  deadEndMode: DeadEndMode;
  deadEndCount: number;
  onCycleDeadEnd: () => void;
}

const DEAD_END_LABELS: Record<DeadEndMode, string> = {
  hidden: 'Hidden',
  dimmed: 'Dimmed',
  shown: 'Shown',
};

export function ControlsOverlay({
  open, onResetCamera, onZoomExtents, paused, onTogglePause, deadEndMode, deadEndCount, onCycleDeadEnd,
}: ControlsOverlayProps) {
  const { theme } = useTheme();

  return (
    <div className={`absolute left-3 bottom-3 z-30 flex flex-col gap-2 w-72 p-3 backdrop-blur-2xl rounded-2xl
      transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
      ${open ? 'translate-x-0' : '-translate-x-[calc(100%+12px)]'}`}
      style={{ background: 'var(--menu-bg)', border: `1px solid ${theme.panelBorder}` }}>
      <div className="space-y-1.5">
        <div className="text-[9px] font-bold uppercase tracking-widest text-[color:rgb(var(--fg-rgb)/0.3)] pb-1 border-b border-[rgb(var(--fg-rgb)/0.05)]">
          Camera
        </div>
        <Hint icon={<MousePointer className="w-3 h-3" />} label="Left drag — orbit" />
        <Hint icon={<Move3D className="w-3 h-3" />} label="Right drag — pan" />
        <Hint icon={<ZoomIn className="w-3 h-3" />} label="Scroll — zoom" />
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Btn onClick={onResetCamera} icon={<RotateCcw className="w-3 h-3" />} label="Recenter" panelBg={theme.panelBg} panelBorder={theme.panelBorder} />
        <Btn onClick={onZoomExtents} icon={<ZoomIn className="w-3 h-3" />}
          label="Zoom Extents"
          panelBg={theme.panelBg} panelBorder={theme.panelBorder} />
        <Btn onClick={onTogglePause} icon={paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
          label={paused ? 'Resume' : 'Pause View'}
          active={paused} activeColor="amber" panelBg={theme.panelBg} panelBorder={theme.panelBorder} />
        <Btn onClick={onCycleDeadEnd} icon={<Ghost className="w-3 h-3" />}
          label={`Dead-ends: ${DEAD_END_LABELS[deadEndMode]} (${deadEndCount})`}
          active={deadEndMode !== 'shown'} activeColor="red" panelBg={theme.panelBg} panelBorder={theme.panelBorder} />
      </div>
    </div>
  );
}

function Hint({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-[color:rgb(var(--fg-rgb)/0.35)]">
      <span className="text-[color:rgb(var(--fg-rgb)/0.25)]">{icon}</span>{label}
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
    red: 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20',
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
      className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[10px] font-semibold transition-all backdrop-blur-xl text-[color:rgb(var(--fg-rgb)/0.7)] hover:text-[color:rgb(var(--fg-rgb))] hover:bg-slate-300/[0.14]"
      style={{ background: 'rgba(148, 163, 184, 0.12)', border: '1px solid rgba(255,255,255,0.12)' }}>
      {icon}{label}
    </button>
  );
}
