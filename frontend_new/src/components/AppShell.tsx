import { Suspense, useEffect } from 'react';
import { useTheme, solidify } from '../hooks/useTheme';
import { ROUTES, useHashRoute } from '../router';
import { NavSidebar } from './NavSidebar';
import { startBridgeConnection, stopBridgeConnection } from '../bridge/connection';
import { initEventLog, useEventLogStore } from '../store/eventLogStore';
import { useSettingsStore } from '../store/settingsStore';

// Multi-page shell: persistent nav rail + a single mounted view. Only the
// active route's component is rendered, so navigating away from ROS
// Introspection unmounts it and triggers full WebGL teardown.
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
    return () => {
      unsubMax();
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
        <Suspense fallback={
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-[11px] font-mono tracking-widest uppercase" style={{ color: 'var(--page-text-dim)' }}>Loading…</div>
          </div>
        }>
          <View />
        </Suspense>
      </main>
    </div>
  );
}
