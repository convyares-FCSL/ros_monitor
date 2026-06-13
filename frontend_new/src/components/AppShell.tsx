import { Suspense, useEffect } from 'react';
import { useTheme, solidify } from '../hooks/useTheme';
import { ROUTES, useHashRoute } from '../router';
import { NavSidebar } from './NavSidebar';
import { startBridgeConnection, stopBridgeConnection } from '../bridge/connection';

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
    return () => stopBridgeConnection();
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{
      background: theme.bg,
      ['--menu-bg' as string]: theme.panelBg,
      ['--menu-bg-solid' as string]: solidify(theme.panelBg),
      ['--menu-text' as string]: '#ffffff',
      ['--menu-text-muted' as string]: 'rgba(255,255,255,0.6)',
      ['--menu-text-dim' as string]: 'rgba(255,255,255,0.3)',
    }}>
      <NavSidebar activePath={route.path} onNavigate={navigate} />
      <main className="relative flex-1 overflow-hidden">
        <Suspense fallback={
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-[11px] font-mono tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.35)' }}>Loading…</div>
          </div>
        }>
          <View />
        </Suspense>
      </main>
    </div>
  );
}
