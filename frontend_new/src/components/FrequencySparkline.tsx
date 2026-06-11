import { useRef, useEffect } from 'react';
import type { TopicHzState } from '../types';

interface SparklineProps {
  history: TopicHzState['history'];
  health: TopicHzState['health'];
  height?: number;
}

export function FrequencySparkline({ history, health, height = 30 }: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container || history.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = container.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const values = history.map(h => h.hz);
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const range = max - min || 1;

    const color = health === 'stable' ? '#10b981' : health === 'jitter' ? '#f59e0b' : '#ef4444';

    // Draw fill
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i < values.length; i++) {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((values[i] - min) / range) * (height - 8) - 4;
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fillStyle = color + '15';
    ctx.fill();

    // Draw line
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((values[i] - min) / range) * (height - 8) - 4;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Max line
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = color + '40';
    ctx.lineWidth = 0.5;
    const maxY = height - ((max - min) / range) * (height - 8) - 4;
    ctx.beginPath();
    ctx.moveTo(0, maxY);
    ctx.lineTo(width, maxY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Max label
    ctx.fillStyle = color + '80';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText(`${max.toFixed(1)}`, 2, maxY - 2);
  }, [history, health, height]);

  return (
    <div ref={containerRef} className="w-full">
      <canvas
        ref={canvasRef}
        style={{ height }}
        className="w-full rounded-md bg-black/30 border border-white/[0.05]"
      />
    </div>
  );
}
