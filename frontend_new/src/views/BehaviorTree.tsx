import { useRef, useState } from 'react';
import { Workflow, ChevronDown, GitBranch, FileCode2, X, Copy, Check, Boxes, CircleDot, CheckCircle2, XCircle } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import { useBtSocket, type BtConnStatus } from '../hooks/useBtSocket';
import { useBtStore, useTreeIds, useActiveBlueprint, useActiveNodesById, useActiveStatusCounts } from '../store/btStore';
import type { BTBlueprint, BTNodeDef, BTDecorator } from '../bt/types';
import { TopBar } from '../components/TopBar';
import { Stat } from '../components/StatChip';
import { BTCanvas, type BTCanvasHandle } from '../bt/BTCanvas';
import { BTInspector } from '../bt/BTInspector';
import { TreeExplorer } from '../bt/TreeExplorer';
import { BTControls } from '../bt/BTControls';

const CONN_STYLE: Record<BtConnStatus, { label: string; cls: string }> = {
  connecting: { label: 'CONNECTING', cls: 'bg-amber-400' },
  connected: { label: 'CONNECTED', cls: 'bg-green-400 shadow-[0_0_8px_#4ade80]' },
  disconnected: { label: 'DISCONNECTED', cls: 'bg-red-500' },
};

export function BehaviorTree() {
  const { theme } = useTheme();
  const [paused, setPaused] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ nodeId: number | null; x: number; y: number } | null>(null);
  const [xmlOpen, setXmlOpen] = useState(false);
  const conn = useBtSocket(paused);
  const canvasRef = useRef<BTCanvasHandle>(null);
  const nodesById = useActiveNodesById();
  const collapsed = useBtStore((s) => s.collapsed);
  const select = useBtStore((s) => s.select);
  const toggleCollapse = useBtStore((s) => s.toggleCollapse);
  const collapseAll = useBtStore((s) => s.collapseAll);
  const expandAll = useBtStore((s) => s.expandAll);

  const contextNode = contextMenu?.nodeId != null ? nodesById?.get(contextMenu.nodeId) : undefined;
  const contextCollapsed = contextMenu?.nodeId != null ? collapsed.has(contextMenu.nodeId) : false;
  const contextHasChildren = !!contextNode && contextNode.children.length > 0;

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: theme.bg }}>
      <BTCanvas
        ref={canvasRef}
        onNodeContextMenu={(nodeId, x, y) => setContextMenu({ nodeId, x, y })}
        onCanvasContextMenu={(x, y) => setContextMenu({ nodeId: null, x, y })}
      />

      <TopBar title="Behavior Tree" icon={Workflow}>
        <BtHeaderContent />
        <ConnBadge conn={conn} />
        <XmlDebugButton onOpen={() => setXmlOpen(true)} />
      </TopBar>

      {xmlOpen && <XmlDebugModal onClose={() => setXmlOpen(false)} />}

      {/* Left: tree explorer (top) + controls (bottom) */}
      <TreeExplorer
        open={explorerOpen}
        onToggle={() => setExplorerOpen((o) => !o)}
        onFocusNode={(id) => canvasRef.current?.focusNode(id)}
      />
      <BTControls
        open={explorerOpen}
        onResetView={() => canvasRef.current?.resetView()}
        onZoomExtents={() => canvasRef.current?.zoomExtents()}
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
      />

      {/* Right: blackboard + node inspector */}
      <BTInspector />

      {/* Legend */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex gap-4 px-4 py-2 rounded-xl backdrop-blur-2xl border text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.55)]"
        style={{ background: 'var(--menu-bg, rgba(15,23,42,0.85))', borderColor: 'rgba(255,255,255,0.08)' }}>
        <Legend color="#475569" label="IDLE" />
        <Legend color="#06b6d4" label="RUNNING" />
        <Legend color="#10b981" label="SUCCESS" />
        <Legend color="#ef4444" label="FAILURE" />
      </div>

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
          <div
            className="fixed z-50 min-w-[170px] py-1.5 px-1.5 rounded-lg backdrop-blur-xl border border-[rgb(var(--fg-rgb)/0.1)] shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y, background: 'var(--menu-bg-solid)' }}
          >
            {contextNode ? (
              <>
                <SceneCtxItem onClick={() => {
                  select(contextNode.id);
                  canvasRef.current?.focusNode(contextNode.id);
                  setContextMenu(null);
                }}>
                  Focus
                </SceneCtxItem>
                <SceneCtxItem onClick={() => {
                  select(contextNode.id);
                  setContextMenu(null);
                }}>
                  Inspect
                </SceneCtxItem>
                {contextHasChildren && (
                  <SceneCtxItem onClick={() => {
                    toggleCollapse(contextNode.id);
                    setContextMenu(null);
                  }}>
                    {contextCollapsed ? 'Expand Children' : 'Collapse Children'}
                  </SceneCtxItem>
                )}
              </>
            ) : (
              <>
                <SceneCtxItem onClick={() => { canvasRef.current?.zoomExtents(); setContextMenu(null); }}>
                  Zoom Extents
                </SceneCtxItem>
                <SceneCtxItem onClick={() => { canvasRef.current?.resetView(); setContextMenu(null); }}>
                  Reset View
                </SceneCtxItem>
                <SceneCtxItem onClick={() => { collapseAll(); setContextMenu(null); }}>
                  Collapse All
                </SceneCtxItem>
                <SceneCtxItem onClick={() => { expandAll(); setContextMenu(null); }}>
                  Expand All
                </SceneCtxItem>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// Mirrors RosHeaderContent: a quick tree switcher plus a row of stat chips
// (Trees / Nodes / live status) styled identically to the ROS Introspection top.
function BtHeaderContent() {
  const treeIds = useTreeIds();
  const blueprint = useActiveBlueprint();
  const counts = useActiveStatusCounts();
  return (
    <>
      <TreeSelector />
      <div className="hidden md:flex items-center gap-6">
        <Stat icon={<GitBranch className="w-3.5 h-3.5" />} label="Trees" value={treeIds.length} colorHex="#a855f7" />
        <Stat icon={<Boxes className="w-3.5 h-3.5" />} label="Nodes" value={blueprint?.nodes.length ?? 0} colorHex="#38bdf8" />
        <Stat icon={<CircleDot className="w-3.5 h-3.5" />} label="Running" value={counts.running} colorHex="#06b6d4" />
        <Stat icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Success" value={counts.success} colorHex="#10b981" />
        <Stat icon={<XCircle className="w-3.5 h-3.5" />} label="Failure" value={counts.failure} colorHex="#ef4444" />
      </div>
    </>
  );
}

// Quick tree switcher in the header (the explorer offers the full browse).
function TreeSelector() {
  const treeIds = useTreeIds();
  const activeTreeId = useBtStore((s) => s.activeTreeId);
  const setActiveTree = useBtStore((s) => s.setActiveTree);
  const [open, setOpen] = useState(false);

  if (treeIds.length === 0) {
    return <span className="text-[11px] font-mono text-[color:rgb(var(--fg-rgb)/0.35)]">no tree loaded</span>;
  }

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[rgb(var(--fg-rgb)/0.04)] border border-[rgb(var(--fg-rgb)/0.08)] hover:bg-[rgb(var(--fg-rgb)/0.08)] transition-all">
        <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
        <span className="text-[12px] font-semibold text-[color:rgb(var(--fg-rgb))]">{activeTreeId}</span>
        {treeIds.length > 1 && <ChevronDown className="w-3.5 h-3.5 text-[color:rgb(var(--fg-rgb)/0.4)]" />}
      </button>
      {open && treeIds.length > 1 && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-2 z-50 min-w-[200px] py-1.5 rounded-lg backdrop-blur-xl border border-[rgb(var(--fg-rgb)/0.1)] shadow-xl"
            style={{ background: 'var(--menu-bg-solid, rgba(15,23,42,0.95))' }}>
            {treeIds.map((id) => (
              <button key={id} onClick={() => { setActiveTree(id); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-[rgb(var(--fg-rgb)/0.05)] transition-colors"
                style={{ color: id === activeTreeId ? 'rgb(var(--fg-rgb))' : 'rgb(var(--fg-rgb) / 0.6)' }}>
                <GitBranch className="w-3.5 h-3.5" style={{ color: id === activeTreeId ? '#06b6d4' : 'currentColor' }} />
                <span className="text-[12px] font-semibold">{id}</span>
                {id === activeTreeId && <span className="ml-auto text-[9px] text-[color:rgb(var(--fg-rgb)/0.35)]">active</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ConnBadge({ conn }: { conn: BtConnStatus }) {
  const c = CONN_STYLE[conn];
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[rgb(var(--fg-rgb)/0.04)] border border-[rgb(var(--fg-rgb)/0.08)]">
      <span className={`w-2 h-2 rounded-full ${c.cls} ${conn !== 'disconnected' ? 'animate-pulse' : ''}`} />
      <span className="text-[10px] font-bold tracking-widest text-[color:rgb(var(--fg-rgb)/0.6)]">{c.label}</span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

function SceneCtxItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-[rgb(var(--fg-rgb)/0.06)] rounded-md transition-colors" style={{ color: 'var(--menu-text-muted)' }}>
      {children}
    </button>
  );
}

function XmlDebugButton({ onOpen }: { onOpen: () => void }) {
  const blueprint = useActiveBlueprint();
  return (
    <button
      onClick={onOpen}
      disabled={!blueprint}
      title="View tree XML"
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[rgb(var(--fg-rgb)/0.04)] border border-[rgb(var(--fg-rgb)/0.08)] hover:bg-[rgb(var(--fg-rgb)/0.08)] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
    >
      <FileCode2 className="w-3.5 h-3.5 text-cyan-400" />
      <span className="text-[11px] font-mono text-[color:rgb(var(--fg-rgb)/0.7)]">XML</span>
    </button>
  );
}

function XmlDebugModal({ onClose }: { onClose: () => void }) {
  const blueprint = useActiveBlueprint();
  const [copied, setCopied] = useState(false);
  const xml = blueprint ? blueprintToXml(blueprint) : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(xml).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[700px] max-h-[80vh] rounded-2xl border border-[rgb(var(--fg-rgb)/0.08)] shadow-2xl flex flex-col overflow-hidden"
        style={{ background: 'var(--menu-bg-solid)' }}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[rgb(var(--fg-rgb)/0.07)] shrink-0">
          <div className="flex items-center gap-2">
            <FileCode2 className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-bold tracking-widest uppercase text-[color:rgb(var(--fg-rgb)/0.8)]">Tree XML</span>
            {blueprint && (
              <span className="text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.35)] ml-2">{blueprint.tree_id} · {blueprint.nodes.length} nodes</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[rgb(var(--fg-rgb)/0.05)] border border-[rgb(var(--fg-rgb)/0.08)] hover:bg-[rgb(var(--fg-rgb)/0.09)] transition-all text-[11px] font-semibold text-[color:rgb(var(--fg-rgb)/0.6)] hover:text-[color:rgb(var(--fg-rgb))]">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button onClick={onClose} className="text-[color:rgb(var(--fg-rgb)/0.3)] hover:text-[color:rgb(var(--fg-rgb)/0.7)] transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto scrollbar-thin p-4">
          <pre className="text-[11px] font-mono text-[color:rgb(var(--fg-rgb)/0.75)] whitespace-pre leading-relaxed">{xml}</pre>
        </div>
      </div>
    </div>
  );
}

// ── XML generation ───────────────────────────────────────────────────────────

function escXml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function decorAttrs(dec: BTDecorator): string {
  const parts: string[] = [];
  if (dec.name && dec.name !== dec.type) parts.push(`name="${escXml(dec.name)}"`);
  for (const [k, v] of Object.entries(dec.ports ?? {})) parts.push(`${k}="${escXml(String(v))}"`);
  return parts.length ? ' ' + parts.join(' ') : '';
}

function blueprintToXml(bp: BTBlueprint): string {
  const byId = new Map<number, BTNodeDef>(bp.nodes.map(n => [n.id, n]));

  function portsStr(node: BTNodeDef): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(node.ports.input ?? {})) parts.push(`${k}="${escXml(v)}"`);
    for (const [k, v] of Object.entries(node.ports.output ?? {})) parts.push(`${k}="${escXml(v)}"`);
    return parts.length ? ' ' + parts.join(' ') : '';
  }

  function render(id: number, depth: number): string {
    const node = byId.get(id);
    if (!node) return '';
    const pad = '  '.repeat(depth);
    const nameAttr = node.name !== node.type ? ` name="${escXml(node.name)}"` : '';
    const ports = portsStr(node);
    const decs = node.decorators;

    let prefix = '';
    let suffix = '';
    let inner = pad;
    for (const dec of decs) {
      prefix += `${inner}<${dec.type}${decorAttrs(dec)}>\n`;
      suffix = `${inner}</${dec.type}>\n` + suffix;
      inner += '  ';
    }

    const children = node.children.map(c => render(c, depth + decs.length + 1)).join('');
    if (node.children.length > 0) {
      return `${prefix}${inner}<${node.type}${nameAttr}${ports}>\n${children}${inner}</${node.type}>\n${suffix}`;
    }
    return `${prefix}${inner}<${node.type}${nameAttr}${ports}/>\n${suffix}`;
  }

  const body = render(bp.root_id, 2);
  return (
    `<root BTCPP_format="4" main_tree_to_execute="${escXml(bp.tree_id)}">\n` +
    `  <BehaviorTree ID="${escXml(bp.tree_id)}">\n` +
    body +
    `  </BehaviorTree>\n` +
    `</root>`
  );
}
