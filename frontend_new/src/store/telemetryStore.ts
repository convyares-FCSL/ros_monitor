/**
 * telemetryStore.ts — Zustand store for the Telemetry tab.
 *
 * Ring buffers live as module-level Float64Arrays (not in Zustand) so that
 * pushSample() never triggers a React re-render. The chart component polls
 * them directly at 10 Hz via setInterval and calls uPlot.setData().
 *
 * Two data sources:
 *  - source='topic'     → fed by message_event frames (topic + dot-path field)
 *  - source='blackboard' → fed by bt_blackboard frames (key name); id = '__bb__|<key>'
 */

import { create } from 'zustand';

export const CAPACITY   = 36_000;   // 1 hour @ 10 Hz
export const MAX_SERIES = 10;

export type AxisSide = 'y1' | 'y2';

export interface AxisRange {
  min: number | null;
  max: number | null;
}
export type SeriesSource = 'topic' | 'blackboard';

export interface SeriesConfig {
  id: string;
  topic: string;
  field: string;
  axis: AxisSide;
  label: string;
  color: string;
  source: SeriesSource;
}

export const BB_PREFIX = '__bb__';

export function bbSeriesId(key: string) {
  return `${BB_PREFIX}|${key}`;
}

// ── Module-level ring buffers (outside Zustand, no re-render on push) ────────

const _tBufs: Record<string, Float64Array> = {};
const _vBufs: Record<string, Float64Array> = {};
const _head:  Record<string, number>       = {};
const _count: Record<string, number>       = {};

function _ensureBuf(id: string) {
  if (!(id in _tBufs)) {
    _tBufs[id] = new Float64Array(CAPACITY);
    _vBufs[id] = new Float64Array(CAPACITY);
    _head[id]  = 0;
    _count[id] = 0;
  }
}

function _clearBuf(id: string) {
  if (id in _tBufs) {
    _tBufs[id].fill(0);
    _vBufs[id].fill(0);
    _head[id]  = 0;
    _count[id] = 0;
  }
}

/** Push one sample into the ring buffer for the given series id. */
export function pushSample(id: string, t: number, v: number) {
  _ensureBuf(id);
  const h = _head[id];
  _tBufs[id][h] = t;
  _vBufs[id][h] = v;
  _head[id] = (h + 1) % CAPACITY;
  if (_count[id] < CAPACITY) _count[id]++;
}

/**
 * Return [timestamps, values] in chronological order for uPlot.
 * uPlot expects parallel typed arrays; we unroll the ring to provide that.
 */
export function getSeriesData(id: string): [Float64Array, Float64Array] {
  _ensureBuf(id);
  const n = _count[id];
  if (n === 0) return [new Float64Array(0), new Float64Array(0)];

  const t = _tBufs[id];
  const v = _vBufs[id];
  const h = _head[id];

  if (n < CAPACITY) {
    return [t.slice(0, n), v.slice(0, n)];
  }
  const ts = new Float64Array(CAPACITY);
  const vs = new Float64Array(CAPACITY);
  const tail = CAPACITY - h;
  ts.set(t.subarray(h), 0);
  ts.set(t.subarray(0, h), tail);
  vs.set(v.subarray(h), 0);
  vs.set(v.subarray(0, h), tail);
  return [ts, vs];
}

// ── Zustand: tracks series config + active state only ─────────────────────────

const SERIES_COLORS = [
  '#06b6d4', '#f59e0b', '#10b981', '#f43f5e', '#a78bfa',
  '#fb923c', '#34d399', '#60a5fa', '#e879f9', '#fbbf24',
];

interface TelemetryState {
  series: SeriesConfig[];
  active: boolean;
  axisRanges: { y1: AxisRange; y2: AxisRange };

  addSeries: (topic: string, field: string, axis?: AxisSide) => boolean;
  addBlackboardSeries: (key: string, axis?: AxisSide) => boolean;
  removeSeries: (id: string) => void;
  updateAxis: (id: string, axis: AxisSide) => void;
  updateColor: (id: string, color: string) => void;
  setAxisRange: (axis: AxisSide, min: number | null, max: number | null) => void;
  setActive: (active: boolean) => void;
  reset: () => void;
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  series: [],
  active: false,
  axisRanges: { y1: { min: null, max: null }, y2: { min: null, max: null } },

  addSeries(topic, field, axis = 'y1') {
    const { series } = get();
    if (series.length >= MAX_SERIES) return false;
    const id = `${topic}|${field}`;
    if (series.find((s) => s.id === id)) return false;
    const color = SERIES_COLORS[series.length % SERIES_COLORS.length];
    const label = field ? `${topic} › ${field}` : topic;
    _ensureBuf(id);
    set({ series: [...series, { id, topic, field, axis, label, color, source: 'topic' }] });
    return true;
  },

  addBlackboardSeries(key, axis = 'y1') {
    const { series } = get();
    if (series.length >= MAX_SERIES) return false;
    const id = bbSeriesId(key);
    if (series.find((s) => s.id === id)) return false;
    const color = SERIES_COLORS[series.length % SERIES_COLORS.length];
    _ensureBuf(id);
    set({
      series: [
        ...series,
        { id, topic: BB_PREFIX, field: key, axis, label: `bb: ${key}`, color, source: 'blackboard' },
      ],
    });
    return true;
  },

  removeSeries(id) {
    _clearBuf(id);
    set((s) => ({ series: s.series.filter((x) => x.id !== id) }));
  },

  updateAxis(id, axis) {
    set((s) => ({ series: s.series.map((x) => (x.id === id ? { ...x, axis } : x)) }));
  },

  updateColor(id, color) {
    set((s) => ({ series: s.series.map((x) => (x.id === id ? { ...x, color } : x)) }));
  },

  setAxisRange(axis, min, max) {
    set((s) => ({ axisRanges: { ...s.axisRanges, [axis]: { min, max } } }));
  },

  setActive(active) {
    set({ active });
  },

  reset() {
    const { series } = get();
    for (const s of series) _clearBuf(s.id);
    set({ active: false, series: [], axisRanges: { y1: { min: null, max: null }, y2: { min: null, max: null } } });
  },
}));
