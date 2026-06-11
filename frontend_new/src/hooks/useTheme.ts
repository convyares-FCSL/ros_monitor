import { createContext, useContext, useState, useCallback } from 'react';

export type ThemeId = 'midnight' | 'arctic' | 'ember' | 'forest' | 'light' | 'dark' | 'custom';

export interface Theme {
  id: ThemeId;
  label: string;
  bg: string;
  bgScene: number;
  fog: number;
  panelBg: string;
  panelBorder: string;
  headerBg: string;
  accent: string;
  accentHex: string;
  text: string;
  textMuted: string;
  textDim: string;
  emissiveIntensity: number;
  nodeColor: number;
  nodeColorHex: string;
  nodeCss: string;
  topicColor: number;
  topicColorHex: string;
  topicCss: string;
  serviceColor: number;
  serviceColorHex: string;
  serviceCss: string;
  actionColor: number;
  actionColorHex: string;
  actionCss: string;
}

export interface CustomColors {
  menuBg: string;
  sceneBg: string;
  node: string;
  topic: string;
  service: string;
  action: string;
  emissive: number;
}

const DEFAULT_CUSTOM_COLORS: CustomColors = {
  menuBg: '#0f172a',
  sceneBg: '#030712',
  node: '#06b6d4',
  topic: '#f97316',
  service: '#10b981',
  action: '#a855f7',
  emissive: 0.45,
};

function hexToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

function buildCustomTheme(colors: CustomColors): Theme {
  return {
    id: 'custom',
    label: 'Custom',
    bg: colors.sceneBg,
    bgScene: hexToInt(colors.sceneBg),
    fog: hexToInt(colors.sceneBg),
    panelBg: `${colors.menuBg}e0`,
    panelBorder: `${colors.node}22`,
    headerBg: `${colors.menuBg}e6`,
    accent: 'text-white',
    accentHex: colors.node,
    text: 'text-white',
    textMuted: 'text-white/60',
    textDim: 'text-white/30',
    emissiveIntensity: colors.emissive,
    nodeColor: hexToInt(colors.node),
    nodeColorHex: colors.node,
    nodeCss: 'text-white',
    topicColor: hexToInt(colors.topic),
    topicColorHex: colors.topic,
    topicCss: 'text-white',
    serviceColor: hexToInt(colors.service),
    serviceColorHex: colors.service,
    serviceCss: 'text-white',
    actionColor: hexToInt(colors.action),
    actionColorHex: colors.action,
    actionCss: 'text-white',
  };
}

