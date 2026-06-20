/**
 * Telemetry.tsx — react-chartjs-2 live time-series chart.
 *
 * Chart.js owns the data. Series config (label/colour/axis) lives in
 * telemetryStore. Data is pushed imperatively from bridge events directly
 * into Chart.js datasets — no ring-buffer, no polling interval for alignment.
 *
 * Zoom:  scroll-wheel changes span, live-follow continues at new span.
 * Pan:   mouse-drag freezes x-axis. "Live" button or double-click resumes.
 */

import {
  Chart as ChartJS,
  TimeScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
  type ChartData,
  type ChartOptions,
  type TooltipItem,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import zoomPlugin from 'chartjs-plugin-zoom';
import { Line } from 'react-chartjs-2';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart, Play, Square, RotateCcw, Plus, X, Download, ChevronLeft, ChevronRight, ChevronDown,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { TopBar } from '../components/TopBar';
import { useTheme } from '../hooks/useTheme';
import { useBtStore } from '../store/btStore';
import {
  useTelemetryStore,
  bbSeriesId,
  MAX_SERIES,
  type AxisSide,
  type SeriesConfig,
} from '../store/telemetryStore';
import { subscribeToBridgeFrames, startBridgeConnection } from '../bridge/connection';
import type { MessageEvent } from '../types';

// Register Chart.js components and zoom plugin (module-level, once).
ChartJS.register(TimeScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend, zoomPlugin);

const LIVE_WINDOW_MS = 600_000; // 10 minutes

// ── Types ─────────────────────────────────────────────────────────────────────

type DataPoint = { x: number; y: number };

// ── Utilities ─────────────────────────────────────────────────────────────────

function resolvePath(obj: unknown, path: string): number | null {
  if (!path) return typeof obj === 'number' ? obj : null;
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'number' ? cur : null;
}

function fgRgba(fgRgb: string, alpha: number) {
  return `rgba(${fgRgb.replace(/ /g, ',')},${alpha})`;
}

function downloadCSV(chart: ChartJS<'line'>, series: SeriesConfig[]): void {
  if (!series.length) return;
  const rowMap = new Map<number, (number | null)[]>();
  chart.data.datasets.forEach((ds, si) => {
    (ds.data as DataPoint[]).forEach(({ x, y }) => {
      if (!rowMap.has(x)) rowMap.set(x, new Array(series.length).fill(null));
      rowMap.get(x)![si] = y;
    });
  });
  const sorted = Array.from(rowMap.keys()).sort((a, b) => a - b);
  const header = `timestamp_unix_s,${series.map((s) => `"${s.label}"`).join(',')}`;
  const lines  = sorted.map((t) =>
    `${(t / 1000).toFixed(3)},${rowMap.get(t)!.map((v) => (v == null ? '' : v)).join(',')}`);
  const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `telemetry_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Small reusable UI bits ────────────────────────────────────────────────────

function AxisBtn({ axis, onClick }: { axis: AxisSide; onClick: () => void }) {
  const right = axis === 'y2';
  return (
    <button onClick={onClick}
      className="text-[9px] font-bold px-1.5 py-0.5 rounded transition-all whitespace-nowrap"
      style={{
        background: right ? 'rgba(245,158,11,0.15)' : 'rgba(6,182,212,0.1)',
        color: right ? '#f59e0b' : '#06b6d4',
        border: `1px solid ${right ? 'rgba(245,158,11,0.3)' : 'rgba(6,182,212,0.2)'}`,
      }}
    >
      {right ? 'Right' : 'Left'}
    </button>
  );
}

function Divider() {
  return <div className="h-px mx-1" style={{ background: 'rgb(var(--fg-rgb) / 0.08)' }} />;
}

function SectionHeader({ label, open, onToggle, suffix }: {
  label: string; open: boolean; onToggle: () => void; suffix?: React.ReactNode;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1 w-full text-left group"
    >
      <ChevronDown
        className="w-3 h-3 shrink-0 transition-transform duration-150"
        style={{ color: 'var(--menu-text-dim)', transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' }}
      />
      <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--menu-text-dim)' }}>
        {label}
      </span>
      {suffix}
    </button>
  );
}

function RangeInput({ placeholder, value, onChange }: {
  placeholder: string; value: number | null; onChange: (v: number | null) => void;
}) {
  return (
    <input type="number" placeholder={placeholder} value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
      className="flex-1 min-w-0 px-2 py-1 rounded text-[10px] font-mono outline-none"
      style={{ background: 'rgb(var(--fg-rgb) / 0.05)', border: '1px solid rgb(var(--fg-rgb) / 0.1)', color: 'var(--menu-text)' }}
    />
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function Telemetry() {
  const { theme } = useTheme();

  const {
    series, active, axisRanges,
    addSeries, addBlackboardSeries, removeSeries, updateAxis, updateColor,
    setAxisRange, setActive, reset,
  } = useTelemetryStore();

  const rawTreeBlackboards = useBtStore(
    useShallow((s) =>
      Object.fromEntries(Object.entries(s.trees).map(([id, tree]) => [id, tree.blackboard])),
    ),
  );
  const allTreeBlackboards = useMemo(
    () =>
      Object.entries(rawTreeBlackboards)
        .map(([treeId, blackboard]) => ({
          treeId, blackboard, allKeys: Object.keys(blackboard).sort(),
        }))
        .filter((t) => t.allKeys.length > 0),
    [rawTreeBlackboards],
  );

  const [panelOpen,  setPanelOpen]  = useState(true);
  const [draftTopic, setDraftTopic] = useState('');
  const [draftField, setDraftField] = useState('');
  const [draftAxis,  setDraftAxis]  = useState<AxisSide>('y1');

  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const toggleSection = (key: string) =>
    setCollapsedSections((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const isSectionOpen = (key: string) => !collapsedSections.has(key);

  // chartRef: react-chartjs-2 exposes the ChartJS instance here.
  const chartRef = useRef<ChartJS<'line'>>(null);

  // Stable empty data object — passed as the data prop and never changed so
  // react-chartjs-2 doesn't overwrite our imperatively managed datasets.
  const stableData = useRef<ChartData<'line'>>({ datasets: [] });

  // Pan state: true while user has dragged into history.
  const isPannedRef       = useRef(false);
  // Zoom span: null = LIVE_WINDOW_MS, otherwise the user's current scroll-zoom span.
  const customSpanRef     = useRef<number | null>(null);
  // Wall-clock ms when recording started — anchors the left edge until window fills.
  const recordingStartRef = useRef<number | null>(null);
  // Snapshot for bridge event handler (avoids stale closure).
  const seriesSnap     = useRef(series);
  seriesSnap.current   = series;

  // ── Sync Chart.js datasets whenever series config changes ─────────────────
  // Preserves existing data by label so colour/axis changes don't lose points.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const dataByLabel = new Map<string, DataPoint[]>();
    chart.data.datasets.forEach((ds) => {
      dataByLabel.set(ds.label as string, ds.data as DataPoint[]);
    });

    chart.data.datasets = series.map((s) => ({
      label:           s.label,
      data:            dataByLabel.get(s.label) ?? [],
      borderColor:     s.color,
      backgroundColor: 'transparent',
      borderWidth:     1.5,
      pointRadius:     0,
      tension:         0.1,
      yAxisID:         s.axis,
      parsing:         false as const,
    }));

    chart.update('none');
  }, [series]);

  // ── 10 Hz x-axis advance + old-data pruning ───────────────────────────────
  useEffect(() => {
    if (!active || series.length === 0) return;

    const id = setInterval(() => {
      const chart = chartRef.current;
      if (!chart) return;

      // Prune points older than 3× the window (survives zoom-out).
      const cutoff = Date.now() - LIVE_WINDOW_MS * 3;
      for (const ds of chart.data.datasets) {
        const data = ds.data as DataPoint[];
        let i = 0;
        while (i < data.length && data[i].x < cutoff) i++;
        if (i > 0) data.splice(0, i);
      }

      if (!isPannedRef.current) {
        const now   = Date.now();
        const span  = customSpanRef.current ?? LIVE_WINDOW_MS;
        const start = recordingStartRef.current ?? now;
        if (now - start < span) {
          // Window not yet full — anchor left edge at recording start so data
          // builds from the left rather than appearing at the far right.
          chart.options.scales!.x!.min = start;
          chart.options.scales!.x!.max = start + span;
        } else {
          // Window full — scroll normally, right edge = now.
          chart.options.scales!.x!.min = now - span;
          chart.options.scales!.x!.max = now;
        }
      }

      chart.update('none');
    }, 100);

    return () => clearInterval(id);
  }, [active, series.length]);

  // ── Bridge subscription — push data directly into Chart.js datasets ───────
  useEffect(() => {
    startBridgeConnection();
    const unsub = subscribeToBridgeFrames(({ frame }) => {
      if (!useTelemetryStore.getState().active) return;
      const chart = chartRef.current;
      if (!chart) return;

      const snap = seriesSnap.current;

      if (frame.type === 'message_event') {
        const ev  = frame.data as MessageEvent;
        const tMs = (frame.timestamp ?? Date.now() / 1000) * 1000;
        for (const s of snap) {
          if (s.source !== 'topic' || s.topic !== ev.topic) continue;
          const val = resolvePath(ev.payload, s.field);
          if (val === null) continue;
          const ds = chart.data.datasets.find((d) => d.label === s.label);
          if (ds) (ds.data as DataPoint[]).push({ x: tMs, y: val });
        }
      } else if (frame.type === 'bt_blackboard') {
        const ev  = frame.data as { tree_id: string; vars: Record<string, unknown> };
        const tMs = (frame.timestamp ?? Date.now() / 1000) * 1000;
        for (const s of snap) {
          if (s.source !== 'blackboard') continue;
          if (s.treeId && ev.tree_id !== s.treeId) continue;
          const val = ev.vars[s.field];
          if (typeof val !== 'number') continue;
          const ds = chart.data.datasets.find((d) => d.label === s.label);
          if (ds) (ds.data as DataPoint[]).push({ x: tMs, y: val });
        }
      }
    });
    return unsub;
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const snapToLive = () => {
    isPannedRef.current  = false;
    customSpanRef.current = null;
    const chart = chartRef.current;
    if (!chart) return;
    const now = Date.now();
    chart.options.scales!.x!.min = now - LIVE_WINDOW_MS;
    chart.options.scales!.x!.max = now;
    chart.update('none');
  };

  const handleReset = () => {
    isPannedRef.current       = false;
    customSpanRef.current     = null;
    recordingStartRef.current = null;
    const chart = chartRef.current;
    if (chart) {
      chart.data.datasets = [];
      chart.update('none');
    }
    reset();
  };

  // ── Chart options (rebuilt on theme or axis-range change) ─────────────────
  const options = useMemo<ChartOptions<'line'>>(() => {
    const grid = fgRgba(theme.fgRgb, 0.07);
    const tick = fgRgba(theme.fgRgb, 0.40);

    // fgRgb is white ('255 255 255') on dark themes, dark slate on light themes.
    // Derive a tooltip that's always readable regardless of the active theme.
    const isLightTheme = theme.fgRgb.startsWith('15');
    const ttBg     = isLightTheme ? 'rgba(15,23,42,0.93)'   : 'rgba(240,245,252,0.97)';
    const ttText   = isLightTheme ? 'rgba(230,235,245,0.92)' : 'rgba(15,23,42,0.9)';
    const ttMuted  = isLightTheme ? 'rgba(200,210,225,0.65)' : 'rgba(15,23,42,0.5)';
    const ttBorder = isLightTheme ? 'rgba(255,255,255,0.10)' : 'rgba(15,23,42,0.12)';

    return {
      animation:            false,
      responsive:           true,
      maintainAspectRatio:  false,
      interaction:          { mode: 'index', intersect: false },
      parsing:              false,
      scales: {
        x: {
          type: 'time',
          time: { displayFormats: { second: 'HH:mm:ss', minute: 'HH:mm' } },
          min: Date.now() - LIVE_WINDOW_MS,
          max: Date.now(),
          ticks: { maxTicksLimit: 8, color: tick },
          grid:  { color: grid },
        },
        y1: {
          type: 'linear', position: 'left',
          min: axisRanges.y1.min ?? undefined,
          max: axisRanges.y1.max ?? undefined,
          ticks: { color: tick }, grid: { color: grid },
        },
        y2: {
          type: 'linear', position: 'right',
          display: 'auto',
          min: axisRanges.y2.min ?? undefined,
          max: axisRanges.y2.max ?? undefined,
          ticks: { color: tick }, grid: { drawOnChartArea: false },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: ttBg,
          borderColor:     ttBorder,
          borderWidth:     1,
          titleColor:      ttMuted,
          bodyColor:       ttText,
          padding:         10,
          callbacks: {
            title: (items: TooltipItem<'line'>[]) =>
              items.length
                ? new Date(items[0].parsed.x ?? Date.now()).toISOString().slice(11, 23)
                : '',
            label: (item: TooltipItem<'line'>) => {
              const v = item.parsed.y;
              if (v == null || isNaN(v)) return `  ${item.dataset.label}: —`;
              const fmt =
                Math.abs(v) >= 10_000 || (Math.abs(v) < 0.01 && v !== 0)
                  ? v.toExponential(3)
                  : parseFloat(v.toPrecision(5)).toString();
              return `  ${item.dataset.label}: ${fmt}`;
            },
          },
        },
        zoom: {
          pan: {
            enabled: true,
            mode: 'x',
            onPanStart: () => { isPannedRef.current = true; return true; },
          },
          zoom: {
            wheel: { enabled: true, speed: 0.1 },
            pinch: { enabled: false },
            mode: 'x',
            onZoomComplete: ({ chart: c }) => {
              // Preserve the new span so live-follow uses it.
              const { min, max } = c.scales.x;
              if (min != null && max != null) customSpanRef.current = max - min;
            },
          },
        },
      },
    };
  }, [theme.fgRgb, axisRanges]);

  const atLimit    = series.length >= MAX_SERIES;
  const isbbActive = (key: string, treeId: string) => series.some((s) => s.id === bbSeriesId(key, treeId));

  const handleAdd = () => {
    const topic = draftTopic.trim();
    if (!topic) return;
    if (addSeries(topic, draftField.trim(), draftAxis)) {
      setDraftTopic('');
      setDraftField('');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: theme.bg }}>
      <TopBar title="Telemetry" icon={LineChart} />

      <div className="absolute inset-0 flex overflow-hidden" style={{ top: '3.5rem' }}>

        {/* ── Collapsible left panel ──────────────────────────────────────── */}
        <div
          className="flex-none overflow-hidden border-r transition-[width] duration-200 ease-in-out"
          style={{ width: panelOpen ? 252 : 0, background: 'var(--menu-bg)', borderColor: 'rgb(var(--fg-rgb) / 0.07)' }}
        >
          <div className="w-[252px] h-full flex flex-col overflow-y-auto p-3 gap-3 scrollbar-thin">

            {/* Controls */}
            <div className="flex gap-1.5">
              <button onClick={() => { recordingStartRef.current = Date.now(); setActive(true); }} disabled={active}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[11px] font-semibold transition-all disabled:opacity-40"
                style={{ background: active ? 'rgba(16,185,129,0.15)' : 'rgba(16,185,129,0.08)', border: `1px solid ${active ? 'rgba(16,185,129,0.4)' : 'rgba(16,185,129,0.2)'}`, color: '#10b981' }}
              >
                <Play className="w-3 h-3" /> Start
              </button>
              <button onClick={() => setActive(false)} disabled={!active}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-[11px] font-semibold transition-all disabled:opacity-40"
                style={{ background: 'rgba(244,63,94,0.08)', border: '1px solid rgba(244,63,94,0.2)', color: '#f43f5e' }}
              >
                <Square className="w-3 h-3" /> Stop
              </button>
              <button onClick={handleReset} title="Clear all"
                className="w-7 flex items-center justify-center rounded transition-all"
                style={{ background: 'rgb(var(--fg-rgb) / 0.04)', border: '1px solid rgb(var(--fg-rgb) / 0.08)', color: 'var(--menu-text-muted)' }}
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => chartRef.current && downloadCSV(chartRef.current, series)}
                disabled={series.length === 0} title="Download CSV"
                className="w-7 flex items-center justify-center rounded transition-all disabled:opacity-30"
                style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)', color: '#06b6d4' }}
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </div>

            <Divider />

            {/* Active series list */}
            <div className="flex flex-col gap-1.5">
              <SectionHeader
                label="Series"
                open={isSectionOpen('series')}
                onToggle={() => toggleSection('series')}
                suffix={series.length > 0 ? <span className="text-[9px] font-mono" style={{ color: 'var(--menu-text-dim)' }}>{series.length}</span> : undefined}
              />
              {isSectionOpen('series') && (
                <>
                  {series.length === 0 && (
                    <p className="text-[10px] text-center py-1" style={{ color: 'var(--menu-text-dim)' }}>No series added yet</p>
                  )}
                  {series.map((s) => (
                    <div key={s.id} className="flex items-center gap-1.5 rounded px-2 py-1.5"
                      style={{ background: 'rgb(var(--fg-rgb) / 0.04)', border: '1px solid rgb(var(--fg-rgb) / 0.07)' }}>
                      <label className="w-3 h-3 rounded-full shrink-0 cursor-pointer transition-all hover:scale-110"
                        style={{ background: s.color, outline: `2px solid ${s.color}40`, outlineOffset: 2 }}
                        title="Click to change colour"
                      >
                        <input type="color" value={s.color} onChange={(e) => updateColor(s.id, e.target.value)} className="sr-only" />
                      </label>
                      <span className="flex-1 text-[10px] font-mono truncate" style={{ color: 'var(--menu-text-muted)' }} title={s.label}>
                        {s.label}
                      </span>
                      <AxisBtn axis={s.axis} onClick={() => updateAxis(s.id, s.axis === 'y1' ? 'y2' : 'y1')} />
                      <button onClick={() => removeSeries(s.id)} title="Remove" className="opacity-40 hover:opacity-80 transition-opacity">
                        <X className="w-3 h-3 text-red-400" />
                      </button>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Blackboard keys */}
            {allTreeBlackboards.length > 0 && (
              <>
                <Divider />
                <div className="flex flex-col gap-2">
                  <SectionHeader
                    label="Blackboard"
                    open={isSectionOpen('blackboard')}
                    onToggle={() => toggleSection('blackboard')}
                  />
                  {isSectionOpen('blackboard') && (
                    <>
                      {allTreeBlackboards.map(({ treeId, blackboard, allKeys }) => {
                        const treeKey = `bb_tree_${treeId}`;
                        const treeOpen = isSectionOpen(treeKey);
                        const numericKeys = allKeys.filter((key) => typeof blackboard[key] !== 'string');
                        return (
                          <div key={treeId} className="flex flex-col gap-1">
                            {allTreeBlackboards.length > 1 ? (
                              <button
                                onClick={() => toggleSection(treeKey)}
                                className="flex items-center gap-1 w-full text-left"
                              >
                                <ChevronDown
                                  className="w-2.5 h-2.5 shrink-0 transition-transform duration-150"
                                  style={{ color: 'var(--menu-text-dim)', transform: treeOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                                />
                                <span className="text-[9px] font-mono truncate flex-1" style={{ color: 'var(--menu-text-dim)' }} title={treeId}>{treeId}</span>
                                <span className="text-[9px] font-mono" style={{ color: 'var(--menu-text-dim)' }}>{numericKeys.length}</span>
                              </button>
                            ) : null}
                            {(allTreeBlackboards.length === 1 || treeOpen) && numericKeys.map((key) => {
                              const added    = isbbActive(key, treeId);
                              const raw      = blackboard[key];
                              const hasValue = typeof raw === 'number' || typeof raw === 'boolean';
                              const valStr   = typeof raw === 'boolean' ? String(raw) : typeof raw === 'number' ? raw.toPrecision(4) : '—';
                              return (
                                <button key={key} disabled={atLimit && !added}
                                  onClick={() => !added && addBlackboardSeries(key, draftAxis, treeId)}
                                  className="flex items-center justify-between w-full px-2 py-1.5 rounded text-[10px] font-mono transition-all text-left"
                                  style={{
                                    opacity: atLimit && !added ? 0.4 : 1,
                                    cursor: added ? 'default' : atLimit ? 'not-allowed' : 'pointer',
                                    background: added ? 'rgba(6,182,212,0.1)' : 'rgb(var(--fg-rgb) / 0.04)',
                                    border: `1px solid ${added ? 'rgba(6,182,212,0.25)' : 'rgb(var(--fg-rgb) / 0.07)'}`,
                                    color: added ? '#06b6d4' : hasValue ? 'var(--menu-text-muted)' : 'rgb(var(--fg-rgb) / 0.35)',
                                  }}
                                  title={added ? 'Already charted' : hasValue ? `Add "${key}"` : `Add "${key}" — no live value yet`}
                                >
                                  <span>{key}</span>
                                  <span className="tabular-nums" style={{ color: hasValue ? 'var(--menu-text-dim)' : 'rgb(var(--fg-rgb) / 0.2)' }}>{valStr}</span>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                      {atLimit && <p className="text-[9px]" style={{ color: '#f59e0b' }}>Series limit ({MAX_SERIES}) reached</p>}
                    </>
                  )}
                </div>
              </>
            )}

            <Divider />

            {/* Y-axis range overrides */}
            <div className="flex flex-col gap-2">
              <SectionHeader label="Y Axes" open={isSectionOpen('yaxes')} onToggle={() => toggleSection('yaxes')} />
              {isSectionOpen('yaxes') && (['y1', 'y2'] as AxisSide[]).map((ax) => {
                const r       = axisRanges[ax];
                const isRight = ax === 'y2';
                const accent  = isRight ? '#f59e0b' : '#06b6d4';
                return (
                  <div key={ax} className="flex flex-col gap-1">
                    <p className="text-[9px] font-semibold" style={{ color: accent }}>
                      {isRight ? 'Right' : 'Left'} axis
                    </p>
                    <div className="flex gap-1.5 items-center">
                      <RangeInput placeholder="min (auto)" value={r.min} onChange={(v) => setAxisRange(ax, v, r.max)} />
                      <span className="text-[9px] shrink-0" style={{ color: 'var(--menu-text-dim)' }}>–</span>
                      <RangeInput placeholder="max (auto)" value={r.max} onChange={(v) => setAxisRange(ax, r.min, v)} />
                    </div>
                  </div>
                );
              })}
            </div>

            <Divider />

            {/* Add ROS topic */}
            <div className="flex flex-col gap-1.5">
              <SectionHeader
                label="ROS Topic"
                open={isSectionOpen('rostopic')}
                onToggle={() => toggleSection('rostopic')}
                suffix={atLimit ? <span className="text-[9px]" style={{ color: '#f59e0b' }}>limit</span> : undefined}
              />
              {isSectionOpen('rostopic') && (
                <>
                  <input type="text" value={draftTopic} onChange={(e) => setDraftTopic(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()} disabled={atLimit} placeholder="/topic/name"
                    className="w-full px-2 py-1 rounded text-[11px] font-mono outline-none disabled:opacity-40"
                    style={{ background: 'rgb(var(--fg-rgb) / 0.05)', border: '1px solid rgb(var(--fg-rgb) / 0.1)', color: 'var(--menu-text)' }}
                  />
                  <input type="text" value={draftField} onChange={(e) => setDraftField(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAdd()} disabled={atLimit} placeholder="field.dot.path (optional)"
                    className="w-full px-2 py-1 rounded text-[11px] font-mono outline-none disabled:opacity-40"
                    style={{ background: 'rgb(var(--fg-rgb) / 0.05)', border: '1px solid rgb(var(--fg-rgb) / 0.1)', color: 'var(--menu-text)' }}
                  />
                  <div className="flex gap-1.5">
                    {(['y1', 'y2'] as AxisSide[]).map((ax) => {
                      const right = ax === 'y2';
                      return (
                        <button key={ax} onClick={() => setDraftAxis(ax)}
                          className="flex-1 py-1 rounded text-[10px] font-bold transition-all"
                          style={{
                            background: draftAxis === ax ? right ? 'rgba(245,158,11,0.15)' : 'rgba(6,182,212,0.15)' : 'rgb(var(--fg-rgb) / 0.04)',
                            border: `1px solid ${draftAxis === ax ? right ? 'rgba(245,158,11,0.35)' : 'rgba(6,182,212,0.35)' : 'rgb(var(--fg-rgb) / 0.08)'}`,
                            color: draftAxis === ax ? right ? '#f59e0b' : '#06b6d4' : 'var(--menu-text-dim)',
                          }}
                        >
                          {right ? 'Right' : 'Left'}
                        </button>
                      );
                    })}
                    <button onClick={handleAdd} disabled={atLimit || !draftTopic.trim()}
                      className="w-8 flex items-center justify-center rounded transition-all disabled:opacity-30"
                      style={{ background: 'rgba(6,182,212,0.15)', border: '1px solid rgba(6,182,212,0.3)', color: '#06b6d4' }}
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              )}
            </div>

            <p className="text-[9px] leading-relaxed mt-auto" style={{ color: 'var(--menu-text-dim)' }}>
              Scroll to zoom · Drag to pan · Double-click for live view
            </p>

          </div>
        </div>

        {/* ── Panel toggle tab ──────────────────────────────────────────── */}
        <button
          onClick={() => setPanelOpen((o) => !o)}
          className="absolute z-20 flex items-center justify-center w-4 h-10 rounded-r transition-[left] duration-200 ease-in-out"
          style={{
            left: panelOpen ? 252 : 0, top: '50%', transform: 'translateY(-50%)',
            background: 'var(--menu-bg)', border: `1px solid rgb(var(--fg-rgb) / 0.1)`,
            borderLeft: 'none', color: 'var(--menu-text-muted)',
          }}
          title={panelOpen ? 'Collapse panel' : 'Expand panel'}
        >
          {panelOpen ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>

        {/* ── Chart area ────────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 p-3 pl-6">
          {series.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm" style={{ color: 'var(--page-text-dim)' }}>
                Add a series and press Start to begin recording
              </p>
            </div>
          ) : (
            <div className="flex-1 min-h-0 relative rounded overflow-hidden"
              style={{ background: 'rgb(var(--fg-rgb) / 0.02)' }}
              onDoubleClick={snapToLive}
            >
              <button onClick={snapToLive}
                className="absolute top-2 right-2 z-10 px-2 py-1 rounded text-[9px] font-bold tracking-wide transition-all"
                style={{ background: 'var(--menu-bg)', border: '1px solid rgba(6,182,212,0.3)', color: '#06b6d4', opacity: 0.75 }}
                title="Snap to live view (double-click chart)"
              >
                ↺ Live
              </button>

              <Line
                ref={chartRef}
                data={stableData.current}
                options={options}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
              />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
