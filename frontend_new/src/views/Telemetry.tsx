/**
 * Telemetry.tsx — uPlot canvas time-series chart.
 *
 * Sources:
 *  - ROS topics     → message_event frames, value by dot-path from payload
 *  - BT blackboard  → bt_blackboard frames, numeric keys grouped by tree
 *
 * Axes: Left (y1) / Right (y2) — independent scaling.
 *   • Auto-scale by default; override with per-axis min/max in the sidebar.
 *
 * Default view: last 10 minutes (live-scroll). Scroll/drag to zoom/pan.
 * Double-click snaps back to live 10-minute window.
 *
 * Grid colours are resolved from the active theme (not CSS var strings,
 * which don't work inside canvas context).
 */

import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart, Play, Square, RotateCcw, Plus, X, Download, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { TopBar } from '../components/TopBar';
import { useTheme } from '../hooks/useTheme';
import { useBtStore } from '../store/btStore';
import {
  useTelemetryStore,
  pushSample,
  getSeriesData,
  bbSeriesId,
  MAX_SERIES,
  type AxisSide,
  type AxisRange,
  type SeriesConfig,
} from '../store/telemetryStore';
import { subscribeToBridgeFrames, startBridgeConnection } from '../bridge/connection';
import type { MessageEvent } from '../types';

const LIVE_WINDOW_S = 600;   // default 10-minute x-axis

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

/** Convert "R G B" theme string to rgba(r,g,b,a) for canvas rendering. */
function fgRgba(fgRgb: string, alpha: number) {
  return `rgba(${fgRgb.replace(/ /g, ',')},${alpha})`;
}

