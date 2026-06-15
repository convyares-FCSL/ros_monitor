import { createContext, useContext, useState, useCallback } from 'react';
import type { SceneSettings } from '../types';
import { DEFAULT_SCENE_SETTINGS } from '../types';

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
  // Picker dot colour. Defaults to accentHex; overridden for the grayscale
  // themes so the swatch reads as its name (Dark = dark, Light = light).
  swatchHex?: string;
  text: string;
  textMuted: string;
  textDim: string;
  // Text colour for content sitting directly on the page background (which
  // tracks sceneBg). Auto-darkens for light backgrounds. Panels stay dark, so
  // panel text (--menu-text) is independent of these.
  pageText: string;
  pageTextMuted: string;
  pageTextDim: string;
  // Foreground RGB triple ("R G B") for panel text/overlays/borders, consumed
  // via --fg-rgb. White on dark panels; dark slate on light panels.
  fgRgb: string;
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

// Perceived brightness (0–1) of a hex colour, used to pick readable page text.
function luminance(hex: string): number {
  const n = hexToInt(hex);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// Foreground RGB triple for text/overlays on a given (panel) background.
function fgRgbFor(bg: string): string {
  return luminance(bg) > 0.55 ? '15 23 42' : '255 255 255';
}

// Readable text colours for content on a given background.
function pageTextFor(bg: string) {
  const light = luminance(bg) > 0.55;
  return light
    ? { pageText: '#0f172a', pageTextMuted: 'rgba(15,23,42,0.62)', pageTextDim: 'rgba(15,23,42,0.4)' }
    : { pageText: '#ffffff', pageTextMuted: 'rgba(255,255,255,0.6)', pageTextDim: 'rgba(255,255,255,0.3)' };
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
    ...pageTextFor(colors.sceneBg),
    fgRgb: fgRgbFor(colors.menuBg),
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

// ── Central theme appearance ──────────────────────────────────────────────────
// Single source of truth for the full per-theme look: entity colours/sizes,
// backgrounds, grid, post-processing, labels and edges. The 3D scene applies
// these directly, and the chrome (THEMES below) derives its colours from the
// same data — so editing a theme means editing one entry here.
export const THEME_SCENE_SETTINGS: Record<Exclude<ThemeId, 'custom'>, SceneSettings> = {
  midnight: { ...DEFAULT_SCENE_SETTINGS },
  arctic: {
    nodes: { color: '#38bdf8', size: 1, emissive: 0.45 },
    topics: { color: '#818cf8', size: 1, emissive: 0.4 },
    services: { color: '#2dd4bf', size: 1, emissive: 0.5 },
    actions: { color: '#c4b5fd', size: 1, emissive: 0.42 },
    lineThickness: 1, packetScale: 1.5,
    nodeEdges: true, topicEdges: false, serviceEdges: false, actionEdges: false,
    edgeColor: '#3b4d5c', menuBg: '#0a1622', sceneBg: '#16242f',
    gridVisible: true, gridOpacity: 0.5, gridColor: '#1e3445',
    bloomStrength: 0.8, bloomRadius: 0.6, bloomThreshold: 0.6, fogDensity: 0.015,
    labelScale: 1, labelOffset: 2.2, labelColor: 'entity', edgeThickness: 1.12,
  },
  ember: {
    nodes: { color: '#fb923c', size: 1, emissive: 0.5 },
    topics: { color: '#fbbf24', size: 1, emissive: 0.45 },
    services: { color: '#ef4444', size: 1, emissive: 0.55 },
    actions: { color: '#f43f5e', size: 1, emissive: 0.5 },
    lineThickness: 1, packetScale: 1.5,
    nodeEdges: true, topicEdges: false, serviceEdges: false, actionEdges: false,
    edgeColor: '#5c3a2c', menuBg: '#190d08', sceneBg: '#251410',
    gridVisible: true, gridOpacity: 0.5, gridColor: '#3d2016',
    bloomStrength: 1.1, bloomRadius: 0.6, bloomThreshold: 0.55, fogDensity: 0.018,
    labelScale: 1, labelOffset: 2.2, labelColor: 'entity', edgeThickness: 1.12,
  },
  forest: {
    nodes: { color: '#4ade80', size: 1, emissive: 0.45 },
    topics: { color: '#d97706', size: 1, emissive: 0.4 },
    services: { color: '#14b8a6', size: 1, emissive: 0.5 },
    actions: { color: '#a78bfa', size: 1, emissive: 0.42 },
    lineThickness: 1, packetScale: 1.5,
    nodeEdges: true, topicEdges: false, serviceEdges: false, actionEdges: false,
    edgeColor: '#2f4a38', menuBg: '#0b160f', sceneBg: '#16241b',
    gridVisible: true, gridOpacity: 0.5, gridColor: '#1f3a28',
    bloomStrength: 0.85, bloomRadius: 0.55, bloomThreshold: 0.62, fogDensity: 0.02,
    labelScale: 1, labelOffset: 2.2, labelColor: 'entity', edgeThickness: 1.12,
  },
  dark: {
    nodes: { color: '#22d3ee', size: 1, emissive: 0.45 },
    topics: { color: '#fb923c', size: 1, emissive: 0.4 },
    services: { color: '#34d399', size: 1, emissive: 0.5 },
    actions: { color: '#c084fc', size: 1, emissive: 0.4 },
    lineThickness: 1, packetScale: 1.5,
    nodeEdges: true, topicEdges: false, serviceEdges: false, actionEdges: false,
    edgeColor: '#3f3f46', menuBg: '#09090b', sceneBg: '#18181b',
    gridVisible: true, gridOpacity: 0.5, gridColor: '#27272a',
    bloomStrength: 0.9, bloomRadius: 0.55, bloomThreshold: 0.65, fogDensity: 0.01,
    labelScale: 1, labelOffset: 2.2, labelColor: 'entity', edgeThickness: 1.12,
  },
  light: {
    nodes: { color: '#0891b2', size: 1, emissive: 0.15 },
    topics: { color: '#ea580c', size: 1, emissive: 0.12 },
    services: { color: '#059669', size: 1, emissive: 0.15 },
    actions: { color: '#9333ea', size: 1, emissive: 0.13 },
    lineThickness: 1.2, packetScale: 1.4,
    nodeEdges: true, topicEdges: false, serviceEdges: false, actionEdges: false,
    edgeColor: '#64748b', menuBg: '#f8fafc', sceneBg: '#e9eef4',
    gridVisible: true, gridOpacity: 0.45, gridColor: '#cbd5e1',
    bloomStrength: 0.3, bloomRadius: 0.4, bloomThreshold: 0.85, fogDensity: 0.006,
    labelScale: 1, labelOffset: 2.2, labelColor: 'entity', edgeThickness: 1.12,
  },
};

// Colour/background fields derived from a theme's scene settings, so chrome and
// the 3D scene never drift apart.
function themeColors(s: SceneSettings) {
  return {
    // Page background tracks the 3D scene background, with page text auto-chosen
    // for contrast. Panels keep their own (dark) styling via panelBg.
    bg: s.sceneBg,
    bgScene: hexToInt(s.sceneBg),
    fog: hexToInt(s.sceneBg),
    ...pageTextFor(s.sceneBg),
    fgRgb: fgRgbFor(s.menuBg),
    emissiveIntensity: s.nodes.emissive,
    nodeColor: hexToInt(s.nodes.color), nodeColorHex: s.nodes.color,
    topicColor: hexToInt(s.topics.color), topicColorHex: s.topics.color,
    serviceColor: hexToInt(s.services.color), serviceColorHex: s.services.color,
    actionColor: hexToInt(s.actions.color), actionColorHex: s.actions.color,
  };
}

export const THEMES: Record<Exclude<ThemeId, 'custom'>, Theme> = {
  midnight: {
    id: 'midnight', label: 'Midnight',
    panelBg: 'rgba(15,23,42,0.82)', panelBorder: 'rgba(255,255,255,0.07)', headerBg: 'rgba(3,7,18,0.85)',
    accent: 'text-cyan-400', accentHex: '#22d3ee', text: 'text-white', textMuted: 'text-white/60', textDim: 'text-white/30',
    nodeCss: 'text-cyan-400', topicCss: 'text-orange-400', serviceCss: 'text-emerald-400', actionCss: 'text-purple-400',
    ...themeColors(THEME_SCENE_SETTINGS.midnight),
  },
  arctic: {
    id: 'arctic', label: 'Arctic',
    panelBg: 'rgba(12,25,41,0.88)', panelBorder: 'rgba(56,189,248,0.1)', headerBg: 'rgba(12,25,41,0.9)',
    accent: 'text-sky-400', accentHex: '#38bdf8', text: 'text-white', textMuted: 'text-sky-100/60', textDim: 'text-sky-200/25',
    nodeCss: 'text-sky-400', topicCss: 'text-indigo-400', serviceCss: 'text-teal-400', actionCss: 'text-violet-400',
    ...themeColors(THEME_SCENE_SETTINGS.arctic),
  },
  ember: {
    id: 'ember', label: 'Ember',
    panelBg: 'rgba(24,12,8,0.88)', panelBorder: 'rgba(249,115,22,0.12)', headerBg: 'rgba(17,8,5,0.9)',
    accent: 'text-orange-400', accentHex: '#fb923c', text: 'text-white', textMuted: 'text-orange-100/60', textDim: 'text-orange-200/25',
    nodeCss: 'text-orange-400', topicCss: 'text-amber-400', serviceCss: 'text-red-400', actionCss: 'text-rose-400',
    ...themeColors(THEME_SCENE_SETTINGS.ember),
  },
  forest: {
    id: 'forest', label: 'Forest',
    panelBg: 'rgba(8,24,14,0.88)', panelBorder: 'rgba(16,185,129,0.1)', headerBg: 'rgba(5,18,10,0.9)',
    accent: 'text-emerald-400', accentHex: '#34d399', text: 'text-white', textMuted: 'text-emerald-100/60', textDim: 'text-emerald-200/25',
    nodeCss: 'text-green-400', topicCss: 'text-amber-500', serviceCss: 'text-teal-400', actionCss: 'text-violet-400',
    ...themeColors(THEME_SCENE_SETTINGS.forest),
  },
  dark: {
    id: 'dark', label: 'Dark',
    panelBg: 'rgba(24,24,24,0.92)', panelBorder: 'rgba(255,255,255,0.08)', headerBg: 'rgba(17,17,17,0.92)',
    accent: 'text-white', accentHex: '#e5e5e5', swatchHex: '#3f3f46', text: 'text-white', textMuted: 'text-white/60', textDim: 'text-white/25',
    nodeCss: 'text-cyan-400', topicCss: 'text-orange-400', serviceCss: 'text-emerald-400', actionCss: 'text-purple-400',
    ...themeColors(THEME_SCENE_SETTINGS.dark),
  },
  light: {
    id: 'light', label: 'Light',
    panelBg: 'rgba(248,250,252,0.85)', panelBorder: 'rgba(15,23,42,0.12)', headerBg: 'rgba(248,250,252,0.9)',
    accent: 'text-slate-800', accentHex: '#1e293b', swatchHex: '#e2e8f0', text: 'text-slate-900', textMuted: 'text-slate-900/60', textDim: 'text-slate-900/30',
    nodeCss: 'text-cyan-700', topicCss: 'text-orange-600', serviceCss: 'text-emerald-600', actionCss: 'text-purple-600',
    ...themeColors(THEME_SCENE_SETTINGS.light),
  },
};

export interface ThemeContextValue {
  theme: Theme;
  themeId: ThemeId;
  setThemeId: (id: ThemeId) => void;
  customColors: CustomColors;
  setCustomColors: (colors: CustomColors) => void;
  // Full scene appearance for the active theme. Presets are canonical; editing
  // produces the 'custom' theme. Shared by the 3D scene and the Settings page.
  sceneSettings: SceneSettings;
  applyScene: (s: SceneSettings) => void;
  resetScene: () => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
  theme: THEMES.midnight,
  themeId: 'midnight',
  setThemeId: () => {},
  customColors: DEFAULT_CUSTOM_COLORS,
  setCustomColors: () => {},
  sceneSettings: THEME_SCENE_SETTINGS.midnight,
  applyScene: () => {},
  resetScene: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

// Convert a panelBg rgba/hex-with-alpha string to a near-opaque solid variant
// used for --menu-bg-solid (context menus, dropdowns that must fully obscure content).
export function solidify(panelBg: string): string {
  const m = panelBg.match(/^rgba?\(([^,]+),([^,]+),([^,]+)/);
  if (m) return `rgba(${m[1].trim()},${m[2].trim()},${m[3].trim()},0.97)`;
  if (/^#[0-9a-fA-F]{8}$/.test(panelBg)) return panelBg.slice(0, 7) + 'f7';
  return panelBg;
}

function loadCustomColors(): CustomColors {
  try {
    const saved = localStorage.getItem('ros3d-custom-colors');
    if (saved) return JSON.parse(saved);
  } catch { /* ignore */ }
  return DEFAULT_CUSTOM_COLORS;
}

function loadCustomScene(): SceneSettings {
  try {
    const saved = localStorage.getItem('ros3d-scene-settings');
    if (saved) return { ...DEFAULT_SCENE_SETTINGS, ...JSON.parse(saved) };
  } catch { /* ignore */ }
  return DEFAULT_SCENE_SETTINGS;
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

  // Custom-theme scene overrides (persisted). Presets read from THEME_SCENE_SETTINGS.
  const [customScene, setCustomScene] = useState<SceneSettings>(loadCustomScene);

  const theme = themeId === 'custom'
    ? buildCustomTheme(customColors)
    : THEMES[themeId];

  const sceneSettings = themeId === 'custom' ? customScene : THEME_SCENE_SETTINGS[themeId];

  // Apply a full scene-settings edit: persist as the custom theme, mirror its
  // colours into customColors, and switch to 'custom'.
  const applyScene = useCallback((s: SceneSettings) => {
    setCustomScene(s);
    localStorage.setItem('ros3d-scene-settings', JSON.stringify(s));
    setCustomColorsState({
      menuBg: s.menuBg, sceneBg: s.sceneBg,
      node: s.nodes.color, topic: s.topics.color, service: s.services.color, action: s.actions.color,
      emissive: s.nodes.emissive,
    });
    localStorage.setItem('ros3d-custom-colors', JSON.stringify({
      menuBg: s.menuBg, sceneBg: s.sceneBg,
      node: s.nodes.color, topic: s.topics.color, service: s.services.color, action: s.actions.color,
      emissive: s.nodes.emissive,
    }));
    setThemeId('custom');
  }, [setThemeId]);

  const resetScene = useCallback(() => {
    setCustomScene(DEFAULT_SCENE_SETTINGS);
    localStorage.removeItem('ros3d-scene-settings');
  }, []);

  return {
    theme, themeId, setThemeId, customColors, setCustomColors,
    sceneSettings, applyScene, resetScene,
  };
}
