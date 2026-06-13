import { Suspense } from 'react';
import { useTheme } from '../hooks/useTheme';
import { ROUTES, useHashRoute } from '../router';
import { NavSidebar } from './NavSidebar';

// Multi-page shell: persistent nav rail + a single mounted view. Only the
// active route's component is rendered, so navigating away from ROS
// Introspection unmounts it and triggers full WebGL teardown.
export function AppShell() {
  const { theme } = useTheme();
  const [path, navigate] = useHashRoute();
  const route = ROUTES.find((r) => r.path === path) ?? ROUTES[0];
  const View = route.Component;

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ background: theme.bg }}>
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
