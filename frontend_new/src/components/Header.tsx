import { Cpu, Radio, Server, Wrench, Wifi, WifiOff, Gauge } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import type { ConnectionStatus, GraphUpdate } from '../types';

interface RosHeaderContentProps {
  status: ConnectionStatus;
  graph: GraphUpdate | null;
  bandwidth: number;
}

function formatBandwidth(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1048576) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / 1048576).toFixed(2)} MB/s`;
}

const STATUS_CONFIG = {
  connecting: { label: 'CONNECTING', dot: 'bg-amber-400 shadow-[0_0_8px_#fbbf24]', text: 'text-amber-300', icon: Wifi },
  connected: { label: 'CONNECTED', dot: 'bg-green-400 shadow-[0_0_8px_#4ade80]', text: 'text-green-400', icon: Wifi },
  disconnected: { label: 'DISCONNECTED', dot: 'bg-red-500', text: 'text-red-400', icon: WifiOff },
};

// ROS-specific top-bar content (graph stats + connection), rendered inside the
// shared TopBar's center zone.
export function RosHeaderContent({ status, graph, bandwidth }: RosHeaderContentProps) {
  const cfg = STATUS_CONFIG[status];
  const StatusIcon = cfg.icon;
  const { theme } = useTheme();

  return (
    <>
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

      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08]">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot} ${status !== 'disconnected' ? 'animate-pulse' : ''}`} />
        <StatusIcon className={`w-3 h-3 ${cfg.text}`} />
        <span className={`text-[10px] font-bold tracking-widest ${cfg.text}`}>{cfg.label}</span>
      </div>
    </>
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
