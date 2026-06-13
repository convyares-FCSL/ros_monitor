import { Crosshair, Pause, Play, Minimize2, Maximize2, FlaskConical, type LucideIcon } from 'lucide-react';
import { useBtStore } from '../store/btStore';

interface BTControlsProps {
  onRecenter: () => void;
  paused: boolean;
  onTogglePause: () => void;
  simMode: boolean;
  onToggleSim: () => void;
}

// Bottom-left controls overlay, mirroring ROS Introspection: recenter the view,
// pause the live stream, toggle the client-side simulator, and expand/collapse.
export function BTControls({ onRecenter, paused, onTogglePause, simMode, onToggleSim }: BTControlsProps) {
  const collapseAll = useBtStore((s) => s.collapseAll);
  const expandAll = useBtStore((s) => s.expandAll);

  return (
    <div className="absolute left-3 bottom-3 z-20 flex items-center gap-1.5 px-2 py-2 rounded-2xl backdrop-blur-2xl border"
      style={{ background: 'var(--menu-bg, rgba(15,23,42,0.85))', borderColor: 'rgba(255,255,255,0.08)' }}>
      <CtrlBtn icon={Crosshair} label="Recenter" onClick={onRecenter} />
      <CtrlBtn icon={paused ? Play : Pause} label={paused ? 'Resume' : 'Pause'} onClick={onTogglePause} active={paused} />
      <CtrlBtn icon={FlaskConical} label="Sim" onClick={onToggleSim} active={simMode} />
      <div className="w-px h-6 bg-white/10 mx-0.5" />
      <CtrlBtn icon={Minimize2} label="Collapse" onClick={collapseAll} />
      <CtrlBtn icon={Maximize2} label="Expand" onClick={expandAll} />
    </div>
  );
}

function CtrlBtn({ icon: Icon, label, onClick, active }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} title={label}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border transition-all ${active ? 'border-cyan-500/40 bg-cyan-500/15' : 'border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07]'}`}>
      <Icon className={`w-3.5 h-3.5 ${active ? 'text-cyan-300' : 'text-white/60'}`} />
      <span className={`text-[10px] font-semibold ${active ? 'text-cyan-300' : 'text-white/60'}`}>{label}</span>
    </button>
  );
}
