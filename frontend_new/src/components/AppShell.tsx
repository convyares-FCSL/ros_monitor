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
        <View />
      </main>
    </div>
  );
}
