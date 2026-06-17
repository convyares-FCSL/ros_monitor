import { useBtStore, useNodeDef, useNodeStatus } from '../store/btStore';
import { CAP_H, SVC_H, STAMP_TYPES, type NodeBox } from './layout';
import type { BTDecorator, BTNodeDef, NodeCategory, NodeStatus } from './types';

// Symbols for control/structural node types.
const SYMBOL: Record<string, string> = {
  Sequence: '→',
  ReactiveSequence: '→*',
  Fallback: '?',
  ReactiveFallback: '?*',
  Parallel: '⇉',
  SubTree: '▣',
  ScriptCondition: '{;}',
  ScriptAsync: '↗',
  AlwaysSuccess: '✓',
  ForceSuccess: '✓',
  AlwaysFailure: '✗',
  ForceFailure: '✗',
  ProcessMonitor: '⊕',
  SetBlackboard: '✎',
};

// Colour of the dominant symbol inside stamp nodes.
const STAMP_COLOR: Record<string, string> = {
  AlwaysSuccess: '#10b981',
  ForceSuccess: '#10b981',
  AlwaysFailure: '#ef4444',
  ForceFailure: '#ef4444',
};

// Which input port to surface as the secondary sub-label for each node type.
// For Precondition, the BT.CPP port is typically called "if"; fall back to any
// input port if the canonical one isn't present.
const PORT_LABEL: Record<string, string[]> = {
  ScriptCondition: ['code'],
  Precondition: ['if', 'condition', 'enable'],
};

// Returns the display string for the most relevant input port, stripping
// blackboard refs ({key} → key). Returns null when nothing should be shown.
function portSubLabel(node: BTNodeDef): string | null {
  const candidates = PORT_LABEL[node.type];
  const input = node.ports.input ?? {};

  const raw = candidates
    ? candidates.map((k) => input[k]).find(Boolean) ?? null
    : null;

  if (!raw) return null;
  return raw.startsWith('{') && raw.endsWith('}') ? raw.slice(1, -1) : raw;
}

export const NODE_TOOLTIPS: Record<string, string> = {
  Sequence: 'Runs children left→right. Stops on first FAILURE. Succeeds only if all children succeed.',
  ReactiveSequence: 'Like Sequence but re-ticks all children from the start every cycle, reacting to condition changes.',
  Fallback: 'Runs children left→right. Stops on first SUCCESS. Fails only if all children fail.',
  ReactiveFallback: 'Like Fallback but re-ticks all children from the start every cycle.',
  Parallel: 'Runs all children concurrently. Uses a configured M-of-N threshold for success / failure.',
  SubTree: 'Reference to an external behavior tree. That tree is run as a black box from here.',
  ScriptCondition: 'Evaluates a script expression each tick. Returns SUCCESS when the expression is truthy.',
  Precondition: 'Decorator — checks a condition before ticking its child. Returns the "else" result if the condition is false.',
  AlwaysSuccess: 'Decorator — runs its child but always reports SUCCESS, masking any failure.',
  ForceSuccess: 'Decorator — forces the child\'s result to SUCCESS.',
  AlwaysFailure: 'Decorator — runs its child but always reports FAILURE.',
  ForceFailure: 'Decorator — forces the child\'s result to FAILURE.',
  ProcessMonitor: 'Returns SUCCESS while a monitored process is alive; FAILURE when it stops.',
  SetBlackboard: 'Writes a constant value to a blackboard key. Always returns SUCCESS.',
};

export const CATEGORY_TOOLTIPS: Record<string, string> = {
  action: 'Action node — performs work over one or more ticks, returning SUCCESS, FAILURE, or RUNNING.',
  condition: 'Condition node — instantly checks a predicate, returning SUCCESS or FAILURE.',
  decorator: 'Decorator — wraps a single child, modifying or filtering its result.',
  subtree: 'Subtree — references and runs an external behavior tree as a black box.',
  control: 'Control flow node — manages the execution order and result of its children.',
};

