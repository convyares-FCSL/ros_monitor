import { Activity, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useUIStore } from '../store/uiStore';
import { ThemeSwitcher } from './ThemeSwitcher';

interface TopBarProps {
  title: string;
  icon?: LucideIcon;
  /** Page-specific content (stats, selectors, status) shown in the center. */
  children?: React.ReactNode;
  onOpenSettings?: () => void;
  onResetSettings?: () => void;
}

// Shared header template used by every page, so the chrome is consistent across
// ROS Introspection, Behavior Tree, and the rest. Each page supplies its own
// title/icon and optional center content.
export function TopBar({ title, icon: Icon = Activity, children, onOpenSettings, onResetSettings }: TopBarProps) {
  const { theme } = useTheme();
  return (
    <header
      className="absolute top-0 left-0 right-0 h-14 z-30 flex items-center px-5 backdrop-blur-xl border-b border-white/[0.07]"
      style={{ background: `var(--menu-bg, ${theme.headerBg})`, color: 'var(--menu-text, #fff)' }}
    >
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `${theme.nodeColorHex}15`, border: `1px solid ${theme.nodeColorHex}4d` }}>
          <Icon className="w-4 h-4" style={{ color: theme.nodeColorHex }} strokeWidth={2.5} />
        </div>
        <div>
          <div className="text-sm font-extrabold tracking-wide leading-none" style={{ color: 'var(--menu-text, #fff)' }}>{title}</div>
          <div className="text-[9px] font-semibold tracking-widest uppercase leading-none mt-0.5"
            style={{ color: 'var(--menu-text-muted, rgba(255,255,255,0.55))' }}>
            ROS 2 Diagnostic Platform
          </div>
        </div>
        <ModeBadge />
      </div>

      <div className="flex-1 flex items-center justify-center gap-6 min-w-0 px-4">
        {children}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {onOpenSettings && (
          <button onClick={onOpenSettings}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08] transition-all">
            <SlidersHorizontal className="w-3.5 h-3.5" style={{ color: 'var(--menu-text-muted, rgba(255,255,255,0.55))' }} />
          </button>
        )}
        <ThemeSwitcher onResetSettings={onResetSettings} />
      </div>
    </header>
  );
}

// Shows the bridge run mode (real / demo / no-ROS) so it's always clear what
// data you're looking at.
function ModeBadge() {
  const mode = useUIStore((s) => s.bridgeMode);
  if (!mode) return null;
  const insp = mode.introspection === 'live'
    ? { t: 'LIVE', c: '#10b981' }
    : { t: mode.no_ros ? 'NO-ROS' : 'DEMO', c: '#f59e0b' };
  const bt = mode.behavior_tree === 'real'
    ? { t: 'REAL', c: '#10b981' }
    : mode.behavior_tree === 'demo'
      ? { t: 'DEMO', c: '#06b6d4' }
      : mode.behavior_tree === 'auto'
        ? { t: 'AUTO', c: '#f59e0b' }
        : { t: 'OFF', c: '#6b7280' };
  return (
    <div className="hidden lg:flex items-center gap-2 ml-1 pl-3 border-l border-white/10"
      title="Bridge data mode — INSP = 3D introspection, BT = behavior tree">
      <Chip label="INSP" value={insp.t} color={insp.c} />
      <Chip label="BT" value={bt.t} color={bt.c} />
    </div>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span className="flex items-center gap-1 text-[9px] font-mono">
      <span className="text-white/35">{label}</span>
      <span className="px-1.5 py-0.5 rounded font-bold" style={{ color, background: `${color}22` }}>{value}</span>
    </span>
  );
}
