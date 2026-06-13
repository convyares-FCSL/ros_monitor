import { ScrollText } from 'lucide-react';
import { PagePlaceholder } from '../components/PagePlaceholder';

export function Logging() {
  return (
    <PagePlaceholder
      icon={ScrollText}
      title="Logging"
      subtitle="A streaming, filterable log console for node output, lifecycle transitions, and service activity across the ROS 2 graph."
    />
  );
}
