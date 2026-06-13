import { useState } from 'react';
import { Palette, RotateCcw } from 'lucide-react';
import { useTheme, THEMES, type ThemeId } from '../hooks/useTheme';

const PRESET_IDS = Object.keys(THEMES) as (Exclude<ThemeId, 'custom'>)[];

// Theme palette picker — shared by the top bar across all pages.
export function ThemeSwitcher({ onResetSettings }: { onResetSettings?: () => void }) {
  const { themeId, setThemeId, theme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[rgb(var(--fg-rgb)/0.04)] border border-[rgb(var(--fg-rgb)/0.08)] hover:bg-[rgb(var(--fg-rgb)/0.08)] transition-all">
        <Palette className="w-3.5 h-3.5" style={{ color: 'var(--menu-text-muted)' }} />
        <span className="w-2.5 h-2.5 rounded-full" style={{ background: theme.swatchHex ?? theme.accentHex }} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 min-w-[180px] py-1.5 rounded-lg backdrop-blur-xl border border-[rgb(var(--fg-rgb)/0.1)] shadow-xl"
            style={{ background: 'var(--menu-bg-solid, rgba(15,23,42,0.95))' }}>
            {PRESET_IDS.map((id) => (
              <button key={id} onClick={() => { setThemeId(id); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[rgb(var(--fg-rgb)/0.05)] transition-colors"
                style={{ color: id === themeId ? 'var(--menu-text)' : 'var(--menu-text-muted)' }}>
                <span className="w-3 h-3 rounded-full" style={{ background: THEMES[id].swatchHex ?? THEMES[id].accentHex }} />
                <span className="text-[11px] font-semibold">{THEMES[id].label}</span>
                {id === themeId && <span className="ml-auto text-[9px]" style={{ color: 'var(--menu-text-dim)' }}>active</span>}
              </button>
            ))}
            {onResetSettings && (
              <div className="border-t border-[rgb(var(--fg-rgb)/0.08)] mt-1 pt-1">
                <button onClick={() => { setThemeId('midnight'); onResetSettings(); setOpen(false); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[rgb(var(--fg-rgb)/0.05)] transition-colors" style={{ color: 'var(--menu-text-muted)' }}>
                  <RotateCcw className="w-3 h-3" />
                  <span className="text-[11px] font-semibold">Reset to Defaults</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