export const THEMES: Record<Exclude<ThemeId, 'custom'>, Theme> = {
  midnight: {
    id: 'midnight',
    label: 'Midnight',
    bg: '#030712',
    bgScene: 0x030712,
    fog: 0x030712,
    panelBg: 'rgba(15,23,42,0.82)',
    panelBorder: 'rgba(255,255,255,0.07)',
    headerBg: 'rgba(3,7,18,0.85)',
    accent: 'text-cyan-400',
    accentHex: '#22d3ee',
    text: 'text-white',
    textMuted: 'text-white/60',
    textDim: 'text-white/30',
    emissiveIntensity: 0.45,
    nodeColor: 0x06b6d4,
    nodeColorHex: '#06b6d4',
    nodeCss: 'text-cyan-400',
    topicColor: 0xf97316,
    topicColorHex: '#f97316',
    topicCss: 'text-orange-400',
    serviceColor: 0x10b981,
    serviceColorHex: '#10b981',
    serviceCss: 'text-emerald-400',
    actionColor: 0xa855f7,
    actionColorHex: '#a855f7',
    actionCss: 'text-purple-400',
  },
  arctic: {
    id: 'arctic',
    label: 'Arctic',
    bg: '#0c1929',
    bgScene: 0x0c1929,
    fog: 0x0c1929,
    panelBg: 'rgba(12,25,41,0.88)',
    panelBorder: 'rgba(56,189,248,0.1)',
    headerBg: 'rgba(12,25,41,0.9)',
    accent: 'text-sky-400',
    accentHex: '#38bdf8',
    text: 'text-white',
    textMuted: 'text-sky-100/60',
    textDim: 'text-sky-200/25',
    emissiveIntensity: 0.45,
    nodeColor: 0x38bdf8,
    nodeColorHex: '#38bdf8',
    nodeCss: 'text-sky-400',
    topicColor: 0x818cf8,
    topicColorHex: '#818cf8',
    topicCss: 'text-indigo-400',
    serviceColor: 0x2dd4bf,
    serviceColorHex: '#2dd4bf',
    serviceCss: 'text-teal-400',
    actionColor: 0xf472b6,
    actionColorHex: '#f472b6',
    actionCss: 'text-pink-400',
  },
  ember: {
    id: 'ember',
    label: 'Ember',
    bg: '#110805',
    bgScene: 0x110805,
    fog: 0x110805,
    panelBg: 'rgba(24,12,8,0.88)',
    panelBorder: 'rgba(249,115,22,0.12)',
    headerBg: 'rgba(17,8,5,0.9)',
    accent: 'text-orange-400',
    accentHex: '#fb923c',
    text: 'text-white',
    textMuted: 'text-orange-100/60',
    textDim: 'text-orange-200/25',
    emissiveIntensity: 0.5,
    nodeColor: 0xfb923c,
    nodeColorHex: '#fb923c',
    nodeCss: 'text-orange-400',
    topicColor: 0xfbbf24,
    topicColorHex: '#fbbf24',
    topicCss: 'text-amber-400',
    serviceColor: 0xf87171,
    serviceColorHex: '#f87171',
    serviceCss: 'text-red-400',
    actionColor: 0xfb7185,
    actionColorHex: '#fb7185',
    actionCss: 'text-rose-400',
  },
  forest: {
    id: 'forest',
    label: 'Forest',
    bg: '#05120a',
    bgScene: 0x05120a,
    fog: 0x05120a,
    panelBg: 'rgba(8,24,14,0.88)',
    panelBorder: 'rgba(16,185,129,0.1)',
    headerBg: 'rgba(5,18,10,0.9)',
    accent: 'text-emerald-400',
    accentHex: '#34d399',
    text: 'text-white',
    textMuted: 'text-emerald-100/60',
    textDim: 'text-emerald-200/25',
    emissiveIntensity: 0.4,
    nodeColor: 0x34d399,
    nodeColorHex: '#34d399',
    nodeCss: 'text-emerald-400',
    topicColor: 0xa3e635,
    topicColorHex: '#a3e635',
    topicCss: 'text-lime-400',
    serviceColor: 0x4ade80,
    serviceColorHex: '#4ade80',
    serviceCss: 'text-green-400',
    actionColor: 0x22d3ee,
    actionColorHex: '#22d3ee',
    actionCss: 'text-cyan-400',
  },
  dark: {
    id: 'dark',
    label: 'Dark',
    bg: '#111111',
    bgScene: 0x111111,
    fog: 0x111111,
    panelBg: 'rgba(24,24,24,0.92)',
    panelBorder: 'rgba(255,255,255,0.08)',
    headerBg: 'rgba(17,17,17,0.92)',
    accent: 'text-white',
    accentHex: '#e5e5e5',
    text: 'text-white',
    textMuted: 'text-white/60',
    textDim: 'text-white/25',
    emissiveIntensity: 0.5,
    nodeColor: 0x60a5fa,
    nodeColorHex: '#60a5fa',
    nodeCss: 'text-blue-400',
    topicColor: 0xfbbf24,
    topicColorHex: '#fbbf24',
    topicCss: 'text-amber-400',
    serviceColor: 0x34d399,
    serviceColorHex: '#34d399',
    serviceCss: 'text-emerald-400',
    actionColor: 0xf472b6,
    actionColorHex: '#f472b6',
    actionCss: 'text-pink-400',
  },
  light: {
    id: 'light',
    label: 'Light',
    bg: '#f8fafc',
    bgScene: 0xf8fafc,
    fog: 0xf8fafc,
    panelBg: 'rgba(15,23,42,0.88)',
    panelBorder: 'rgba(0,0,0,0.12)',
    headerBg: 'rgba(15,23,42,0.92)',
    accent: 'text-slate-800',
    accentHex: '#1e293b',
    text: 'text-white',
    textMuted: 'text-white/60',
    textDim: 'text-white/30',
    emissiveIntensity: 0.2,
    nodeColor: 0x2563eb,
    nodeColorHex: '#2563eb',
    nodeCss: 'text-blue-600',
    topicColor: 0xd97706,
    topicColorHex: '#d97706',
    topicCss: 'text-amber-600',
    serviceColor: 0x059669,
    serviceColorHex: '#059669',
    serviceCss: 'text-emerald-600',
    actionColor: 0x9333ea,
    actionColorHex: '#9333ea',
    actionCss: 'text-purple-600',
  },
};

export interface ThemeContextValue {
  theme: Theme;
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
  customColors: CustomColors;
  setCustomColors: (colors: CustomColors) => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: THEMES.midnight,
  themeId: 'midnight',
  setThemeId: () => {},
  customColors: DEFAULT_CUSTOM_COLORS,
  setCustomColors: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

function loadCustomColors(): CustomColors {
  try {
    const saved = localStorage.getItem('ros3d-custom-colors');
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return DEFAULT_CUSTOM_COLORS;
}

export function useThemeProvider() {
  const [themeId, setThemeIdState] = useState<ThemeId>(() => {
    const saved = localStorage.getItem('ros3d-theme');
    return (saved as ThemeId) || 'midnight';
  });

  const [customColors, setCustomColorsState] = useState<CustomColors>(loadCustomColors);

  const setThemeId = useCallback((id: ThemeId) => {
    setThemeIdState(id);
    localStorage.setItem('ros3d-theme', id);
  }, []);

  const setCustomColors = useCallback((colors: CustomColors) => {
    setCustomColorsState(colors);
    localStorage.setItem('ros3d-custom-colors', JSON.stringify(colors));
  }, []);

  const theme = themeId === 'custom'
    ? buildCustomTheme(customColors)
    : THEMES[themeId];

  return { theme, themeId, setThemeId, customColors, setCustomColors };
}
