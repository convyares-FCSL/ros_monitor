import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ScrollText, Search, Trash2, Copy, ArrowDownToLine, X } from 'lucide-react';
import { TopBar } from '../components/TopBar';
import { useTheme } from '../hooks/useTheme';
import {
  useEventLogStore, type LogEntry, type LogLevel, type LogSource,
} from '../store/eventLogStore';

const ROW_H = 26;

const LEVELS: LogLevel[] = ['debug', 'info', 'warn', 'error', 'fatal'];
const LEVEL_COLOR: Record<LogLevel, string> = {
  debug: '#64748b', info: '#38bdf8', warn: '#f59e0b', error: '#ef4444', fatal: '#e879f9',
};

const SOURCES: { key: LogSource; label: string }[] = [
  { key: 'rosout', label: 'ROSOUT' },
  { key: 'lifecycle', label: 'LIFECYCLE' },
  { key: 'service', label: 'SERVICE' },
  { key: 'topic', label: 'TOPIC' },
  { key: 'system', label: 'SYSTEM' },
];

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function Logging() {
  const { theme } = useTheme();
  const entries = useEventLogStore((s) => s.entries);
  const dropped = useEventLogStore((s) => s.dropped);
  const clear = useEventLogStore((s) => s.clear);

  // Sources default-on except the chatty topic stream, which users opt into.
  const [levels, setLevels] = useState<Set<LogLevel>>(() => new Set(LEVELS));
  const [sources, setSources] = useState<Set<LogSource>>(
    () => new Set<LogSource>(['rosout', 'lifecycle', 'service', 'system']),
  );
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<LogEntry | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (!levels.has(e.level)) return false;
      if (!sources.has(e.source)) return false;
      if (q) {
        const hay = `${e.text} ${e.node ?? ''} ${e.topic ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, levels, sources, query]);

  // --- Lightweight windowed rendering (no external virtualization dep) ---
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setScrollTop(el.scrollTop);
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < ROW_H * 2;
    setAutoScroll(atBottom);
  }, []);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Stick to the tail as new lines arrive, unless the user scrolled up.
  useEffect(() => {
    if (autoScroll && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  const total = filtered.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 5);
  const end = Math.min(total, start + Math.ceil(viewH / ROW_H) + 10);
  const slice = filtered.slice(start, end);

  const jumpToLive = () => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setAutoScroll(true);
  };

  const copyVisible = () => {
    const json = JSON.stringify(filtered.map((e) => ({
      ts: new Date(e.ts).toISOString(), level: e.level, source: e.source,
      node: e.node, topic: e.topic, text: e.text,
    })), null, 2);
    navigator.clipboard.writeText(json);
  };

  const toggle = <T,>(set: Set<T>, key: T): Set<T> => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  };

  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: theme.bg }}>
      <TopBar title="Logging" icon={ScrollText}>
        <div className="flex items-center gap-4 text-[11px] font-mono">
          <span style={{ color: 'var(--menu-text-muted, rgba(255,255,255,0.55))' }}>
            {filtered.length.toLocaleString()} / {entries.length.toLocaleString()} lines
          </span>
          {dropped > 0 && (
            <span style={{ color: '#f59e0b' }} title="Oldest lines discarded by the ring buffer">
              {dropped.toLocaleString()} dropped
            </span>
          )}
          {!autoScroll && (
            <button onClick={jumpToLive}
              className="flex items-center gap-1 px-2 py-1 rounded-md bg-[rgb(var(--fg-rgb)/0.06)] border border-[rgb(var(--fg-rgb)/0.1)] hover:bg-[rgb(var(--fg-rgb)/0.12)] transition-all">
              <ArrowDownToLine className="w-3 h-3" /> Live
            </button>
          )}
        </div>
      </TopBar>

      <div className="absolute top-14 left-0 right-0 bottom-0 flex flex-col">
        {/* Filter toolbar */}
        <div className="flex items-center gap-3 flex-wrap px-5 py-2.5 border-b border-[rgb(var(--fg-rgb)/0.07)] shrink-0">
          <div className="flex items-center gap-1">
            {LEVELS.map((lv) => {
              const on = levels.has(lv);
              return (
                <button key={lv} onClick={() => setLevels((s) => toggle(s, lv))}
                  className="px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all border"
                  style={{
                    color: on ? LEVEL_COLOR[lv] : 'var(--page-text-dim)',
                    background: on ? `${LEVEL_COLOR[lv]}1f` : 'transparent',
                    borderColor: on ? `${LEVEL_COLOR[lv]}55` : 'color-mix(in srgb, var(--page-text) 8%, transparent)',
                  }}>
                  {lv}
                </button>
              );
            })}
          </div>

          <div className="w-px h-5" style={{ background: 'color-mix(in srgb, var(--page-text) 15%, transparent)' }} />

          <div className="flex items-center gap-1">
            {SOURCES.map((s) => {
              const on = sources.has(s.key);
              return (
                <button key={s.key} onClick={() => setSources((cur) => toggle(cur, s.key))}
                  className="px-2 py-1 rounded-md text-[10px] font-semibold tracking-wider transition-all border"
                  style={{
                    color: on ? 'var(--page-text)' : 'var(--page-text-dim)',
                    background: on ? 'color-mix(in srgb, var(--page-text) 8%, transparent)' : 'transparent',
                    borderColor: on ? 'color-mix(in srgb, var(--page-text) 18%, transparent)' : 'color-mix(in srgb, var(--page-text) 8%, transparent)',
                  }}>
                  {s.label}
                </button>
              );
            })}
          </div>

          <div className="flex-1" />

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: 'var(--page-text-dim)' }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter…"
              className="w-48 pl-8 pr-3 py-1.5 rounded-lg border text-[11px] focus:outline-none"
              style={{
                color: 'var(--page-text)',
                background: 'color-mix(in srgb, var(--page-text) 5%, transparent)',
                borderColor: 'color-mix(in srgb, var(--page-text) 12%, transparent)',
              }} />
          </div>

          <button onClick={copyVisible} title="Copy filtered lines as JSON"
            className="p-1.5 rounded-md border transition-all" style={{ color: 'var(--page-text-muted)', borderColor: 'color-mix(in srgb, var(--page-text) 12%, transparent)' }}>
            <Copy className="w-3.5 h-3.5" />
          </button>
          <button onClick={clear} title="Clear buffer"
            className="p-1.5 rounded-md border transition-all hover:text-red-400" style={{ color: 'var(--page-text-muted)', borderColor: 'color-mix(in srgb, var(--page-text) 12%, transparent)' }}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body: console + detail drawer */}
        <div className="flex-1 flex min-h-0">
          <div ref={listRef} onScroll={onScroll} className="flex-1 overflow-y-auto scrollbar-thin font-mono">
            {total === 0 ? (
              <div className="h-full flex items-center justify-center text-[11px] uppercase tracking-widest" style={{ color: 'var(--page-text-dim)' }}>
                No log entries match the current filters
              </div>
            ) : (
              <div style={{ height: total * ROW_H, position: 'relative' }}>
                <div style={{ position: 'absolute', top: start * ROW_H, left: 0, right: 0 }}>
                  {slice.map((e) => (
                    <Row key={e.id} entry={e} selected={selected?.id === e.id} onClick={() => setSelected(e)} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {selected && <DetailDrawer entry={selected} onClose={() => setSelected(null)} />}
        </div>
      </div>
    </div>
  );
}

function Row({ entry, selected, onClick }: { entry: LogEntry; selected: boolean; onClick: () => void }) {
  const color = LEVEL_COLOR[entry.level];
  return (
    <div onClick={onClick}
      className={`flex items-center gap-3 px-5 cursor-pointer text-[11px] leading-none border-l-2 ${selected ? 'bg-[rgb(var(--fg-rgb)/0.06)]' : 'hover:bg-[rgb(var(--fg-rgb)/0.03)]'}`}
      style={{ height: ROW_H, borderColor: selected ? color : 'transparent' }}>
      <span className="tabular-nums shrink-0" style={{ color: 'var(--page-text-dim)' }}>{fmtTime(entry.ts)}</span>
      <span className="shrink-0 w-12 font-bold uppercase" style={{ color }}>{entry.level}</span>
      <span className="shrink-0 w-20 truncate uppercase text-[9px] tracking-wider" style={{ color: 'var(--page-text-dim)' }}>{entry.source}</span>
      {(entry.node || entry.topic) && (
        <span className="shrink-0 max-w-[180px] truncate" style={{ color: 'var(--page-text-muted)' }}>{entry.node ?? entry.topic}</span>
      )}
      <span className="truncate" style={{ color: 'var(--page-text)' }}>{entry.text}</span>
    </div>
  );
}

function DetailDrawer({ entry, onClose }: { entry: LogEntry; onClose: () => void }) {
  return (
    <div className="w-96 shrink-0 border-l border-[rgb(var(--fg-rgb)/0.08)] flex flex-col" style={{ background: 'var(--menu-bg-solid, #0f172a)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[rgb(var(--fg-rgb)/0.07)]">
        <span className="text-xs font-bold uppercase tracking-widest text-[color:rgb(var(--fg-rgb)/0.7)]">Log Detail</span>
        <button onClick={onClose} className="text-[color:rgb(var(--fg-rgb)/0.3)] hover:text-[color:rgb(var(--fg-rgb)/0.7)]"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4 space-y-3">
        <Field label="Time" value={new Date(entry.ts).toISOString()} />
        <Field label="Level" value={entry.level.toUpperCase()} color={LEVEL_COLOR[entry.level]} />
        <Field label="Source" value={entry.source} />
        {entry.node && <Field label="Node" value={entry.node} />}
        {entry.topic && <Field label="Topic" value={entry.topic} />}
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[color:rgb(var(--fg-rgb)/0.35)] mb-1">Message</p>
          <p className="text-[12px] text-[color:rgb(var(--fg-rgb)/0.85)] leading-relaxed break-words">{entry.text}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-[color:rgb(var(--fg-rgb)/0.35)] mb-1">Raw</p>
          <pre className="p-3 rounded-lg bg-black/40 border border-[rgb(var(--fg-rgb)/0.06)] text-[10px] text-cyan-300/80 overflow-auto max-h-[40vh] whitespace-pre-wrap break-words">
            {JSON.stringify(entry.raw, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] uppercase tracking-widest text-[color:rgb(var(--fg-rgb)/0.35)]">{label}</span>
      <span className="text-[11px] font-mono truncate" style={{ color: color ?? 'rgb(var(--fg-rgb) / 0.8)' }}>{value}</span>
    </div>
  );
}
