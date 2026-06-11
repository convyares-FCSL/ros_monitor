import { useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, Cpu, Radio, Server, Wrench, Eye, EyeOff, ChevronDown } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import type { GraphUpdate, SelectedEntity } from '../types';
import { isGenericNode, isGenericTopic, isGenericService } from '../three/SceneManager';

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
  graph: GraphUpdate | null;
  selectedEntity: SelectedEntity | null;
  onSelectEntity: (e: SelectedEntity | null) => void;
  onFocusEntity: (id: string) => void;
  hiddenItems: Set<string>;
  hiddenTypes: Set<string>;
  genericHidden: boolean;
  onToggleItem: (id: string) => void;
  onToggleType: (type: string) => void;
  onToggleGeneric: () => void;
  onToggleGenericItem: (id: string) => void;
  genericOverrides: Map<string, boolean>;
  onIsolate: (id: string) => void;
  onClearIsolation: () => void;
}

function isGenericFor(id: string, entityType: string): boolean {
  const name = id.slice(id.indexOf(':') + 1);
  if (entityType === 'node') return isGenericNode(name);
  if (entityType === 'topic') return isGenericTopic(name);
  if (entityType === 'service') return isGenericService(name);
  return false;
}

export function Sidebar({
  open, onToggle, graph, selectedEntity, onSelectEntity, onFocusEntity,
  hiddenItems, hiddenTypes, genericHidden, onToggleItem, onToggleType, onToggleGeneric,
  onToggleGenericItem, onIsolate, onClearIsolation,
}: SidebarProps) {
  const { theme } = useTheme();
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string; entityType: string } | null>(null);

  const handleContext = useCallback((e: React.MouseEvent, id: string, entityType: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, id, entityType });
  }, []);

  const closeContext = () => setContextMenu(null);

  return (
    <>
      <aside className={`fixed left-3 z-20 flex flex-col w-72 rounded-2xl overflow-hidden
        backdrop-blur-2xl transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
        ${open ? 'translate-x-0' : '-translate-x-[calc(100%+12px)]'}`}
        style={{ background: 'var(--menu-bg)', border: `1px solid ${theme.panelBorder}`, top: '68px', height: 'calc(100vh - 68px - 240px)', color: 'var(--menu-text)' }}>

        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${theme.panelBorder}` }}>
          <span className="text-xs font-bold tracking-widest uppercase" style={{ color: 'var(--menu-text-muted)' }}>Network Explorer</span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 scrollbar-thin">
          {graph ? (
            <>
              <Section
                icon={<Cpu className="w-3.5 h-3.5" />}
                title="Nodes" entityType="node" colorHex={theme.nodeColorHex}
                items={graph.nodes
                  .filter(n => !genericHidden || !isGenericNode(n.name))
                  .map(n => ({ id: `node:${n.name}`, label: n.name, sub: n.namespace !== '/' ? n.namespace : undefined, phantom: n.pid === null }))}
                genericItems={graph.nodes.filter(n => isGenericNode(n.name)).map(n => ({ id: `node:${n.name}`, label: n.name }))}
                visibleCount={graph.nodes.filter(n => !hiddenItems.has(`node:${n.name}`) && (!genericHidden || !isGenericNode(n.name))).length}
                totalCount={graph.nodes.length}
                selectedEntity={selectedEntity}
                hiddenItems={hiddenItems}
                typeHidden={hiddenTypes.has('node')}
                genericHidden={genericHidden}
                onSelect={onSelectEntity}
                onFocus={onFocusEntity}
                onContext={handleContext}
                onToggleItem={onToggleItem}
                onToggleType={() => onToggleType('node')}
                onToggleGeneric={onToggleGeneric}
              />
              <Section
                icon={<Radio className="w-3.5 h-3.5" />}
                title="Topics" entityType="topic" colorHex={theme.topicColorHex}
                items={graph.topics
                  .filter(t => !genericHidden || !isGenericTopic(t.name))
                  .map(t => ({ id: `topic:${t.name}`, label: t.name, sub: t.types[0]?.split('/').pop() }))}
                genericItems={graph.topics.filter(t => isGenericTopic(t.name)).map(t => ({ id: `topic:${t.name}`, label: t.name }))}
                visibleCount={graph.topics.filter(t => !hiddenItems.has(`topic:${t.name}`) && (!genericHidden || !isGenericTopic(t.name))).length}
                totalCount={graph.topics.length}
                selectedEntity={selectedEntity}
                hiddenItems={hiddenItems}
                typeHidden={hiddenTypes.has('topic')}
                genericHidden={genericHidden}
                onSelect={onSelectEntity}
                onFocus={onFocusEntity}
                onContext={handleContext}
                onToggleItem={onToggleItem}
                onToggleType={() => onToggleType('topic')}
                onToggleGeneric={onToggleGeneric}
              />
              <Section
                icon={<Server className="w-3.5 h-3.5" />}
                title="Services" entityType="service" colorHex={theme.serviceColorHex}
                items={graph.services
                  .filter(s => !genericHidden || !isGenericService(s.name))
                  .map(s => ({ id: `service:${s.name}`, label: s.name, sub: s.clients.length > 0 ? 'connected' : 'orphan' }))}
                genericItems={graph.services.filter(s => isGenericService(s.name)).map(s => ({ id: `service:${s.name}`, label: s.name }))}
                visibleCount={graph.services.filter(s => !hiddenItems.has(`service:${s.name}`) && (!genericHidden || !isGenericService(s.name))).length}
                totalCount={graph.services.length}
                selectedEntity={selectedEntity}
                hiddenItems={hiddenItems}
                typeHidden={hiddenTypes.has('service')}
                genericHidden={genericHidden}
                onSelect={onSelectEntity}
                onFocus={onFocusEntity}
                onContext={handleContext}
                onToggleItem={onToggleItem}
                onToggleType={() => onToggleType('service')}
                onToggleGeneric={onToggleGeneric}
              />
              <Section
                icon={<Wrench className="w-3.5 h-3.5" />}
                title="Actions" entityType="action" colorHex={theme.actionColorHex}
                items={graph.actions.map(a => ({ id: `action:${a.name}`, label: a.name, sub: a.type.split('/').pop() }))}
                genericItems={[]}
                visibleCount={graph.actions.filter(a => !hiddenItems.has(`action:${a.name}`)).length}
                totalCount={graph.actions.length}
                selectedEntity={selectedEntity}
                hiddenItems={hiddenItems}
                typeHidden={hiddenTypes.has('action')}
                genericHidden={genericHidden}
                onSelect={onSelectEntity}
                onFocus={onFocusEntity}
                onContext={handleContext}
                onToggleItem={onToggleItem}
                onToggleType={() => onToggleType('action')}
                onToggleGeneric={onToggleGeneric}
              />
            </>
          ) : (
            <div className="flex items-center justify-center h-32 text-white/30 text-xs">Waiting for data...</div>
          )}
        </div>
      </aside>

      <button
        onClick={onToggle}
        className={`fixed z-30 w-6 h-10 flex items-center justify-center
          backdrop-blur-xl border border-white/[0.08] rounded-r-md
          hover:opacity-80 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
          ${open ? 'left-[300px]' : 'left-0'}`}
        style={{ top: '88px', background: 'var(--menu-bg)', color: 'var(--menu-text-muted)' }}
      >
        {open ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
      </button>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={closeContext} />
          <div className="fixed z-50 min-w-[160px] py-1.5 px-1.5 rounded-lg backdrop-blur-xl border border-white/[0.1] shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y, background: 'var(--menu-bg)' }}>
            <CtxItem onClick={() => { onToggleItem(contextMenu.id); closeContext(); }}>
              {hiddenItems.has(contextMenu.id) ? 'Show' : 'Hide'}
            </CtxItem>
            <CtxItem onClick={() => { onIsolate(contextMenu.id); closeContext(); }}>Isolate</CtxItem>
            {contextMenu.entityType !== 'action' && (
              <CtxItem onClick={() => { onToggleGenericItem(contextMenu.id); closeContext(); }}>
                {isGenericFor(contextMenu.id, contextMenu.entityType) ? 'Unmark Generic' : 'Mark Generic'}
              </CtxItem>
            )}
            <CtxItem onClick={() => { onClearIsolation(); closeContext(); }}>Clear Isolation</CtxItem>
          </div>
        </>
      )}
    </>
  );
}

function CtxItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-white/[0.06] rounded-md transition-colors" style={{ color: 'var(--menu-text-muted)' }}>
      {children}
    </button>
  );
}

interface SectionItem { id: string; label: string; sub?: string; phantom?: boolean }

function Section({
  icon, title, entityType, colorHex, items, genericItems, visibleCount, totalCount,
  selectedEntity, hiddenItems, typeHidden, genericHidden,
  onSelect, onFocus, onContext, onToggleItem, onToggleType, onToggleGeneric,
}: {
  icon: React.ReactNode; title: string; entityType: string; colorHex: string;
  items: SectionItem[]; genericItems: SectionItem[];
  visibleCount: number; totalCount: number;
  selectedEntity: SelectedEntity | null; hiddenItems: Set<string>;
  typeHidden: boolean; genericHidden: boolean;
  onSelect: (e: SelectedEntity | null) => void; onFocus: (id: string) => void;
  onContext: (e: React.MouseEvent, id: string, entityType: string) => void;
  onToggleItem: (id: string) => void; onToggleType: () => void; onToggleGeneric: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section>
      <div className="flex items-center gap-2 mb-1.5 px-1">
        <span style={{ color: colorHex }} className="opacity-80">{icon}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest flex-1" style={{ color: 'var(--menu-text-muted)' }}>{title}</span>
        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full" style={{ background: 'var(--menu-text-dim)', color: 'var(--menu-text-muted)' }}>
          {visibleCount}/{totalCount}
        </span>
        <button onClick={onToggleType} className={`hover:opacity-80 transition-colors ${typeHidden ? 'opacity-40' : ''}`} style={{ color: 'var(--menu-text-dim)' }}>
          {typeHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        </button>
        <button onClick={() => setCollapsed(c => !c)} className="hover:opacity-80 transition-colors" style={{ color: 'var(--menu-text-dim)' }}>
          <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`} />
        </button>
      </div>

      {!collapsed && (
        <ul className="space-y-0.5">
          {items.map(item => {
            const isSelected = selectedEntity?.entityType === entityType && selectedEntity.id === item.id;
            const isHidden = hiddenItems.has(item.id);
            return (
              <li
                key={item.id}
                onClick={() => { onSelect(isSelected ? null : { entityType: entityType as SelectedEntity['entityType'], id: item.id }); onFocus(item.id); }}
                onContextMenu={(e) => onContext(e, item.id, entityType)}
                className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer
                  border transition-all duration-150 text-[11px] font-mono
                  ${isSelected ? 'bg-white/[0.08]' : 'border-transparent bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10'}
                  ${isHidden ? 'opacity-35' : ''}`}
                style={isSelected ? { borderColor: `${colorHex}66` } : undefined}
              >
                <span className="flex-1 truncate" style={isSelected ? { color: colorHex } : { color: 'var(--menu-text)', opacity: 0.7 }}>
                  {item.label}
                </span>
                {item.phantom && <span className="text-[8px] px-1 rounded" style={{ color: 'var(--menu-text-dim)', background: 'var(--menu-text-dim)' }}>phantom</span>}
                {item.sub && <span className="text-[9px] font-sans truncate max-w-[70px]" style={{ color: 'var(--menu-text-dim)' }}>{item.sub}</span>}
                <button
                  onClick={e => { e.stopPropagation(); onToggleItem(item.id); }}
                  className="opacity-0 group-hover:opacity-100 hover:opacity-80 transition-all flex-shrink-0"
                  style={{ color: 'var(--menu-text-dim)' }}
                >
                  {isHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </li>
            );
          })}

          {genericItems.length > 0 && (
            <li className="mt-1">
              <details className="group/gen">
                <summary className="flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer text-[10px] text-white/30 hover:bg-white/[0.03] list-none">
                  <ChevronRight className="w-3 h-3 transition-transform duration-150 group-open/gen:rotate-90" />
                  <span className="uppercase tracking-widest font-bold flex-1">Built-in ({genericItems.length})</span>
                  <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleGeneric(); }}
                    className="text-white/20 hover:text-white/50">
                    {genericHidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                </summary>
                <ul className="ml-3 mt-0.5 border-l border-white/[0.06] pl-2 space-y-0.5">
                  {genericItems.map(item => (
                    <li key={item.id}
                      onContextMenu={(e) => onContext(e, item.id, entityType)}
                      title="Right-click to unmark generic"
                      className="text-[10px] font-mono text-white/25 px-2 py-1 rounded-md hover:bg-white/[0.02] cursor-context-menu">
                      {item.label}
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
