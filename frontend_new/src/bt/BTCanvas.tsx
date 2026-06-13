import { useEffect, useMemo, useRef, useState } from 'react';
import { useBtStore } from '../store/btStore';
import { computeLayout } from './layout';
import { BTNode } from './BTNode';

// A single parent→child connector. Subscribes to the child's status so only the
// live (RUNNING) path animates, and a delta repaints just this wire.
function BTWire({ childId, d }: { childId: number; d: string }) {
  const status = useBtStore((s) => s.statusById[childId]);
  return <path d={d} className={`bt-wire ${status === 'RUNNING' ? 'bt-wire-running' : ''}`} />;
}

interface View { x: number; y: number; scale: number }

export function BTCanvas() {
  const blueprint = useBtStore((s) => s.blueprint);
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
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  // Re-center horizontally when a new tree version loads.
  useEffect(() => {
    if (layout && stageRef.current) {
      const w = stageRef.current.clientWidth;
      setView((v) => ({ ...v, x: Math.max(40, (w - layout.width) / 2), y: 80 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blueprint?.version]);

  // Wheel zoom toward the cursor (native non-passive listener so preventDefault works).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const next = Math.min(2.5, Math.max(0.25, v.scale * factor));
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

  if (!layout) {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className="text-sm font-semibold text-white/70">Waiting for a behavior tree…</div>
          <div className="mt-1.5 text-[11px] font-mono text-white/35">run the bridge with <span className="text-cyan-400">--bt</span></div>
        </div>
      </div>
    );
  }

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  return (
    <div
      ref={stageRef}
      className="absolute inset-0 overflow-hidden cursor-grab active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={() => select(null)}
    >
      <div className="absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        <svg className="absolute top-0 left-0 overflow-visible" width={layout.width} height={layout.height}
          style={{ pointerEvents: 'none' }}>
          {layout.wires.map((w) => <BTWire key={w.childId} childId={w.childId} d={w.d} />)}
        </svg>
        {[...layout.boxes.values()].map((box) => <BTNode key={box.id} box={box} />)}
      </div>
    </div>
  );
}
