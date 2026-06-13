import { useState, useEffect, useRef } from 'react';
import { X, Circle, Hexagon, Diamond, Zap, Bug, Settings2, Layers } from 'lucide-react';
import type { SceneSettings, EntitySettings } from '../types';
import { DEFAULT_SCENE_SETTINGS } from '../types';
import { SettingRow, Toggle, SliderInput } from './settings/controls';

interface SettingsModalProps {
  open: boolean;
  settings: SceneSettings;
  onApply: (s: SceneSettings) => void;
  onCancel: () => void;
}

const ENTITY_SECTIONS: { key: keyof Pick<SceneSettings, 'nodes' | 'topics' | 'services' | 'actions'>; label: string; icon: typeof Circle; }[] = [
  { key: 'nodes', label: 'Nodes', icon: Hexagon },
  { key: 'topics', label: 'Topics', icon: Circle },
  { key: 'services', label: 'Services', icon: Diamond },
  { key: 'actions', label: 'Actions', icon: Zap },
];

export function SettingsModal({ open, settings, onApply, onCancel }: SettingsModalProps) {
  const [draft, setDraft] = useState<SceneSettings>({ ...DEFAULT_SCENE_SETTINGS, ...settings });
  const [activeTab, setActiveTab] = useState<number>(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    if (open) {
      setDraft({ ...DEFAULT_SCENE_SETTINGS, ...settingsRef.current });
    }
  }, [open]);

  if (!open) return null;

  const updateEntity = (key: keyof Pick<SceneSettings, 'nodes' | 'topics' | 'services' | 'actions'>, field: keyof EntitySettings, value: string | number | boolean) => {
    setDraft(d => ({ ...d, [key]: { ...d[key], [field]: value } }));
  };

  const updateGlobal = (field: keyof SceneSettings, value: number | boolean) => {
    setDraft(d => ({ ...d, [field]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-[560px] max-h-[85vh] rounded-2xl border border-[rgb(var(--fg-rgb)/0.08)] shadow-2xl flex flex-col overflow-hidden" style={{ background: 'var(--menu-bg-solid, #0f172a)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgb(var(--fg-rgb)/0.07)]">
          <h2 className="text-sm font-bold tracking-widest uppercase text-[color:rgb(var(--fg-rgb)/0.8)]">Scene Settings</h2>
          <button onClick={onCancel} className="text-[color:rgb(var(--fg-rgb)/0.3)] hover:text-[color:rgb(var(--fg-rgb)/0.7)] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[rgb(var(--fg-rgb)/0.06)] px-6 overflow-x-auto scrollbar-none">
          <button onClick={() => setActiveTab(0)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 transition-all whitespace-nowrap
              ${activeTab === 0 ? 'border-[rgb(var(--fg-rgb)/0.6)] text-[color:rgb(var(--fg-rgb))]' : 'border-transparent text-[color:rgb(var(--fg-rgb)/0.35)] hover:text-[color:rgb(var(--fg-rgb)/0.6)]'}`}>
            <Layers className="w-3.5 h-3.5" />
            Entities
          </button>
          <button onClick={() => setActiveTab(1)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 transition-all whitespace-nowrap
              ${activeTab === 1 ? 'border-[rgb(var(--fg-rgb)/0.6)] text-[color:rgb(var(--fg-rgb))]' : 'border-transparent text-[color:rgb(var(--fg-rgb)/0.35)] hover:text-[color:rgb(var(--fg-rgb)/0.6)]'}`}>
            <Settings2 className="w-3.5 h-3.5" />
            Global
          </button>
          <button onClick={() => setActiveTab(2)}
            className={`flex items-center gap-1.5 px-3 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 transition-all whitespace-nowrap
              ${activeTab === 2 ? 'border-cyan-400/80 text-cyan-400' : 'border-transparent text-[color:rgb(var(--fg-rgb)/0.35)] hover:text-[color:rgb(var(--fg-rgb)/0.6)]'}`}>
            <Bug className="w-3.5 h-3.5" />
            Debug
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
          {activeTab === 0 && (
            <EntitiesPanel draft={draft} onUpdate={updateEntity} />
          )}
          {activeTab === 1 && (
            <GlobalPanel
              draft={draft}
              onUpdate={(field, value) => updateGlobal(field, value)}
              onUpdateString={(field, value) => setDraft(d => ({ ...d, [field]: value }))}
            />
          )}
          {activeTab === 2 && (
            <DebugPanel settings={draft} />
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[rgb(var(--fg-rgb)/0.07)]">
          <button onClick={onCancel}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-[color:rgb(var(--fg-rgb)/0.5)] border border-[rgb(var(--fg-rgb)/0.1)] hover:bg-[rgb(var(--fg-rgb)/0.04)] transition-all">
            Cancel
          </button>
          <button onClick={() => onApply(draft)}
            className="px-5 py-2 rounded-lg text-xs font-semibold text-[color:rgb(var(--fg-rgb))] bg-[rgb(var(--fg-rgb)/0.12)] border border-[rgb(var(--fg-rgb)/0.15)] hover:bg-[rgb(var(--fg-rgb)/0.2)] transition-all">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export function EntitiesPanel({ draft, onUpdate, grid = false }: {
  draft: SceneSettings;
  onUpdate: (key: keyof Pick<SceneSettings, 'nodes' | 'topics' | 'services' | 'actions'>, field: keyof EntitySettings, val: string | number | boolean) => void;
  grid?: boolean;
}) {
  return (
    <div className={grid ? 'grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5' : 'space-y-6'}>
      {ENTITY_SECTIONS.map((section) => {
        const Icon = section.icon;
        const s = draft[section.key];
        return (
          <div key={section.key} className="space-y-3">
            <div className="flex items-center gap-2">
              <Icon className="w-3.5 h-3.5" style={{ color: s.color }} />
              <p className="text-[11px] text-[color:rgb(var(--fg-rgb)/0.5)] uppercase tracking-widest font-bold">{section.label}</p>
            </div>
            <div className="space-y-3 pl-5">
              <SettingRow label="Color">
                <div className="flex items-center gap-3">
                  <input type="color" value={s.color}
                    onChange={e => onUpdate(section.key, 'color', e.target.value)}
                    className="w-7 h-7 rounded-lg border border-[rgb(var(--fg-rgb)/0.1)] bg-transparent cursor-pointer appearance-none [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none"
                  />
                  <span className="text-[11px] font-mono text-[color:rgb(var(--fg-rgb)/0.4)]">{s.color}</span>
                </div>
              </SettingRow>
              <SettingRow label="Size">
                <SliderInput value={s.size} min={0.2} max={3.0} step={0.1}
                  onChange={v => onUpdate(section.key, 'size', v)} suffix="x" />
              </SettingRow>
              <SettingRow label="Emissive">
                <SliderInput value={s.emissive} min={0} max={1.5} step={0.05}
                  onChange={v => onUpdate(section.key, 'emissive', v)} suffix="" percent />
              </SettingRow>
            </div>
            {!grid && section.key !== 'actions' && <div className="border-b border-[rgb(var(--fg-rgb)/0.04)]" />}
          </div>
        );
      })}
    </div>
  );
}

type GlobalProps = {
  draft: SceneSettings;
  onUpdate: (field: keyof SceneSettings, value: number | boolean) => void;
  onUpdateString: (field: keyof SceneSettings, value: string) => void;
};

const SECTION_TITLE = 'text-[11px] text-[color:rgb(var(--fg-rgb)/0.4)] uppercase tracking-widest font-bold';
const COLOR_INPUT = 'w-8 h-8 rounded-lg border border-[rgb(var(--fg-rgb)/0.1)] bg-transparent cursor-pointer appearance-none [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none';

export function ColorsSection({ draft, onUpdateString }: Pick<GlobalProps, 'draft' | 'onUpdateString'>) {
  return (
    <div className="space-y-4">
      <p className={SECTION_TITLE}>Colors</p>
      <SettingRow label="Menu Background">
        <div className="flex items-center gap-3">
          <input type="color" value={draft.menuBg} onChange={e => onUpdateString('menuBg', e.target.value)} className={COLOR_INPUT} />
          <span className="text-xs font-mono text-[color:rgb(var(--fg-rgb)/0.4)]">{draft.menuBg}</span>
        </div>
      </SettingRow>
      <SettingRow label="3D Scene Background">
        <div className="flex items-center gap-3">
          <input type="color" value={draft.sceneBg} onChange={e => onUpdateString('sceneBg', e.target.value)} className={COLOR_INPUT} />
          <span className="text-xs font-mono text-[color:rgb(var(--fg-rgb)/0.4)]">{draft.sceneBg}</span>
        </div>
      </SettingRow>
    </div>
  );
}

export function GridSection({ draft, onUpdate, onUpdateString }: GlobalProps) {
  return (
    <div className="space-y-4">
      <p className={SECTION_TITLE}>Grid</p>
      <SettingRow label="Visible">
        <Toggle checked={draft.gridVisible ?? true} onChange={v => onUpdate('gridVisible', v)} />
      </SettingRow>
      <SettingRow label="Opacity">
        <SliderInput value={draft.gridOpacity ?? 0.5} min={0} max={1} step={0.05}
          onChange={v => onUpdate('gridOpacity', v)} suffix="" percent />
      </SettingRow>
      <SettingRow label="Color">
        <div className="flex items-center gap-3">
          <input type="color" value={draft.gridColor ?? '#1e293b'} onChange={e => onUpdateString('gridColor', e.target.value)} className={COLOR_INPUT} />
          <span className="text-xs font-mono text-[color:rgb(var(--fg-rgb)/0.4)]">{draft.gridColor ?? '#1e293b'}</span>
        </div>
      </SettingRow>
    </div>
  );
}

export function PostProcessingSection({ draft, onUpdate }: Pick<GlobalProps, 'draft' | 'onUpdate'>) {
  return (
    <div className="space-y-4">
      <p className={SECTION_TITLE}>Post Processing</p>
      <SettingRow label="Bloom Strength">
        <SliderInput value={draft.bloomStrength ?? 0.9} min={0} max={3.0} step={0.05} onChange={v => onUpdate('bloomStrength', v)} suffix="" />
      </SettingRow>
      <SettingRow label="Bloom Radius">
        <SliderInput value={draft.bloomRadius ?? 0.55} min={0} max={2.0} step={0.05} onChange={v => onUpdate('bloomRadius', v)} suffix="" />
      </SettingRow>
      <SettingRow label="Bloom Threshold">
        <SliderInput value={draft.bloomThreshold ?? 0.35} min={0} max={1.0} step={0.05} onChange={v => onUpdate('bloomThreshold', v)} suffix="" />
      </SettingRow>
      <SettingRow label="Fog Density">
        <SliderInput value={draft.fogDensity ?? 0.012} min={0} max={0.05} step={0.001} onChange={v => onUpdate('fogDensity', v)} suffix="" />
      </SettingRow>
    </div>
  );
}

export function ParticlesSection({ draft, onUpdate }: Pick<GlobalProps, 'draft' | 'onUpdate'>) {
  return (
    <div className="space-y-4">
      <p className={SECTION_TITLE}>Particles & Lines</p>
      <SettingRow label="Line Thickness">
        <SliderInput value={draft.lineThickness} min={0.1} max={2.0} step={0.1} onChange={v => onUpdate('lineThickness', v)} suffix="x" />
      </SettingRow>
      <SettingRow label="Data Packet Scale">
        <SliderInput value={draft.packetScale} min={0.2} max={3.0} step={0.1} onChange={v => onUpdate('packetScale', v)} suffix="x" />
      </SettingRow>
    </div>
  );
}

export function LabelsSection({ draft, onUpdate, onUpdateString }: GlobalProps) {
  return (
    <div className="space-y-4">
      <p className={SECTION_TITLE}>Labels</p>
      <SettingRow label="Text Color">
        <div className="flex items-center gap-1 bg-[rgb(var(--fg-rgb)/0.06)] rounded-lg p-0.5">
          <button onClick={() => onUpdateString('labelColor', 'entity')}
            className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all
              ${(draft.labelColor ?? 'entity') === 'entity'
                ? 'bg-gradient-to-r from-cyan-500/30 via-orange-500/30 to-green-500/30 text-[color:rgb(var(--fg-rgb))] shadow-sm'
                : 'text-[color:rgb(var(--fg-rgb)/0.4)] hover:text-[color:rgb(var(--fg-rgb)/0.6)]'}`}>
            Entity
          </button>
          <button onClick={() => onUpdateString('labelColor', 'white')}
            className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all
              ${draft.labelColor === 'white'
                ? 'bg-[rgb(var(--fg-rgb)/0.2)] text-[color:rgb(var(--fg-rgb))] shadow-sm'
                : 'text-[color:rgb(var(--fg-rgb)/0.4)] hover:text-[color:rgb(var(--fg-rgb)/0.6)]'}`}>
            White
          </button>
          <button onClick={() => onUpdateString('labelColor', 'black')}
            className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all
              ${draft.labelColor === 'black'
                ? 'bg-black/40 text-[color:rgb(var(--fg-rgb))] shadow-sm border border-[rgb(var(--fg-rgb)/0.1)]'
                : 'text-[color:rgb(var(--fg-rgb)/0.4)] hover:text-[color:rgb(var(--fg-rgb)/0.6)]'}`}>
            Black
          </button>
        </div>
      </SettingRow>
      <SettingRow label="Name Size">
        <SliderInput value={draft.labelScale ?? 1.0} min={0.3} max={2.5} step={0.1} onChange={v => onUpdate('labelScale', v)} suffix="x" />
      </SettingRow>
      <SettingRow label="Offset">
        <SliderInput value={draft.labelOffset ?? 2.2} min={0.5} max={5.0} step={0.1} onChange={v => onUpdate('labelOffset', v)} suffix="" />
      </SettingRow>
    </div>
  );
}

// Composite of every general section (used by the legacy modal's Global tab).
export function GlobalPanel(props: GlobalProps) {
  return (
    <div className="space-y-8">
      <ColorsSection draft={props.draft} onUpdateString={props.onUpdateString} />
      <GridSection {...props} />
      <PostProcessingSection draft={props.draft} onUpdate={props.onUpdate} />
      <ParticlesSection draft={props.draft} onUpdate={props.onUpdate} />
      <LabelsSection {...props} />
    </div>
  );
}

export function OutlineEdgesPanel({ draft, onUpdate, onUpdateString }: {
  draft: SceneSettings;
  onUpdate: (field: keyof SceneSettings, value: number | boolean) => void;
  onUpdateString: (field: keyof SceneSettings, value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-[11px] text-[color:rgb(var(--fg-rgb)/0.4)] uppercase tracking-widest font-bold">Outline Edges</p>
      <SettingRow label="Nodes">
        <Toggle checked={draft.nodeEdges} onChange={v => onUpdate('nodeEdges', v)} />
      </SettingRow>
      <SettingRow label="Topics">
        <Toggle checked={draft.topicEdges} onChange={v => onUpdate('topicEdges', v)} />
      </SettingRow>
      <SettingRow label="Services">
        <Toggle checked={draft.serviceEdges} onChange={v => onUpdate('serviceEdges', v)} />
      </SettingRow>
      <SettingRow label="Actions">
        <Toggle checked={draft.actionEdges} onChange={v => onUpdate('actionEdges', v)} />
      </SettingRow>
      <SettingRow label="Edge Color">
        <div className="flex items-center gap-3">
          <input type="color" value={draft.edgeColor}
            onChange={e => onUpdateString('edgeColor', e.target.value)}
            className="w-8 h-8 rounded-lg border border-[rgb(var(--fg-rgb)/0.1)] bg-transparent cursor-pointer appearance-none [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-none"
          />
          <span className="text-xs font-mono text-[color:rgb(var(--fg-rgb)/0.4)]">{draft.edgeColor}</span>
        </div>
      </SettingRow>
      <SettingRow label="Edge Thickness">
        <SliderInput value={draft.edgeThickness ?? 1.12} min={1.02} max={1.4} step={0.02}
          onChange={v => onUpdate('edgeThickness', v)} suffix="x" />
      </SettingRow>
    </div>
  );
}

export function DebugPanel({ settings }: { settings: SceneSettings }) {
  const [copied, setCopied] = useState(false);

  const structured = {
    entities: {
      nodes: settings.nodes,
      topics: settings.topics,
      services: settings.services,
      actions: settings.actions,
    },
    colours: {
      menuBg: settings.menuBg,
      sceneBg: settings.sceneBg,
    },
    grid: {
      visible: settings.gridVisible,
      opacity: settings.gridOpacity,
      color: settings.gridColor,
    },
    postProcessing: {
      bloomStrength: settings.bloomStrength,
      bloomRadius: settings.bloomRadius,
      bloomThreshold: settings.bloomThreshold,
      fogDensity: settings.fogDensity,
    },
    linesAndData: {
      lineThickness: settings.lineThickness,
      packetScale: settings.packetScale,
    },
    labels: {
      labelColor: settings.labelColor,
      labelScale: settings.labelScale,
      labelOffset: settings.labelOffset,
    },
    outlineEdges: {
      nodeEdges: settings.nodeEdges,
      topicEdges: settings.topicEdges,
      serviceEdges: settings.serviceEdges,
      actionEdges: settings.actionEdges,
      edgeColor: settings.edgeColor,
      edgeThickness: settings.edgeThickness,
    },
  };

  const json = JSON.stringify(structured, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-[color:rgb(var(--fg-rgb)/0.4)] uppercase tracking-widest font-bold">Current Settings JSON</p>
        <button onClick={handleCopy}
          className={`px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all
            ${copied
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-[rgb(var(--fg-rgb)/0.06)] text-[color:rgb(var(--fg-rgb)/0.5)] border border-[rgb(var(--fg-rgb)/0.1)] hover:bg-[rgb(var(--fg-rgb)/0.1)] hover:text-[color:rgb(var(--fg-rgb)/0.7)]'}`}>
          {copied ? 'Copied!' : 'Copy to Clipboard'}
        </button>
      </div>
      <p className="text-[10px] text-[color:rgb(var(--fg-rgb)/0.3)]">Grouped output for readability. Use to update DEFAULT_SCENE_SETTINGS in types.ts</p>
      <pre className="p-4 rounded-xl bg-black/40 border border-[rgb(var(--fg-rgb)/0.06)] text-[11px] text-cyan-300/80 font-mono overflow-auto max-h-[50vh] leading-relaxed whitespace-pre">
        {json}
      </pre>
    </div>
  );
}

