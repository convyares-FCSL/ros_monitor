import { Suspense, useEffect } from 'react';
import { useTheme, solidify } from '../hooks/useTheme';
import { ROUTES, useHashRoute } from '../router';
import { NavSidebar } from './NavSidebar';
import { startBridgeConnection, stopBridgeConnection, subscribeToBridgeFrames } from '../bridge/connection';
import { initEventLog, useEventLogStore } from '../store/eventLogStore';
import { useSettingsStore } from '../store/settingsStore';
import { useRosGraphStore } from '../store/rosGraphStore';
import type { NodeParamsEvent } from '../types';

// Routes that stay mounted across tab switches (keepMounted: true).
// They are always rendered but CSS-hidden when inactive so live state
// (chart data, WebSocket subscriptions) survives navigation.
const KEEP_MOUNTED = ROUTES.filter((r) => r.keepMounted);

// Multi-page shell: persistent nav rail + active view. Only the active
// route's component is rendered, EXCEPT keepMounted routes which are always
// present (hidden via CSS) so their live state is never destroyed.
export function AppShell() {
  const { theme } = useTheme();
  const [path, navigate] = useHashRoute();
  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0];
  const View = route.Component;

  useEffect(() => {
    startBridgeConnection();
    const stopLog = initEventLog();
    // Keep the log ring-buffer cap in sync with the telemetry setting.
    useEventLogStore.getState().setMaxEntries(useSettingsStore.getState().maxLogEntries);
    const unsubMax = useSettingsStore.subscribe((s) =>
      useEventLogStore.getState().setMaxEntries(s.maxLogEntries));
    // Globally cache node parameters so any view (e.g. BTInspector) can read them.
    const unsubParams = subscribeToBridgeFrames(({ frame }) => {
      if (frame.type === 'node_params_event') {
        const ev = frame.data as NodeParamsEvent;
        useRosGraphStore.getState().setNodeParams(ev.node_name, ev.params);
      }
    });
    return () => {
      unsubMax();
      unsubParams();
      stopLog();
      stopBridgeConnection();
    };
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{
      background: theme.bg,
      ['--menu-bg' as string]: theme.panelBg,
      ['--menu-bg-solid' as string]: solidify(theme.panelBg),
      // Panel foreground (text/overlays/borders) — white on dark panels, dark on light.
      ['--fg-rgb' as string]: theme.fgRgb,
      ['--menu-text' as string]: `rgb(${theme.fgRgb})`,
      ['--menu-text-muted' as string]: `rgb(${theme.fgRgb} / 0.6)`,
      ['--menu-text-dim' as string]: `rgb(${theme.fgRgb} / 0.3)`,
      // Text on the page background (adapts to light themes).
      ['--page-text' as string]: theme.pageText,
      ['--page-text-muted' as string]: theme.pageTextMuted,
      ['--page-text-dim' as string]: theme.pageTextDim,
    }}>
      <NavSidebar activePath={route.path} onNavigate={navigate} />
      <main className="relative flex-1 overflow-hidden">
        {/* keepMounted views — always in DOM, shown/hidden via display */}
        {KEEP_MOUNTED.map((r) => (
          <div
            key={r.path}
            style={{ display: route.path === r.path ? 'block' : 'none', position: 'absolute', inset: 0 }}
          >
            <Suspense fallback={null}>
              <r.Component />
            </Suspense>
          </div>
        ))}

        {/* Normal views — mount only when active */}
        {!route.keepMounted && (
          <Suspense fallback={
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-[11px] font-mono tracking-widest uppercase" style={{ color: 'var(--page-text-dim)' }}>Loading…</div>
            </div>
          }>
            <View />
          </Suspense>
        )}
      </main>
    </div>
  );
}
