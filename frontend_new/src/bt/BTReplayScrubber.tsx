import { useEffect, useRef, useState } from 'react';
import { Play, Pause, Film } from 'lucide-react';
import { useReplayStore } from '../store/replayStore';
import { sendFrame } from '../bridge/connection';

const SPEEDS = [1, 5, 20, 60] as const;

function fmtTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function drawDensity(canvas: HTMLCanvasElement, density: number[]) {
  const ctx = canvas.getContext('2d');
  if (!ctx || density.length === 0) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const max = Math.max(...density, 1);
  const bins = density.length;
  const bw = w / bins;

  ctx.fillStyle = 'rgba(6,182,212,0.35)';
  for (let i = 0; i < bins; i++) {
    const barH = (density[i] / max) * h;
    ctx.fillRect(i * bw, h - barH, Math.max(bw - 0.5, 0.5), barH);
  }
}

export function BTReplayScrubber() {
  const { position_s, duration_s, playing, speed, filename, density } = useReplayStore();
  const [dragging, setDragging] = useState(false);
  const [localPos, setLocalPos] = useState(0);
  const displayPos = dragging ? localPos : position_s;
  const pct = duration_s > 0 ? (displayPos / duration_s) * 100 : 0;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Draw density overlay whenever bins arrive or canvas resizes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      if (w > 0) {
        canvas.width = Math.round(w * devicePixelRatio);
        canvas.height = Math.round(24 * devicePixelRatio);
        drawDensity(canvas, density);
      }
    });
    ro.observe(container);

    // Trigger initial draw if we already have data.
    if (canvas.width > 0) drawDensity(canvas, density);

    return () => ro.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [density]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setLocalPos(val);
    if (!dragging) setDragging(true);
  };

  const commitSeek = () => {
    setDragging(false);
    sendFrame({ type: 'replay_control', action: 'seek', position_s: localPos });
  };

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 w-full max-w-2xl px-4 pointer-events-none">
      <div
        className="pointer-events-auto px-4 pt-2.5 pb-3 rounded-2xl border backdrop-blur-2xl flex flex-col gap-2"
        style={{ background: 'var(--menu-bg, rgba(15,23,42,0.88))', borderColor: 'rgba(255,255,255,0.08)' }}
      >
        {/* Row 1: filename + timestamp */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <Film className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="text-[10px] font-mono text-[color:rgb(var(--fg-rgb)/0.45)] truncate">
              {filename}
            </span>
          </div>
          <span className="text-[11px] font-mono tabular-nums shrink-0 text-[color:rgb(var(--fg-rgb)/0.65)]">
            {fmtTime(displayPos)}<span className="text-[color:rgb(var(--fg-rgb)/0.3)]"> / </span>{fmtTime(duration_s)}
          </span>
        </div>

        {/* Row 2: density histogram canvas */}
        <div ref={containerRef} className="w-full h-6 relative rounded overflow-hidden"
             style={{ background: 'rgba(255,255,255,0.04)' }}>
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
            style={{ imageRendering: 'pixelated' }}
          />
          {/* Playhead line */}
          <div
            className="absolute top-0 bottom-0 w-px bg-cyan-400/70 pointer-events-none"
            style={{ left: `${pct}%` }}
          />
        </div>

        {/* Row 3: play/pause · scrubber · speed */}
        <div className="flex items-center gap-3">
          {/* Play / Pause */}
          <button
            onClick={() => sendFrame({ type: 'replay_control', action: playing ? 'pause' : 'play' })}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-all
                       bg-cyan-500/10 border border-cyan-400/20 hover:bg-cyan-500/25 hover:border-cyan-400/40"
          >
            {playing
              ? <Pause className="w-3.5 h-3.5 text-cyan-400" />
              : <Play  className="w-3.5 h-3.5 text-cyan-400" />
            }
          </button>

          {/* Timeline scrubber */}
          <div className="flex-1 relative h-4 flex items-center group">
            {/* Track */}
            <div className="absolute inset-x-0 h-1.5 rounded-full overflow-hidden"
                 style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-full rounded-full bg-cyan-400 transition-none"
                   style={{ width: `${pct}%` }} />
            </div>
            <input
              type="range"
              min={0}
              max={duration_s || 1}
              step={0.5}
              value={displayPos}
              onChange={handleChange}
              onMouseUp={commitSeek}
              onTouchEnd={commitSeek}
              className="absolute inset-x-0 h-full opacity-0 cursor-pointer"
              style={{ width: '100%' }}
            />
          </div>

          {/* Speed buttons */}
          <div className="flex items-center gap-0.5 shrink-0">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => sendFrame({ type: 'replay_control', action: 'set_speed', speed: s })}
                className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold transition-all"
                style={{
                  background: speed === s ? 'rgba(6,182,212,0.15)' : 'transparent',
                  color: speed === s ? '#06b6d4' : 'rgb(var(--fg-rgb)/0.35)',
                  border: `1px solid ${speed === s ? 'rgba(6,182,212,0.35)' : 'transparent'}`,
                }}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
