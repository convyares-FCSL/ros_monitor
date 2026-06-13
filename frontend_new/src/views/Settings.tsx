import { Settings as SettingsIcon } from 'lucide-react';
import { PagePlaceholder } from '../components/PagePlaceholder';

export function Settings() {
  return (
    <PagePlaceholder
      icon={SettingsIcon}
      title="Settings"
      subtitle="Global preferences — connection endpoints, theme, telemetry rate limits, and per-view defaults. Scene-specific styling currently lives in the ROS Introspection toolbar."
    />
  );
}