function nodeSymbol(type: string, category: NodeCategory): string {
  if (SYMBOL[type]) return SYMBOL[type];
  if (category === 'condition') return '◆';
  if (category === 'action') return '▶';
  return '';
}

function decoratorLabel(dec: BTDecorator): string {
  const p = (dec.ports ?? {}) as Record<string, number>;
  if (dec.type === 'Timeout' && p.msec) return `⏱ Timeout ${p.msec / 1000}s`;
  if (dec.type === 'RetryUntilSuccessful' && p.num_attempts) return `↻ Retry ×${p.num_attempts}`;
  if (dec.type === 'Inverter') return '¬ Inverter';
  return dec.name;
}

// Status colours shared between cap and core block.
const CAP_STATUS_BG: Record<string, string> = {
  RUNNING: 'rgba(6,182,212,0.12)',
  SUCCESS: 'rgba(16,185,129,0.10)',
  FAILURE: 'rgba(239,68,68,0.12)',
  IDLE:    'var(--menu-bg-solid, rgba(15,23,42,0.95))',
};
const CAP_STATUS_BORDER: Record<string, string> = {
  RUNNING: 'rgba(6,182,212,0.45)',
  SUCCESS: 'rgba(16,185,129,0.30)',
  FAILURE: 'rgba(239,68,68,0.40)',
  IDLE:    'rgb(var(--fg-rgb) / 0.1)',
};
const CAP_STATUS_COLOR: Record<string, string> = {
  RUNNING: '#06b6d4',
  SUCCESS: '#10b981',
  FAILURE: '#ef4444',
  IDLE:    'rgb(var(--fg-rgb) / 0.55)',
};

