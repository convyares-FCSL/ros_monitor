import { Workflow } from 'lucide-react';
import { PagePlaceholder } from '../components/PagePlaceholder';

export function BehaviorTree() {
  return (
    <PagePlaceholder
      icon={Workflow}
      title="Behavior Tree"
      subtitle="An Unreal-style live behavior-tree visualizer driven by the bt_blueprint / bt_delta stream. The layout and pipeline are proven in the Phase 1 sandbox; this view ports them into React with an inspector and blackboard."
      tag="Phase 3"
    />
  );
}