function downloadCSV(series: SeriesConfig[]): void {
  if (series.length === 0) return;
  const datasets = series.map((s) => {
    const [ts, vs] = getSeriesData(s.id);
    return { label: s.label, ts, vs };
  });
  const rowMap = new Map<number, (number | undefined)[]>();
  datasets.forEach((d, si) => {
    for (let i = 0; i < d.ts.length; i++) {
      const t = d.ts[i];
      if (!rowMap.has(t)) rowMap.set(t, new Array(datasets.length).fill(undefined));
      rowMap.get(t)![si] = d.vs[i];
    }
  });
  const sortedTs = Array.from(rowMap.keys()).sort((a, b) => a - b);
  const header = `timestamp_unix_s,${datasets.map((d) => `"${d.label}"`).join(',')}`;
  const lines = sortedTs.map((t) =>
    `${t.toFixed(3)},${rowMap.get(t)!.map((v) => (v === undefined ? '' : v)).join(',')}`);
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `telemetry_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── uPlot builder (canvas colours from resolved theme, not CSS vars) ──────────

function buildOpts(
  series: SeriesConfig[],
  width: number,
  height: number,
  fgRgb: string,
  axisRanges: { y1: AxisRange; y2: AxisRange },
  onSetCursor: (u: uPlot) => void,
): uPlot.Options {
  const gridC  = fgRgba(fgRgb, 0.07);
  const tickC  = fgRgba(fgRgb, 0.15);
  const axisC  = fgRgba(fgRgb, 0.45);

  const makeScale = (r: AxisRange): uPlot.Scale => {
    if (r.min != null || r.max != null) {
      return {
        auto: false,
        range: (_u, dmin, dmax) => [r.min ?? dmin, r.max ?? dmax],
      };
    }
    return { auto: true };
  };

  return {
    width,
    height,
    series: [
      {},
      ...series.map((s) => ({ label: s.label, stroke: s.color, width: 1.5, scale: s.axis })),
    ],
    scales: { x: { time: true }, y1: makeScale(axisRanges.y1), y2: makeScale(axisRanges.y2) },
    axes: [
      { scale: 'x', stroke: axisC, ticks: { stroke: tickC }, grid: { stroke: gridC } },
      { scale: 'y1', side: 3, label: 'Left',  stroke: axisC, grid: { show: true, stroke: gridC }, ticks: { stroke: tickC } },
      { scale: 'y2', side: 1, label: 'Right', stroke: axisC, grid: { show: false }, ticks: { stroke: tickC } },
    ],
    select: { show: false, left: 0, top: 0, width: 0, height: 0 },
    cursor: { drag: { x: false, y: false }, sync: { key: 'telem' } },
    hooks: { setCursor: [onSetCursor] },
  };
}

// ── Cursor tooltip (direct DOM, no re-renders) ────────────────────────────────

function updateTooltip(
  u: uPlot,
  tip: HTMLDivElement | null,
  container: HTMLDivElement | null,
  series: SeriesConfig[],
) {
  if (!tip || !container) return;
  const idx  = u.cursor.idx;
  const left = u.cursor.left ?? -1;
  if (idx == null || left < 0) { tip.style.display = 'none'; return; }
  const t = (u.data[0] as number[])?.[idx];
  if (t == null) { tip.style.display = 'none'; return; }

  const d = new Date(t * 1000);
  const timeStr = d.toISOString().slice(11, 23);
  let html = `<div style="font-size:9px;color:var(--menu-text-muted);margin-bottom:4px;font-family:monospace">${timeStr}</div>`;
  for (let i = 0; i < series.length; i++) {
    const v = (u.data[i + 1] as number[])?.[idx];
    const s = series[i];
    const vStr = v == null || isNaN(v) ? '—'
      : Math.abs(v) >= 1000 || (Math.abs(v) < 0.001 && v !== 0) ? v.toExponential(3)
      : v.toPrecision(5);
    html += `<div style="display:flex;align-items:center;gap:5px;margin-top:2px">
      <span style="width:7px;height:7px;border-radius:50%;background:${s.color};flex-shrink:0"></span>
      <span style="font-size:9px;color:var(--menu-text-muted);font-family:monospace;white-space:nowrap">${s.label}</span>
      <span style="font-size:10px;font-family:monospace;font-weight:700;color:${s.color};margin-left:auto;padding-left:8px">${vStr}</span>
    </div>`;
  }
  tip.innerHTML = html;

  const plotLeft = u.bbox.left / window.devicePixelRatio;
  const tipW    = tip.offsetWidth;
  const gap     = 14;
  const absLeft = plotLeft + left;
  tip.style.left    = (absLeft + gap + tipW > container.clientWidth)
    ? `${absLeft - gap - tipW}px` : `${absLeft + gap}px`;
  tip.style.display = 'block';
}

// ── NaN-pad shorter series so uPlot always gets equal-length arrays ───────────
// Always use series[0] as the x-axis (stable across renders regardless of
// which series has the most samples).

function buildAlignedData(snap: SeriesConfig[]): uPlot.AlignedData {
  const empty = () => new Float64Array(0);
  if (snap.length === 0) return [empty()];
  const [ts0] = getSeriesData(snap[0].id);
  const n = ts0.length;
  // When there is no data yet (series just added), return correctly-sized empty arrays
  // so uPlot gets one array per slot rather than a truncated list.
  if (n === 0) return [empty(), ...snap.map(empty)] as uPlot.AlignedData;
  const aligned: Float64Array[] = [ts0];
  for (const s of snap) {
    const [, vs] = getSeriesData(s.id);
    if (vs.length >= n) {
      aligned.push(vs.length === n ? vs : vs.subarray(vs.length - n));
    } else {
      const padded = new Float64Array(n).fill(NaN);
      if (vs.length > 0) padded.set(vs, n - vs.length);
      aligned.push(padded);
    }
  }
  return aligned as uPlot.AlignedData;
}

// ── Small reusable bits ───────────────────────────────────────────────────────

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

// ── Axis range number input ───────────────────────────────────────────────────

function RangeInput({
  placeholder, value, onChange,
}: {
  placeholder: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <input
      type="number"
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : parseFloat(e.target.value))}
      className="flex-1 min-w-0 px-2 py-1 rounded text-[10px] font-mono outline-none"
      style={{
        background: 'rgb(var(--fg-rgb) / 0.05)',
        border: '1px solid rgb(var(--fg-rgb) / 0.1)',
        color: 'var(--menu-text)',
      }}
    />
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function Telemetry() {
  const { theme } = useTheme();

  const {
    series, active, axisRanges,
    addSeries, addBlackboardSeries, removeSeries, updateAxis, updateColor,
    setAxisRange, setActive, reset,
  } = useTelemetryStore();

  // Blackboard per-tree, stable reference with useShallow to avoid re-render loops.
  const rawTreeBlackboards = useBtStore(
    useShallow((s) =>
      Object.fromEntries(
        Object.entries(s.trees).map(([id, tree]) => [id, tree.blackboard]),
      ),
    ),
  );
  const allTreeBlackboards = useMemo(
    () =>
      Object.entries(rawTreeBlackboards)
        .map(([treeId, blackboard]) => ({
          treeId,
          blackboard,
          numericKeys: Object.entries(blackboard)
            .filter(([, v]) => typeof v === 'number')
            .map(([k]) => k)
            .sort(),
        }))
        .filter((t) => t.numericKeys.length > 0),
    [rawTreeBlackboards],
  );

  const [panelOpen,  setPanelOpen]  = useState(true);
  const [draftTopic, setDraftTopic] = useState('');
  const [draftField, setDraftField] = useState('');
  const [draftAxis,  setDraftAxis]  = useState<AxisSide>('y1');

  const chartRef          = useRef<HTMLDivElement>(null);
  const tooltipRef        = useRef<HTMLDivElement>(null);
  const uplotRef          = useRef<uPlot | null>(null);
  const seriesSnap        = useRef(series);
  seriesSnap.current      = series;
  // True once user has manually zoomed/panned; reset by Live button or double-click.
  const userZoomedRef     = useRef(false);
  const panRef            = useRef<{ startX: number; startMin: number; startMax: number } | null>(null);
  // Wall-clock second when recording started — drives the "start-anchored" live window.
  // This ref is intentionally reset to null on every mount so that on remount we
  // reconstruct t0 from ring-buffer data rather than blindly using "now".
  const recordingStartRef = useRef<number | null>(null);

  // Returns the recording-start anchor, computing it once from existing ring-buffer
  // data if the ref is still null (e.g. after navigating away and back).
  const resolveT0 = (snap: SeriesConfig[]): number => {
    if (recordingStartRef.current !== null) return recordingStartRef.current;
    const now = Date.now() / 1000;
    let earliest = now;
    for (const s of snap) {
      const [ts] = getSeriesData(s.id);
      if (ts.length > 0 && ts[0] < earliest) earliest = ts[0];
    }
    recordingStartRef.current = earliest;
    return earliest;
  };

  const snapToLive = () => {
    userZoomedRef.current = false;
    const u = uplotRef.current;
    if (!u) return;
    const now = Date.now() / 1000;
    const t0  = resolveT0(seriesSnap.current);
    const end = Math.max(now, t0 + LIVE_WINDOW_S);
    u.setScale('x', { min: end - LIVE_WINDOW_S, max: end });
  };

  // ── Build / tear down uPlot (also when theme or axis ranges change) ───────
  useEffect(() => {
    const container = chartRef.current;
    if (!container) return;

    uplotRef.current?.destroy();
    uplotRef.current = null;
    if (series.length === 0) return;

    const w    = Math.max(container.clientWidth, 100);
    const h    = Math.max(container.clientHeight, 80);
    const snap  = seriesSnap.current;
    const tipEl = tooltipRef.current;

    uplotRef.current = new uPlot(
      buildOpts(series, w, h, theme.fgRgb, axisRanges, (u) => updateTooltip(u, tipEl, container, snap)),
      [new Float64Array(0), ...series.map(() => new Float64Array(0))],
      container,
    );

    // Scroll wheel = zoom centred on cursor.
    // uPlot initialises cursor.left = -10 (not null), so we must explicitly
    // check bounds — the ?? fallback won't fire for -10.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const u = uplotRef.current;
      if (!u) return;
      const { min, max } = u.scales.x;
      if (min == null || max == null) return;
      userZoomedRef.current = true;
      const factor   = e.deltaY > 0 ? 1.3 : 0.77;
      const rawLeft  = u.cursor.left;
      const anchorPx = (rawLeft != null && rawLeft >= 0 && rawLeft <= u.width)
        ? rawLeft : u.width / 2;
      const cursorT  = u.posToVal(anchorPx, 'x');
      const newMin   = cursorT - (cursorT - min) * factor;
      const newMax   = cursorT + (max - cursorT) * factor;
      if (newMax - newMin < 0.5) return; // don't zoom in past 0.5 s
      u.setScale('x', { min: newMin, max: newMax });
    };

    // Left drag = pan.
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const u = uplotRef.current;
      if (!u) return;
      const { min, max } = u.scales.x;
      if (min == null || max == null) return;
      panRef.current = { startX: e.clientX, startMin: min, startMax: max };
    };
    const onMouseMove = (e: MouseEvent) => {
      const pan = panRef.current;
      if (!pan) return;
      const u = uplotRef.current;
      if (!u) return;
      userZoomedRef.current = true;
      const secPerPx = (pan.startMax - pan.startMin) / u.width;
      const shift    = -(e.clientX - pan.startX) * secPerPx;
      u.setScale('x', { min: pan.startMin + shift, max: pan.startMax + shift });
    };
    const onMouseUp  = () => { panRef.current = null; };

    // Double-click = snap back to live window.
    const onDblClick = () => snapToLive();

    container.addEventListener('wheel',     onWheel,     { passive: false });
    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseup',   onMouseUp);
    container.addEventListener('dblclick',  onDblClick);

    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      uplotRef.current?.setSize({ width: Math.max(Math.round(width), 100), height: Math.max(Math.round(height), 80) });
    });
    ro.observe(container);

    return () => {
      container.removeEventListener('wheel',     onWheel);
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('mouseup',   onMouseUp);
      container.removeEventListener('dblclick',  onDblClick);
      ro.disconnect();
      uplotRef.current?.destroy();
      uplotRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    series.map((s) => `${s.id}:${s.axis}:${s.color}`).join(','),
    theme.fgRgb,
    axisRanges.y1.min, axisRanges.y1.max, axisRanges.y2.min, axisRanges.y2.max,
  ]);

  // ── 10 Hz chart refresh + live-window scroll ──────────────────────────────
  useEffect(() => {
    if (!active || series.length === 0) return;
    const interval = setInterval(() => {
      const u = uplotRef.current;
      if (!u) return;
      const snap = seriesSnap.current;
      if (!snap.length) return;
      // seriesSnap updates on every render; uPlot rebuilds asynchronously in the
      // next effect run.  Skip this tick if the counts don't match yet — otherwise
      // setData receives the wrong number of arrays and uPlot crashes.
      if (u.series.length - 1 !== snap.length) return;

      u.setData(buildAlignedData(snap), false);

      // Keep x-axis on a live window unless user has zoomed/panned.
      // For the first LIVE_WINDOW_S seconds, anchor the left edge at
      // recording start so the chart fills left-to-right rather than
      // appearing pre-filled with empty space.
      if (!userZoomedRef.current) {
        const now = Date.now() / 1000;
        const t0  = resolveT0(snap);
        const end = Math.max(now, t0 + LIVE_WINDOW_S);
        u.setScale('x', { min: end - LIVE_WINDOW_S, max: end });
      }
    }, 100);
    return () => clearInterval(interval);
  }, [active, series.length]);

  // ── Bridge subscriptions ──────────────────────────────────────────────────
  useEffect(() => {
    startBridgeConnection();
    const unsub = subscribeToBridgeFrames(({ frame }) => {
      if (!useTelemetryStore.getState().active) return;
      const snap = seriesSnap.current;
      if (frame.type === 'message_event') {
        const ev = frame.data as MessageEvent;
        for (const s of snap) {
          if (s.source !== 'topic' || s.topic !== ev.topic) continue;
          const val = resolvePath(ev.payload, s.field);
          if (val !== null) pushSample(s.id, ev.timestamp, val);
        }
      } else if (frame.type === 'bt_blackboard') {
        const ev = frame.data as { vars: Record<string, unknown> };
        const now = frame.timestamp ?? Date.now() / 1000;
        for (const s of snap) {
          if (s.source !== 'blackboard') continue;
          const val = ev.vars[s.field];
          if (typeof val === 'number') pushSample(s.id, now, val);
        }
      }
    });
    return unsub;
  }, []);

  const handleStart = () => {
    // Don't pre-set recordingStartRef here — resolveT0() will compute it from
    // ring-buffer data on the first interval tick, which correctly handles both
    // fresh recordings (no data → t0 = now) and resume-after-navigation
    // (existing data → t0 = earliest ring-buffer timestamp).
    setActive(true);
  };

  const handleReset = () => {
    recordingStartRef.current = null;
    userZoomedRef.current     = false;
    reset();
  };

  const atLimit    = series.length >= MAX_SERIES;
  const isbbActive = (key: string) => series.some((s) => s.id === bbSeriesId(key));

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

            {/* Controls row */}
            <div className="flex gap-1.5">
              <button onClick={handleStart} disabled={active}
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
              <button onClick={() => downloadCSV(series)} disabled={series.length === 0} title="Download CSV"
                className="w-7 flex items-center justify-center rounded transition-all disabled:opacity-30"
                style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.2)', color: '#06b6d4' }}
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            </div>

            <Divider />

            {/* Active series list */}
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--menu-text-dim)' }}>Series</p>
              {series.length === 0 && (
                <p className="text-[10px] text-center py-1" style={{ color: 'var(--menu-text-dim)' }}>No series added yet</p>
              )}
              {series.map((s) => (
                <div key={s.id} className="flex items-center gap-1.5 rounded px-2 py-1.5"
                  style={{ background: 'rgb(var(--fg-rgb) / 0.04)', border: '1px solid rgb(var(--fg-rgb) / 0.07)' }}>
                  {/* Colour swatch — click to open native colour picker */}
                  <label
                    className="w-3 h-3 rounded-full shrink-0 cursor-pointer transition-all hover:scale-110"
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
            </div>

            {/* Blackboard — grouped by tree, one key per line */}
            {allTreeBlackboards.length > 0 && (
              <>
                <Divider />
                <div className="flex flex-col gap-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--menu-text-dim)' }}>Blackboard</p>
                  {allTreeBlackboards.map(({ treeId, blackboard, numericKeys }) => (
                    <div key={treeId} className="flex flex-col gap-1">
                      {allTreeBlackboards.length > 1 && (
                        <p className="text-[9px] font-mono px-0.5 truncate" style={{ color: 'var(--menu-text-dim)' }} title={treeId}>{treeId}</p>
                      )}
                      {numericKeys.map((key) => {
                        const added = isbbActive(key);
                        const val   = blackboard[key] as number;
                        return (
                          <button
                            key={key}
                            disabled={atLimit || added}
                            onClick={() => addBlackboardSeries(key, draftAxis)}
                            className="flex items-center justify-between w-full px-2 py-1.5 rounded text-[10px] font-mono transition-all text-left"
                            style={{
                              opacity: atLimit && !added ? 0.4 : 1,
                              cursor: added ? 'default' : atLimit ? 'not-allowed' : 'pointer',
                              background: added ? 'rgba(6,182,212,0.1)' : 'rgb(var(--fg-rgb) / 0.04)',
                              border: `1px solid ${added ? 'rgba(6,182,212,0.25)' : 'rgb(var(--fg-rgb) / 0.07)'}`,
                              color: added ? '#06b6d4' : 'var(--menu-text-muted)',
                            }}
                            title={added ? 'Already charted' : `Add "${key}"`}
                          >
                            <span>{key}</span>
                            <span className="tabular-nums" style={{ color: 'var(--menu-text-dim)' }}>{val.toPrecision(4)}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                  {atLimit && <p className="text-[9px]" style={{ color: '#f59e0b' }}>Series limit ({MAX_SERIES}) reached</p>}
                </div>
              </>
            )}

            <Divider />

            {/* Y-axis range overrides */}
            <div className="flex flex-col gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--menu-text-dim)' }}>Y Axes</p>
              {(['y1', 'y2'] as AxisSide[]).map((ax) => {
                const r = axisRanges[ax];
                const isRight = ax === 'y2';
                const accentColor = isRight ? '#f59e0b' : '#06b6d4';
                return (
                  <div key={ax} className="flex flex-col gap-1">
                    <p className="text-[9px] font-semibold" style={{ color: accentColor }}>
                      {isRight ? 'Right' : 'Left'} axis
                    </p>
                    <div className="flex gap-1.5 items-center">
                      <RangeInput
                        placeholder="min (auto)"
                        value={r.min}
                        onChange={(v) => setAxisRange(ax, v, r.max)}
                      />
                      <span className="text-[9px] shrink-0" style={{ color: 'var(--menu-text-dim)' }}>–</span>
                      <RangeInput
                        placeholder="max (auto)"
                        value={r.max}
                        onChange={(v) => setAxisRange(ax, r.min, v)}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <Divider />

            {/* Add ROS topic */}
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--menu-text-dim)' }}>
                ROS Topic {atLimit && <span style={{ color: '#f59e0b' }}>(limit reached)</span>}
              </p>
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
            left: panelOpen ? 252 : 0,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'var(--menu-bg)',
            border: `1px solid rgb(var(--fg-rgb) / 0.1)`,
            borderLeft: 'none',
            color: 'var(--menu-text-muted)',
          }}
          title={panelOpen ? 'Collapse panel' : 'Expand panel'}
        >
          {panelOpen ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>

        {/* ── Chart area ───────────────────────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 p-3 pl-6">
          {series.length === 0 ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm" style={{ color: 'var(--page-text-dim)' }}>
                Add a series and press Start to begin recording
              </p>
            </div>
          ) : (
            <div ref={chartRef} className="flex-1 min-h-0 rounded overflow-hidden relative"
              style={{ background: 'rgb(var(--fg-rgb) / 0.02)', cursor: 'crosshair' }}
            >
              {/* Live / reset-view button */}
              <button
                onClick={snapToLive}
                className="absolute top-2 right-2 z-10 px-2 py-1 rounded text-[9px] font-bold tracking-wide transition-all"
                style={{
                  background: 'var(--menu-bg)',
                  border: '1px solid rgba(6,182,212,0.3)',
                  color: '#06b6d4',
                  opacity: 0.75,
                }}
                title="Snap to live view (double-click chart)"
              >
                ↺ Live
              </button>

              <div ref={tooltipRef} className="absolute top-3 z-10 pointer-events-none rounded-lg px-3 py-2"
                style={{
                  display: 'none',
                  background: 'var(--menu-bg-solid, rgba(10,20,35,0.95))',
                  border: '1px solid rgb(var(--fg-rgb) / 0.1)',
                  backdropFilter: 'blur(8px)',
                  minWidth: 160,
                  color: 'var(--menu-text)',
                }}
              />
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
