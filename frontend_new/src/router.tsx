import { lazy, useEffect, useState } from 'react';
import {
  Home as HomeIcon, Boxes, Workflow, ScrollText, Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';
import { useSettingsStore } from './store/settingsStore';

export interface RouteDef {
  path: string;
  label: string;
  icon: LucideIcon;
  Component: React.ComponentType;
}

// Single source of truth for both routing and the nav sidebar. Add a page by
// appending one entry here — the nav list renders straight off this array.
// Views are lazy-loaded so each is its own chunk; the heavy Three.js stack
// lives in the RosIntrospection chunk and only loads when that page is opened.
export const ROUTES: RouteDef[] = [
  { path: 'home', label: 'Home', icon: HomeIcon, Component: lazy(() => import('./views/Home').then((m) => ({ default: m.Home }))) },
  { path: 'ros', label: 'ROS Introspection', icon: Boxes, Component: lazy(() => import('./views/RosIntrospection').then((m) => ({ default: m.RosIntrospection }))) },
  { path: 'bt', label: 'Behavior Tree', icon: Workflow, Component: lazy(() => import('./views/BehaviorTree').then((m) => ({ default: m.BehaviorTree }))) },
  { path: 'logging', label: 'Logging', icon: ScrollText, Component: lazy(() => import('./views/Logging').then((m) => ({ default: m.Logging }))) },
  { path: 'settings', label: 'Settings', icon: SettingsIcon, Component: lazy(() => import('./views/Settings').then((m) => ({ default: m.Settings }))) },
];

export const DEFAULT_PATH = 'home';

// The fallback view is configurable on the Settings page; fall back to the
// hardcoded default if the stored value isn't a real route.
function defaultPath(): string {
  const configured = useSettingsStore.getState().defaultView;
  return ROUTES.some((r) => r.path === configured) ? configured : DEFAULT_PATH;
}

function readHash(): string {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return ROUTES.some((r) => r.path === raw) ? raw : defaultPath();
}

export function useHashRoute(): [string, (path: string) => void] {
  const [path, setPath] = useState(readHash);
  useEffect(() => {
    const onChange = () => setPath(readHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  const navigate = (p: string) => { window.location.hash = `/${p}`; };
  return [path, navigate];
}
