import { useState, useEffect, useMemo } from 'react';
import { Settings as SettingsIcon, Plug, Palette, Gauge, RotateCcw, Eye, Save, X, Bug } from 'lucide-react';
import { TopBar } from '../components/TopBar';
import { SettingRow, Toggle, SliderInput } from '../components/settings/controls';
import {
  EntitiesPanel, OutlineEdgesPanel, DebugPanel,
  ColorsSection, GridSection, PostProcessingSection, ParticlesSection, LabelsSection,
} from '../components/SettingsModal';
import { useTheme, THEMES, type ThemeId } from '../hooks/useTheme';
import { useSettingsStore } from '../store/settingsStore';
import { useBridgeConnectionStore, reconnectBridge } from '../bridge/connection';
import { DEFAULT_SCENE_SETTINGS, type SceneSettings } from '../types';

const PRESET_IDS = Object.keys(THEMES) as Exclude<ThemeId, 'custom'>[];
const LOG_CAP_OPTIONS = [500, 1000, 2000, 5000, 10000];
const ENTITY_KEYS: { key: keyof Pick<SceneSettings, 'nodes' | 'topics' | 'services' | 'actions'>; label: string }[] = [
  { key: 'nodes', label: 'Nodes' }, { key: 'topics', label: 'Topics' },
  { key: 'services', label: 'Services' }, { key: 'actions', label: 'Actions' },
];

const STATUS_COLOR = { connected: '#10b981', connecting: '#f59e0b', disconnected: '#ef4444' };

export function Settings() {
  const { theme } = useTheme();

  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: theme.bg }}>
      <TopBar title="Settings" icon={SettingsIcon} />
      <div className="absolute top-14 left-0 right-0 bottom-0 overflow-y-auto scrollbar-thin">
        <div className="max-w-5xl mx-auto px-8 py-8 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
            {/* Left: connection */}
            <div className="space-y-6">
              <ConnectionSection />
            </div>
            {/* Right: telemetry */}
            <div className="space-y-6">
              <TelemetrySection />
            </div>
          </div>

          {/* Full width: appearance (with preview at the bottom) */}
          <AppearanceSection />

          <ResetSection />
          <p className="text-[10px] text-center pt-2" style={{ color: 'var(--page-text-dim)' }}>
            Appearance edits apply to the Custom theme; preset themes keep their built-in defaults.
          </p>
        </div>
      </div>
    </div>
  );
}

// Live visual summary of a scene-settings object (bound to the editor draft).
function PreviewBox({ settings: s }: { settings: SceneSettings }) {
  return (
    <div>
      <div className="rounded-xl overflow-hidden border border-[rgb(var(--fg-rgb)/0.08)]">
        <div className="relative h-36 flex items-center justify-center gap-6" style={{ background: s.sceneBg }}>
          {s.gridVisible && (
            <div className="absolute inset-0" style={{
              opacity: s.gridOpacity,
              backgroundImage: `linear-gradient(${s.gridColor} 1px, transparent 1px), linear-gradient(90deg, ${s.gridColor} 1px, transparent 1px)`,
              backgroundSize: '22px 22px',
            }} />
          )}
          {ENTITY_KEYS.map(({ key }) => {
            const e = s[key];
            return (
              <div key={key} className="relative rounded-full" style={{
                width: 26 * e.size, height: 26 * e.size,
                background: e.color,
                boxShadow: `0 0 ${10 + e.emissive * 26}px ${Math.round(e.emissive * 10)}px ${e.color}`,
              }} />
            );
          })}
        </div>
        <div className="flex items-center justify-between px-3 py-2" style={{ background: 'var(--menu-bg-solid, #0f172a)' }}>
          {ENTITY_KEYS.map(({ key, label }) => (
            <div key={key} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: s[key].color }} />
              <span className="text-[10px] text-[color:rgb(var(--fg-rgb)/0.55)]">{label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.4)] pt-1.5">
        <span>bloom {s.bloomStrength.toFixed(2)}</span>
        <span>fog {s.fogDensity.toFixed(3)}</span>
        <span>scene {s.sceneBg}</span>
      </div>
    </div>
  );
}

