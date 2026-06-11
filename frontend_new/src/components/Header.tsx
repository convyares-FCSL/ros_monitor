import { useState } from 'react';
import { Activity, Cpu, Radio, Server, Wrench, Wifi, WifiOff, Play, Gauge, Palette, SlidersHorizontal, RotateCcw } from 'lucide-react';
import { useTheme, THEMES, type ThemeId } from '../hooks/useTheme';
import type { ConnectionStatus, GraphUpdate } from '../types';

interface HeaderProps {
  status: ConnectionStatus;
  graph: GraphUpdate | null;
  bandwidth: number;
  onOpenSettings?: () => void;
  onResetSettings?: () => void;
}

function formatBandwidth(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1048576) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / 1048576).toFixed(2)} MB/s`;
}

const STATUS_CONFIG = {
  connected: { label: 'CONNECTED', dot: 'bg-green-400 shadow-[0_0_8px_#4ade80]', text: 'text-green-400', icon: Wifi },
  simulating: { label: 'SIMULATING', dot: 'bg-sky-400 shadow-[0_0_8px_#38bdf8]', text: 'text-sky-400', icon: Play },
  disconnected: { label: 'DISCONNECTED', dot: 'bg-red-500', text: 'text-red-400', icon: WifiOff },
};

const PRESET_IDS = Object.keys(THEMES) as (Exclude<ThemeId, 'custom'>)[];

export function Header({ status, graph, bandwidth, onOpenSettings, onResetSettings }: HeaderProps) {
  const cfg = STATUS_CONFIG[status];
  const StatusIcon = cfg.icon;
  const { themeId, setThemeId, theme } = useTheme();
  const [themeOpen, setThemeOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 h-14 z-30 flex items-center justify-between px-5
      backdrop-blur-xl border-b border-white/[0.07]"
      style={{ background: 'var(--menu-bg)', color: 'var(--menu-text)' }}>

      <div className="flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `${theme.nodeColorHex}15`, border: `1px solid ${theme.nodeColorHex}4d` }}>
          <Activity className="w-4 h-4" style={{ color: theme.nodeColorHex }} strokeWidth={2.5} />
        </div>
        <div>
          <div className="text-sm font-extrabold tracking-wide leading-none" style={{ color: 'var(--menu-text)' }}>
            3D<span style={{ color: theme.nodeColorHex }} className="font-light">.Pulse</span>
          </div>
          <div className="text-[9px] font-semibold tracking-widest uppercase leading-none mt-0.5" style={{ color: 'var(--menu-text-muted)' }}>
            ROS 2 Network Visualizer
          </div>
        </div>
      </div>

      <div className="hidden md:flex items-center gap-6">
        <Stat icon={<Cpu className="w-3.5 h-3.5" />} label="Nodes" value={graph?.nodes.length ?? 0} colorHex={theme.nodeColorHex} />
        <Stat icon={<Radio className="w-3.5 h-3.5" />} label="Topics" value={graph?.topics.length ?? 0} colorHex={theme.topicColorHex} />
        <Stat icon={<Server className="w-3.5 h-3.5" />} label="Services" value={graph?.services.length ?? 0} colorHex={theme.serviceColorHex} />
        <Stat icon={<Wrench className="w-3.5 h-3.5" />} label="Actions" value={graph?.actions.length ?? 0} colorHex={theme.actionColorHex} />
        <div className="flex items-center gap-2">
          <Gauge className="w-3.5 h-3.5" style={{ color: 'var(--menu-text-muted)' }} />
          <div>
            <div className="text-xs font-bold font-mono leading-none" style={{ color: 'var(--menu-text-muted)' }}>{formatBandwidth(bandwidth)}</div>
            <div className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'var(--menu-text-dim)' }}>Bandwidth</div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Scene Settings */}
        <button onClick={onOpenSettings}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-all">
          <SlidersHorizontal className="w-3.5 h-3.5" style={{ color: 'var(--menu-text-muted)' }} />
        </button>

        {/* Theme Switcher */}
        <div className="relative">
          <button onClick={() => setThemeOpen(o => !o)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-all">
            <Palette className="w-3.5 h-3.5" style={{ color: 'var(--menu-text-muted)' }} />
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: theme.accentHex }} />
          </button>
          {themeOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setThemeOpen(false)} />
              <div className="absolute right-0 top-full mt-2 z-50 min-w-[180px] py-1.5 rounded-lg backdrop-blur-xl border border-white/[0.1] shadow-xl" style={{ background: 'var(--menu-bg-solid, rgba(15,23,42,0.95))' }}>
                {PRESET_IDS.map(id => (
                  <button key={id} onClick={() => { setThemeId(id); setThemeOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.05] transition-colors"
                    style={{ color: id === themeId ? 'var(--menu-text)' : 'var(--menu-text-muted)' }}>
                    <span className="w-3 h-3 rounded-full" style={{ background: THEMES[id].accentHex }} />
                    <span className="text-[11px] font-semibold">{THEMES[id].label}</span>
                    {id === themeId && <span className="ml-auto text-[9px]" style={{ color: 'var(--menu-text-dim)' }}>active</span>}
                  </button>
                ))}
                <div className="border-t border-white/[0.08] mt-1 pt-1">
                  <button onClick={() => {
                    setThemeId('midnight');
                    onResetSettings?.();
                    setThemeOpen(false);
                  }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/[0.05] transition-colors" style={{ color: 'var(--menu-text-muted)' }}>
                    <RotateCcw className="w-3 h-3" />
                    <span className="text-[11px] font-semibold">Reset to Defaults</span>
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Connection Status */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08]">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot} ${status !== 'disconnected' ? 'animate-pulse' : ''}`} />
          <StatusIcon className={`w-3 h-3 ${cfg.text}`} />
          <span className={`text-[10px] font-bold tracking-widest ${cfg.text}`}>{cfg.label}</span>
        </div>
      </div>
    </header>
  );
}

function Stat({ icon, label, value, colorHex }: { icon: React.ReactNode; label: string; value: number; colorHex: string }) {
  return (
    <div className="flex items-center gap-2">
      <span style={{ color: colorHex }} className="opacity-70">{icon}</span>
      <div>
        <div className="text-sm font-bold font-mono leading-none" style={{ color: colorHex }}>{value}</div>
        <div className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: 'var(--menu-text-dim)' }}>{label}</div>
      </div>
    </div>
  );
}
