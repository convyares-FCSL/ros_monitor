import { Activity } from 'lucide-react';
import { PagePlaceholder } from '../components/PagePlaceholder';

export function Home() {
  return (
    <PagePlaceholder
      icon={Activity}
      title="ROS 2 Diagnostic Platform"
      subtitle="A unified control room for your ROS 2 system — live 3D network introspection, behavior-tree execution, and diagnostics. Pick a view from the sidebar to begin."
      tag="Landing"
    />
  );
}