// Each decorator cap is its own component so it can subscribe to its own status
// without re-rendering siblings when only one cap's status changes.
function DecoratorCap({ dec }: { dec: BTDecorator }) {
  const status = useNodeStatus(dec.id);
  return (
    <div
      className="flex items-center justify-between px-2 text-[10px] font-mono rounded-t-sm border"
      style={{
        height: CAP_H,
        background: CAP_STATUS_BG[status] ?? CAP_STATUS_BG.IDLE,
        borderColor: CAP_STATUS_BORDER[status] ?? CAP_STATUS_BORDER.IDLE,
        color: CAP_STATUS_COLOR[status] ?? CAP_STATUS_COLOR.IDLE,
      }}
    >
      <span className="truncate">{decoratorLabel(dec)}</span>
      {status !== 'IDLE' && (
        <span className="text-[8px] font-bold tracking-wider ml-2 shrink-0 opacity-80">
          {status}
        </span>
      )}
    </div>
  );
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

  const sym = nodeSymbol(node.type, node.category);
  const isLeaf = node.children.length === 0;
  const isCond = node.category === 'condition';
  const isStamp = STAMP_TYPES.has(node.type);
  const subLabel = portSubLabel(node);

  return (
    <>
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
          <DecoratorCap key={dec.id} dec={dec} />
        ))}

        {node.services.map((svc) => (
          <div key={svc.id}
            className="flex items-center mx-2 px-2 text-[9.5px] font-mono text-[color:rgb(var(--fg-rgb)/0.4)] border border-[rgb(var(--fg-rgb)/0.1)]"
            style={{ height: SVC_H, background: 'color-mix(in srgb, var(--menu-bg-solid, rgba(15,23,42,0.95)) 84%, black)' }}>
            <span className="truncate">⚙ {svc.name} · {svc.tick_ms}ms</span>
          </div>
        ))}

        <div
          className={[
            'bt-core relative flex items-center',
            isStamp ? 'flex-col justify-center gap-0.5 rounded-sm overflow-hidden' : 'gap-2 px-3 rounded-md',
            CORE_CLASS[status],
            selected ? 'ring-2 ring-[rgb(var(--fg-rgb)/0.5)]' : '',
            node.category === 'subtree' ? 'bt-core-subtree' : '',
            isCond && !isStamp ? 'bt-core-cond' : '',
            isLeaf && !isStamp ? 'bt-core-leaf' : '',
            isStamp && STAMP_COLOR[node.type] === '#10b981' ? 'bt-core-stamp-ok' : '',
            isStamp && STAMP_COLOR[node.type] === '#ef4444' ? 'bt-core-stamp-fail' : '',
          ].filter(Boolean).join(' ')}
          style={{ height: box.coreH }}
        >
          {isStamp ? (
            // Square stamp — large ✓/✗ with the node name in tiny text below it.
            <>
              <span style={{ color: STAMP_COLOR[node.type], fontSize: 22, lineHeight: 1 }}>
                {sym}
              </span>
              <span className="text-[7px] font-mono leading-none truncate max-w-full px-0.5 text-center"
                    style={{ color: 'rgba(255,255,255,0.45)' }}>
                {node.name}
              </span>
              {collapsed && box.descendantCount > 0 && (
                <span className="absolute top-0.5 left-0.5 text-[7px] font-mono text-[color:rgb(var(--fg-rgb)/0.4)] bg-[rgb(var(--fg-rgb)/0.07)] px-0.5 rounded">
                  {box.descendantCount}↓
                </span>
              )}
              {box.hasChildren && (
                <button
                  onClick={(e) => { e.stopPropagation(); toggleCollapse(box.id); }}
                  className="absolute bottom-0.5 right-0.5 w-4 h-4 flex items-center justify-center rounded text-[color:rgb(var(--fg-rgb)/0.35)] hover:text-[color:rgb(var(--fg-rgb))] text-[8px]"
                  title={collapsed ? 'Expand' : 'Collapse'}
                >
                  {collapsed ? '▸' : '▾'}
                </button>
              )}
            </>
          ) : (
            // Normal node — symbol + primary name + optional port/type sub-label + collapse btn.
            <>
              {sym && (
                <span className={`font-mono font-bold shrink-0 text-[color:rgb(var(--fg-rgb))] ${isLeaf ? 'text-[11px]' : 'text-base'}`}>
                  {sym}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className={`font-semibold text-[color:rgb(var(--fg-rgb))] truncate leading-tight ${isLeaf ? 'text-[11px]' : 'text-[12px]'}`}>
                  {node.name}
                </div>
                {/* Port sub-label: ScriptCondition shows code, Precondition shows condition */}
                {subLabel && (
                  <div className="text-[9px] font-mono text-[color:rgb(var(--fg-rgb)/0.45)] truncate leading-tight">
                    {subLabel}
                  </div>
                )}
                {/* Type sub-label — omit for leaves, nodes with port sub-label, and
                    when name already equals type (Sequence, Fallback, etc.) */}
                {!isLeaf && !subLabel && node.name !== node.type && (
                  <div className="text-[9px] font-mono text-[color:rgb(var(--fg-rgb)/0.4)] truncate leading-tight">
                    {node.type}
                  </div>
                )}
              </div>

              {box.hasChildren && (
                <div className="flex items-center gap-1 shrink-0">
                  {collapsed && box.descendantCount > 0 && (
                    <span className="text-[8px] font-mono leading-none text-[color:rgb(var(--fg-rgb)/0.45)] bg-[rgb(var(--fg-rgb)/0.07)] px-1 py-0.5 rounded">
                      {box.descendantCount}↓
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleCollapse(box.id); }}
                    className="w-5 h-5 flex items-center justify-center rounded text-[color:rgb(var(--fg-rgb)/0.5)] hover:text-[color:rgb(var(--fg-rgb))] hover:bg-[rgb(var(--fg-rgb)/0.1)] text-[10px] shrink-0"
                    title={collapsed ? 'Expand' : 'Collapse'}
                  >
                    {collapsed ? '▸' : '▾'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

    </>
  );
}
