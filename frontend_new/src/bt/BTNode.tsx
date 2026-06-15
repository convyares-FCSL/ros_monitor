import { useBtStore, useNodeDef, useNodeStatus } from '../store/btStore';
import { CAP_H, SVC_H, CORE_H, type NodeBox } from './layout';
import type { BTDecorator, NodeStatus } from './types';

const SYMBOL: Record<string, string> = {
  Sequence: '→',
  ReactiveSequence: '→*',
  Fallback: '?',
  ReactiveFallback: '?*',
  Parallel: '⇉',
  SubTree: '▣',
};

function decoratorLabel(dec: BTDecorator): string {
  const p = (dec.ports ?? {}) as Record<string, number>;
  if (dec.type === 'Timeout' && p.msec) return `⏱ Timeout ${p.msec / 1000}s`;
  if (dec.type === 'RetryUntilSuccessful' && p.num_attempts) return `↻ Retry ×${p.num_attempts}`;
  if (dec.type === 'Inverter') return '¬ Inverter';
  return dec.name;
}

const CORE_CLASS: Record<NodeStatus, string> = {
  IDLE: 'bt-core-idle',
  RUNNING: 'bt-core-running',
  SUCCESS: 'bt-core-success',
  FAILURE: 'bt-core-failure',
};

// One tree node: decorator caps stacked on top, services inside, core block at
// the base. Subscribes to just its own status so a delta re-renders only it.
export function BTNode({ box, onContextMenu }: { box: NodeBox; onContextMenu?: (nodeId: number, x: number, y: number) => void }) {
  const node = useNodeDef(box.id);
  const status = useNodeStatus(box.id);
  const selected = useBtStore((s) => s.selectedNodeId === box.id);
  const collapsed = useBtStore((s) => s.collapsed.has(box.id));
  const select = useBtStore((s) => s.select);
  const toggleCollapse = useBtStore((s) => s.toggleCollapse);

  if (!node) return null;
  const symbol = SYMBOL[node.type] ?? (node.category === 'condition' ? '◆' : '');

  return (
    <div
      className="absolute select-none"
      style={{ left: box.x, top: box.y, width: box.w }}
      onClick={(e) => { e.stopPropagation(); select(box.id); }}
      onDoubleClick={(e) => {
        if (!collapsed || !box.hasChildren) return;
        e.stopPropagation();
        toggleCollapse(box.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu?.(box.id, e.clientX, e.clientY);
      }}
    >
      {node.decorators.map((dec) => (
        <div key={dec.id}
          className="flex items-center px-2 text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.55)] border border-[rgb(var(--fg-rgb)/0.1)] rounded-t-sm"
          style={{ height: CAP_H, background: 'var(--menu-bg-solid, rgba(15,23,42,0.95))' }}>
          {decoratorLabel(dec)}
        </div>
      ))}

      {node.services.map((svc) => (
        <div key={svc.id}
          className="flex items-center mx-2 px-2 text-[9.5px] font-mono text-[color:rgb(var(--fg-rgb)/0.4)] border border-[rgb(var(--fg-rgb)/0.1)]"
          style={{ height: SVC_H, background: 'color-mix(in srgb, var(--menu-bg-solid, rgba(15,23,42,0.95)) 84%, black)' }}>
          <span className="truncate">⚙ {svc.name} · {svc.tick_ms}ms</span>
        </div>
      ))}

      <div
        className={`bt-core relative flex items-center gap-2 px-3 rounded-md ${CORE_CLASS[status]} ${selected ? 'ring-2 ring-[rgb(var(--fg-rgb)/0.5)]' : ''} ${node.category === 'subtree' ? 'bt-core-subtree' : ''}`}
        style={{ height: CORE_H }}
      >
        {symbol && <span className="font-mono font-bold text-base text-[color:rgb(var(--fg-rgb))] shrink-0">{symbol}</span>}
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-[color:rgb(var(--fg-rgb))] truncate leading-tight">{node.name}</div>
          <div className="text-[9px] font-mono text-[color:rgb(var(--fg-rgb)/0.4)] truncate leading-tight">{node.type}</div>
        </div>
        {box.hasChildren && (
          <button
            onClick={(e) => { e.stopPropagation(); toggleCollapse(box.id); }}
            className="w-5 h-5 flex items-center justify-center rounded text-[color:rgb(var(--fg-rgb)/0.5)] hover:text-[color:rgb(var(--fg-rgb))] hover:bg-[rgb(var(--fg-rgb)/0.1)] text-[10px] shrink-0"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? '▸' : '▾'}
          </button>
        )}
      </div>
    </div>
  );
}
