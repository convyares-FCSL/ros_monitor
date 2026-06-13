import { useState } from 'react';
import { Activity, ChevronLeft, ChevronRight } from 'lucide-react';
import { ROUTES } from '../router';
import { useTheme } from '../hooks/useTheme';

interface NavSidebarProps {
  activePath: string;
  onNavigate: (path: string) => void;
}

// Persistent left navigation rail. Items render straight off the ROUTES
// registry, so adding a page is a one-line change in router.tsx.
export function NavSidebar({ activePath, onNavigate }: NavSidebarProps) {
  const { theme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <nav
      className="relative h-full flex flex-col shrink-0 backdrop-blur-xl border-r transition-[width] duration-200"
      style={{ width: collapsed ? 64 : 224, background: `var(--menu-bg, ${theme.panelBg})`, borderColor: theme.panelBorder }}
    >
      {/* Brand */}
      <div className="h-14 flex items-center gap-3 px-4 border-b shrink-0" style={{ borderColor: theme.panelBorder }}>
        <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: `${theme.nodeColorHex}15`, border: `1px solid ${theme.nodeColorHex}4d` }}>
          <Activity className="w-4 h-4" style={{ color: theme.nodeColorHex }} strokeWidth={2.5} />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <div className="text-sm font-extrabold tracking-wide leading-none text-[color:rgb(var(--fg-rgb))] whitespace-nowrap">
              ROS<span style={{ color: theme.nodeColorHex }} className="font-light">.Control</span>
            </div>
            <div className="text-[9px] font-semibold tracking-widest uppercase leading-none mt-1 whitespace-nowrap"
              style={{ color: 'rgb(var(--fg-rgb) / 0.45)' }}>
              Diagnostic Platform
            </div>
          </div>
        )}
      </div>

      {/* Nav items */}
      <div className="flex-1 py-3 px-2 space-y-1 overflow-y-auto scrollbar-thin">
        {ROUTES.map((r) => {
          const Icon = r.icon;
          const active = r.path === activePath;
          return (
            <button
              key={r.path}
              onClick={() => onNavigate(r.path)}
              title={r.label}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${active ? '' : 'hover:bg-[rgb(var(--fg-rgb)/0.04)]'}`}
              style={{
                background: active ? `${theme.accentHex}1a` : 'transparent',
                color: active ? 'rgb(var(--fg-rgb))' : 'rgb(var(--fg-rgb) / 0.6)',
                border: `1px solid ${active ? theme.accentHex + '40' : 'transparent'}`,
              }}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" style={{ color: active ? theme.accentHex : 'currentColor' }} strokeWidth={2} />
              {!collapsed && <span className="text-[13px] font-semibold whitespace-nowrap">{r.label}</span>}
              {!collapsed && active && <span className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: theme.accentHex }} />}
            </button>
          );
        })}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="h-10 flex items-center justify-center gap-2 border-t shrink-0 text-[color:rgb(var(--fg-rgb)/0.5)] hover:text-[color:rgb(var(--fg-rgb)/0.8)] transition-colors"
        style={{ borderColor: theme.panelBorder }}
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : (
          <><ChevronLeft className="w-4 h-4" /><span className="text-[11px] font-semibold">Collapse</span></>
        )}
      </button>
    </nav>
  );
}
