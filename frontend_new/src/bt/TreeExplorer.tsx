import { ChevronLeft, ChevronRight, GitBranch } from 'lucide-react';
import { useBtStore, useTreeIds, useActiveBlueprint, useNodeStatus, useTreeRootStatus } from '../store/btStore';
import type { BTNodeDef, NodeStatus } from './types';

const STATUS_DOT: Record<NodeStatus, string> = {
  IDLE: 'bg-slate-500',
  RUNNING: 'bg-cyan-400 shadow-[0_0_6px_#06b6d4]',
  SUCCESS: 'bg-emerald-400',
  FAILURE: 'bg-red-400',
};

const PANEL_BG = 'var(--menu-bg, rgba(15,23,42,0.85))';

// Left-hand explorer: every tree streaming into the store, plus the active
// tree's node list. Clicking a node focuses + selects it on the canvas.
export function TreeExplorer({ open, onToggle, onFocusNode }: { open: boolean; onToggle: () => void; onFocusNode: (id: number) => void }) {
  const treeIds = useTreeIds();
  const activeTreeId = useBtStore((s) => s.activeTreeId);
  const setActiveTree = useBtStore((s) => s.setActiveTree);
  const blueprint = useActiveBlueprint();

  return (
    <>
      <button
        onClick={onToggle}
        className="absolute z-30 w-6 h-10 flex items-center justify-center backdrop-blur-xl border border-white/[0.08] rounded-r-md text-white/50 hover:text-white hover:bg-white/5 transition-all duration-300"
        style={{ background: PANEL_BG, top: '88px', left: open ? '18.75rem' : '0' }}
        title={open ? 'Collapse' : 'Expand'}
      >
        {open ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      <aside
        className={`absolute left-3 top-[68px] bottom-[208px] w-72 z-20 rounded-2xl backdrop-blur-2xl border flex flex-col overflow-hidden transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${open ? 'translate-x-0' : '-translate-x-[calc(100%+1.5rem)]'}`}
        style={{ background: PANEL_BG, borderColor: 'rgba(255,255,255,0.08)' }}
      >
        {/* Trees */}
        <div className="px-4 py-2.5 border-b border-white/[0.07] flex items-center justify-between">
          <span className="text-[9px] font-bold tracking-[0.18em] text-white/40">TREES</span>
          <span className="text-[10px] font-mono text-white/35">{treeIds.length}</span>
        </div>
        <div className="px-2 py-1.5 space-y-0.5 border-b border-white/[0.06]">
          {treeIds.length === 0 ? (
            <div className="text-[10px] font-mono text-white/25 italic px-2 py-1">no trees</div>
          ) : (
            treeIds.map((id) => (
              <TreeRow key={id} id={id} active={id === activeTreeId} onSelect={() => setActiveTree(id)} />
            ))
          )}
        </div>

        {/* Nodes of the active tree */}
        <div className="px-4 py-2 flex items-center justify-between">
          <span className="text-[9px] font-bold tracking-[0.18em] text-white/40">NODES</span>
          <span className="text-[10px] font-mono text-white/35">{blueprint?.nodes.length ?? 0}</span>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin px-2 pb-2 space-y-0.5">
          {(blueprint?.nodes ?? []).map((node) => (
            <NodeRow key={node.id} node={node} onFocus={() => onFocusNode(node.id)} />
          ))}
        </div>
      </aside>
    </>
  );
}

function TreeRow({ id, active, onSelect }: { id: string; active: boolean; onSelect: () => void }) {
  const status = useTreeRootStatus(id);
  return (
    <button onClick={onSelect}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-left hover:bg-white/[0.04]"
      style={{ background: active ? 'rgba(6,182,212,0.12)' : 'transparent' }}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[status]} ${status === 'RUNNING' ? 'animate-pulse' : ''}`} />
      <GitBranch className="w-3.5 h-3.5 shrink-0" style={{ color: active ? '#06b6d4' : 'rgba(255,255,255,0.4)' }} />
      <span className={`text-[12px] font-semibold truncate ${active ? 'text-white' : 'text-white/60'}`}>{id}</span>
    </button>
  );
}

function NodeRow({ node, onFocus }: { node: BTNodeDef; onFocus: () => void }) {
  const status = useNodeStatus(node.id);
  const selected = useBtStore((s) => s.selectedNodeId === node.id);
  return (
    <button onClick={onFocus}
      className="w-full flex items-center gap-2 px-2 py-1 rounded-md transition-colors text-left hover:bg-white/[0.04]"
      style={{ background: selected ? 'rgba(255,255,255,0.07)' : 'transparent' }}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[status]}`} />
      <span className="text-[11px] font-medium text-white/80 truncate">{node.name}</span>
      <span className="text-[9px] font-mono text-white/30 ml-auto truncate max-w-[40%]">{node.type}</span>
    </button>
  );
}
