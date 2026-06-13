import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useBtStore, useActiveBlueprint, useNodeStatus } from '../store/btStore';
import { computeLayout, type BTLayout } from './layout';
import { BTNode } from './BTNode';

export interface BTCanvasHandle {
  recenter: () => void;
  focusNode: (id: number) => void;
}

// A single parent→child connector. Subscribes to the child's status so only the
// live (RUNNING) path animates, and a delta repaints just this wire.
function BTWire({ childId, d }: { childId: number; d: string }) {
  const status = useNodeStatus(childId);
  return <path d={d} className={`bt-wire ${status === 'RUNNING' ? 'bt-wire-running' : ''}`} />;
}

interface View { x: number; y: number; scale: number }

export const BTCanvas = forwardRef<BTCanvasHandle>(function BTCanvas(_props, ref) {
  const blueprint = useActiveBlueprint();
  const activeTreeId = useBtStore((s) => s.activeTreeId);
  const collapsed = useBtStore((s) => s.collapsed);
  const select = useBtStore((s) => s.select);

  const layout = useMemo(
    () => (blueprint ? computeLayout(blueprint, collapsed) : null),
    [blueprint, collapsed],
  );

  const stageRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 120, y: 80, scale: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef<{ lastX: number; lastY: number; moved: boolean; id: number } | null>(null);
  const movedRef = useRef(false);

  const fit = (lo: BTLayout) => {
    const w = stageRef.current?.clientWidth ?? window.innerWidth;
    setView({ x: Math.max(40, (w - lo.width) / 2), y: 80, scale: 1 });
  };

  // Imperative controls for the controls overlay + tree explorer.
  useImperativeHandle(ref, () => ({
    recenter: () => { if (layout) fit(layout); },
    focusNode: (id: number) => {
      select(id);
      const box = layout?.boxes.get(id);
      const stage = stageRef.current;
      if (!box || !stage) return;
      const scale = Math.max(viewRef.current.scale, 0.8);
      setView({
        x: stage.clientWidth / 2 - (box.x + box.w / 2) * scale,
        y: stage.clientHeight / 2 - (box.y + box.h / 2) * scale,
        scale,
      });
    },
  }), [layout, select]);

  // Re-center when the active tree (or its structure) changes.
  useEffect(() => {
    if (layout) fit(layout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTreeId, blueprint?.version]);

  // Wheel zoom toward the cursor (native non-passive listener).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const next = Math.min(2.5, Math.max(0.2, v.scale * factor));
      const rect = stage.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setView({
        x: cx - (cx - v.x) * (next / v.scale),
        y: cy - (cy - v.y) * (next / v.scale),
        scale: next,
      });
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  // Pan only after the pointer actually moves, so a plain click still selects.
  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { lastX: e.clientX, lastY: e.clientY, moved: false, id: e.pointerId };
    movedRef.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > 3) {
      d.moved = true;
      movedRef.current = true;
      try { (e.currentTarget as HTMLElement).setPointerCapture(d.id); } catch { /* noop */ }
    }
    if (d.moved) {
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.moved) {
      try { (e.currentTarget as HTMLElement).releasePointerCapture(d.id); } catch { /* noop */ }
    }
  };
  const onClick = () => {
    if (movedRef.current) { movedRef.current = false; return; }
    select(null);
  };

  return (
    <div
      ref={stageRef}
      className="absolute inset-0 overflow-hidden cursor-grab active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={onClick}
    >
      {layout ? (
        <div className="absolute top-0 left-0 origin-top-left"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
          <svg className="absolute top-0 left-0 overflow-visible" width={layout.width} height={layout.height}
            style={{ pointerEvents: 'none' }}>
            {layout.wires.map((w) => <BTWire key={w.childId} childId={w.childId} d={w.d} />)}
          </svg>
          {[...layout.boxes.values()].map((box) => <BTNode key={box.id} box={box} />)}
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-sm font-semibold text-white/70">Waiting for a behavior tree…</div>
            <div className="mt-1.5 text-[11px] font-mono text-white/35">run the bridge with <span className="text-cyan-400">--bt</span></div>
          </div>
        </div>
      )}
    </div>
  );
});
