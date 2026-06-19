/**
 * telemetryStore.ts — Zustand store for the Telemetry tab.
 *
 * Series config (label, color, axis) lives here. Chart data is owned
 * entirely by the Chart.js instance and managed imperatively via chartRef —
 * no ring buffers, no polling interval for data alignment.
 */

import { create } from 'zustand';

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
  treeId?: string; // blackboard series only — filters events to this tree
}

export const BB_PREFIX = '__bb__';

export function bbSeriesId(key: string, treeId?: string) {
  return treeId ? `${BB_PREFIX}|${treeId}|${key}` : `${BB_PREFIX}|${key}`;
}

const SERIES_COLORS = [
  '#06b6d4', '#f59e0b', '#10b981', '#f43f5e', '#a78bfa',
  '#fb923c', '#34d399', '#60a5fa', '#e879f9', '#fbbf24',
];

interface TelemetryState {
  series: SeriesConfig[];
  active: boolean;
  axisRanges: { y1: AxisRange; y2: AxisRange };

  addSeries: (topic: string, field: string, axis?: AxisSide) => boolean;
  addBlackboardSeries: (key: string, axis?: AxisSide, treeId?: string) => boolean;
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
    set({ series: [...series, { id, topic, field, axis, label, color, source: 'topic' }] });
    return true;
  },

  addBlackboardSeries(key, axis = 'y1', treeId?: string) {
    const { series } = get();
    if (series.length >= MAX_SERIES) return false;
    const id = bbSeriesId(key, treeId);
    if (series.find((s) => s.id === id)) return false;
    const color = SERIES_COLORS[series.length % SERIES_COLORS.length];
    const label = treeId ? `${treeId} › ${key}` : `bb: ${key}`;
    set({
      series: [
        ...series,
        { id, topic: BB_PREFIX, field: key, axis, label, color, source: 'blackboard', treeId },
      ],
    });
    return true;
  },

  removeSeries(id) {
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
    set({ active: false, series: [], axisRanges: { y1: { min: null, max: null }, y2: { min: null, max: null } } });
  },
}));