function Section({ icon: Icon, title, subtitle, children }: {
  icon: typeof Plug; title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[rgb(var(--fg-rgb)/0.08)] overflow-hidden" style={{ background: 'var(--menu-bg-solid, #0f172a)' }}>
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[rgb(var(--fg-rgb)/0.07)]">
        <Icon className="w-4 h-4 text-[color:rgb(var(--fg-rgb)/0.6)]" />
        <div>
          <h2 className="text-sm font-bold text-[color:rgb(var(--fg-rgb)/0.85)]">{title}</h2>
          <p className="text-[11px] text-[color:rgb(var(--fg-rgb)/0.4)]">{subtitle}</p>
        </div>
      </div>
      <div className="px-5 py-5 space-y-4">{children}</div>
    </div>
  );
}

function ConnectionSection() {
  const { wsHost, wsPort, set } = useSettingsStore();
  const status = useBridgeConnectionStore((s) => s.status);

  return (
    <Section icon={Plug} title="Connection" subtitle="Bridge WebSocket endpoint.">
      <SettingRow label="Status">
        <span className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider" style={{ color: STATUS_COLOR[status] }}>
          <span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLOR[status] }} />
          {status}
        </span>
      </SettingRow>
      <SettingRow label="Host">
        <input value={wsHost} onChange={(e) => set('wsHost', e.target.value)}
          className="w-48 px-3 py-1.5 rounded-lg bg-[rgb(var(--fg-rgb)/0.05)] border border-[rgb(var(--fg-rgb)/0.1)] text-[11px] text-[color:rgb(var(--fg-rgb)/0.8)] font-mono focus:outline-none focus:border-[rgb(var(--fg-rgb)/0.25)]" />
      </SettingRow>
      <SettingRow label="Port">
        <input type="number" value={wsPort} onChange={(e) => set('wsPort', parseInt(e.target.value, 10) || 0)}
          className="w-24 px-3 py-1.5 rounded-lg bg-[rgb(var(--fg-rgb)/0.05)] border border-[rgb(var(--fg-rgb)/0.1)] text-[11px] text-[color:rgb(var(--fg-rgb)/0.8)] font-mono focus:outline-none focus:border-[rgb(var(--fg-rgb)/0.25)]" />
      </SettingRow>
      <div className="flex justify-end pt-1">
        <button onClick={() => reconnectBridge()}
          className="px-4 py-2 rounded-lg text-xs font-semibold text-[color:rgb(var(--fg-rgb))] bg-[rgb(var(--fg-rgb)/0.12)] border border-[rgb(var(--fg-rgb)/0.15)] hover:bg-[rgb(var(--fg-rgb)/0.2)] transition-all">
          Apply & Reconnect
        </button>
      </div>
    </Section>
  );
}

