import { useEffect, useState } from 'react';
import {
  Home as HomeIcon, Boxes, Workflow, ScrollText, Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';
import { Home } from './views/Home';
import { RosIntrospection } from './views/RosIntrospection';
import { BehaviorTree } from './views/BehaviorTree';
import { Logging } from './views/Logging';
import { Settings } from './views/Settings';

export interface RouteDef {
  path: string;
  label: string;
  icon: LucideIcon;
  Component: React.ComponentType;
}

// Single source of truth for both routing and the nav sidebar. Add a page by
// appending one entry here — the nav list renders straight off this array.
export const ROUTES: RouteDef[] = [
  { path: 'home', label: 'Home', icon: HomeIcon, Component: Home },
  { path: 'ros', label: 'ROS Introspection', icon: Boxes, Component: RosIntrospection },
  { path: 'bt', label: 'Behavior Tree', icon: Workflow, Component: BehaviorTree },
  { path: 'logging', label: 'Logging', icon: ScrollText, Component: Logging },
  { path: 'settings', label: 'Settings', icon: SettingsIcon, Component: Settings },
];

export const DEFAULT_PATH = 'home';

function readHash(): string {
  const raw = window.location.hash.replace(/^#\/?/, '');
  return ROUTES.some((r) => r.path === raw) ? raw : DEFAULT_PATH;
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