function AppearanceSection() {
  const { themeId, setThemeId, sceneSettings, applyScene } = useTheme();

  // Edits accumulate in a draft and only commit on Save, so the page can show a
  // live preview without mutating the active theme until confirmed.
  const [draft, setDraft] = useState<SceneSettings>(sceneSettings);
  const [showDebug, setShowDebug] = useState(false);
  // Resync when the committed settings change externally (e.g. a preset switch).
  useEffect(() => { setDraft(sceneSettings); }, [sceneSettings]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(sceneSettings),
    [draft, sceneSettings],
  );

  const updateEntity = (
    key: keyof Pick<SceneSettings, 'nodes' | 'topics' | 'services' | 'actions'>,
    field: keyof SceneSettings['nodes'], value: string | number | boolean,
  ) => setDraft((d) => ({ ...d, [key]: { ...d[key], [field]: value } }));

  const updateGlobal = (field: keyof SceneSettings, value: number | boolean | string) =>
    setDraft((d) => ({ ...d, [field]: value } as SceneSettings));

  return (
    <Section icon={Palette} title="Appearance" subtitle="Full scene styling for the active theme — colours, sizes, grid, post-processing, labels and edges.">
      {/* Theme preset picker — centered segmented control */}
      <div className="flex justify-center py-1">
        <div className="inline-flex flex-wrap items-center justify-center gap-1 p-1 rounded-xl border border-[rgb(var(--fg-rgb)/0.1)] bg-[rgb(var(--fg-rgb)/0.03)]">
          {PRESET_IDS.map((id) => (
            <button key={id} onClick={() => setThemeId(id)}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all
                ${id === themeId
                  ? 'bg-[rgb(var(--fg-rgb)/0.1)] text-[color:rgb(var(--fg-rgb))]'
                  : 'text-[color:rgb(var(--fg-rgb)/0.5)] hover:text-[color:rgb(var(--fg-rgb)/0.85)]'}`}>
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: THEMES[id].swatchHex ?? THEMES[id].accentHex }} />
              {THEMES[id].label}
            </button>
          ))}
          <button onClick={() => setThemeId('custom')}
            className={`px-3.5 py-1.5 rounded-lg text-[11px] font-semibold transition-all
              ${themeId === 'custom'
                ? 'bg-[rgb(var(--fg-rgb)/0.1)] text-[color:rgb(var(--fg-rgb))]'
                : 'text-[color:rgb(var(--fg-rgb)/0.5)] hover:text-[color:rgb(var(--fg-rgb)/0.85)]'}`}>
            Custom
          </button>
        </div>
      </div>

      {/* Entities — 2x2 grid (node / topics / services / actions) */}
      <div className="pt-4 border-t border-[rgb(var(--fg-rgb)/0.06)]">
        <p className="text-[11px] text-[color:rgb(var(--fg-rgb)/0.4)] uppercase tracking-widest font-bold mb-4">Entities</p>
        <EntitiesPanel draft={draft} onUpdate={updateEntity} grid />
      </div>

      {/* Preview */}
      <div className="pt-4 border-t border-[rgb(var(--fg-rgb)/0.06)]">
        <p className="flex items-center gap-1.5 text-[11px] text-[color:rgb(var(--fg-rgb)/0.4)] uppercase tracking-widest font-bold mb-3">
          <Eye className="w-3.5 h-3.5" /> Preview
        </p>
        <PreviewBox settings={draft} />
      </div>

      {/* General appearance settings — sections split across two columns to keep them level */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-8 pt-4 border-t border-[rgb(var(--fg-rgb)/0.06)]">
        <div className="space-y-8">
          <ColorsSection draft={draft} onUpdateString={updateGlobal} />
          <GridSection draft={draft} onUpdate={updateGlobal} onUpdateString={updateGlobal} />
          <PostProcessingSection draft={draft} onUpdate={updateGlobal} />
        </div>
        <div className="space-y-8">
          <OutlineEdgesPanel draft={draft} onUpdate={updateGlobal} onUpdateString={updateGlobal} />
          <ParticlesSection draft={draft} onUpdate={updateGlobal} />
          <LabelsSection draft={draft} onUpdate={updateGlobal} onUpdateString={updateGlobal} />
        </div>
      </div>

      {/* Restore / Cancel / Save + Debug popup */}
      <div className="pt-6 border-t border-[rgb(var(--fg-rgb)/0.06)] space-y-3">
        {dirty && <p className="text-center text-[10px] text-amber-400 uppercase tracking-widest font-bold">Unsaved changes</p>}
        <div className="flex flex-wrap items-center justify-center gap-4">
          <button onClick={() => setShowDebug(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-[color:rgb(var(--fg-rgb)/0.5)] border border-[rgb(var(--fg-rgb)/0.1)] hover:bg-[rgb(var(--fg-rgb)/0.04)] transition-all">
            <Bug className="w-3.5 h-3.5" /> Debug
          </button>
          <button onClick={() => setDraft(DEFAULT_SCENE_SETTINGS)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-[color:rgb(var(--fg-rgb)/0.5)] border border-[rgb(var(--fg-rgb)/0.1)] hover:bg-[rgb(var(--fg-rgb)/0.04)] transition-all">
            <RotateCcw className="w-3.5 h-3.5" /> Restore
          </button>
          <button onClick={() => setDraft(sceneSettings)} disabled={!dirty}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-[color:rgb(var(--fg-rgb)/0.6)] border border-[rgb(var(--fg-rgb)/0.1)] hover:bg-[rgb(var(--fg-rgb)/0.04)] transition-all disabled:opacity-30 disabled:cursor-not-allowed">
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
          <button onClick={() => applyScene(draft)} disabled={!dirty}
            className="flex items-center gap-1.5 px-6 py-2 rounded-lg text-xs font-semibold text-[color:rgb(var(--fg-rgb))] bg-[rgb(var(--fg-rgb)/0.12)] border border-[rgb(var(--fg-rgb)/0.15)] hover:bg-[rgb(var(--fg-rgb)/0.2)] transition-all disabled:opacity-30 disabled:cursor-not-allowed">
            <Save className="w-3.5 h-3.5" /> Save
          </button>
        </div>
      </div>

      {/* Debug popup */}
      {showDebug && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowDebug(false)} />
          <div className="relative w-[640px] max-h-[80vh] rounded-2xl border border-[rgb(var(--fg-rgb)/0.08)] shadow-2xl flex flex-col overflow-hidden" style={{ background: 'var(--menu-bg-solid, #0f172a)' }}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[rgb(var(--fg-rgb)/0.07)]">
              <span className="flex items-center gap-2 text-sm font-bold tracking-widest uppercase text-[color:rgb(var(--fg-rgb)/0.8)]">
                <Bug className="w-4 h-4" /> Scene Settings JSON
              </span>
              <button onClick={() => setShowDebug(false)} className="text-[color:rgb(var(--fg-rgb)/0.3)] hover:text-[color:rgb(var(--fg-rgb)/0.7)] transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin px-5 py-4">
              <DebugPanel settings={draft} />
            </div>
          </div>
        </div>
      )}
    </Section>
  );
}

function TelemetrySection() {
  const { maxLogEntries, capturePayloads, stalenessThresholdSec, set } = useSettingsStore();
  return (
    <Section icon={Gauge} title="Telemetry & Rate Limits" subtitle="How much live data the UI retains and displays.">
      <SettingRow label="Log buffer size">
        <Select value={String(maxLogEntries)} onChange={(v) => set('maxLogEntries', parseInt(v, 10))}
          options={LOG_CAP_OPTIONS.map((n) => ({ value: String(n), label: `${n.toLocaleString()} lines` }))} />
      </SettingRow>
      <SettingRow label="Capture topic messages in log">
        <Toggle checked={capturePayloads} onChange={(v) => set('capturePayloads', v)} />
      </SettingRow>
      <SettingRow label="Topic staleness threshold">
        <SliderInput value={stalenessThresholdSec} min={0.5} max={10} step={0.5}
          onChange={(v) => set('stalenessThresholdSec', v)} suffix="s" />
      </SettingRow>
      <p className="text-[10px] text-[color:rgb(var(--fg-rgb)/0.3)]">
        Buffer size and staleness apply live. Backend payload rate limiting is set at bridge launch.
      </p>
    </Section>
  );
}

function ResetSection() {
  const reset = useSettingsStore((s) => s.reset);
  const resetAll = () => {
    reset();
    localStorage.removeItem('ros3d-scene-settings');
    reconnectBridge();
  };
  return (
    <div className="flex items-center justify-between rounded-2xl border border-[rgb(var(--fg-rgb)/0.08)] px-5 py-4" style={{ background: 'var(--menu-bg-solid, #0f172a)' }}>
      <div>
        <p className="text-sm font-bold text-[color:rgb(var(--fg-rgb)/0.85)]">Reset preferences</p>
        <p className="text-[11px] text-[color:rgb(var(--fg-rgb)/0.4)]">Restores defaults and clears saved 3D scene settings.</p>
      </div>
      <button onClick={resetAll}
        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold text-red-300 border border-red-500/30 hover:bg-red-500/10 transition-all">
        <RotateCcw className="w-3.5 h-3.5" /> Reset
      </button>
    </div>
  );
}

function Select({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="px-3 py-1.5 rounded-lg bg-[rgb(var(--fg-rgb)/0.05)] border border-[rgb(var(--fg-rgb)/0.1)] text-[11px] text-[color:rgb(var(--fg-rgb)/0.8)] capitalize focus:outline-none focus:border-[rgb(var(--fg-rgb)/0.25)] cursor-pointer">
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-slate-900 text-[color:rgb(var(--fg-rgb))]">{o.label}</option>
      ))}
    </select>
  );
}
