import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import type { Logger, LogEntry } from '@/lib/logger';

const LEVEL_COLORS: Record<string, string> = {
  info: 'text-zinc-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  success: 'text-emerald-400',
  debug: 'text-blue-400',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

interface Props {
  logger: Logger;
  className?: string;
  maxHeight?: string;
}

export function LogPanel({ logger, className, maxHeight = '200px' }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return logger.subscribe(setEntries);
  }, [logger]);

  useEffect(() => {
    const el = containerRef.current;
    if (autoScroll && el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [entries, autoScroll]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 20;
    setAutoScroll(atBottom);
  };

  return (
    <div className={clsx('bg-surface-1 border border-zinc-800 rounded-lg overflow-hidden', className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Event Log</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-600">{entries.length} events</span>
          <button
            onClick={() => logger.clear()}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="overflow-y-auto font-mono text-xs p-2 space-y-0.5"
        style={{ maxHeight }}
      >
        {entries.length === 0 && (
          <p className="text-zinc-600 italic px-1">No events yet...</p>
        )}
        {entries.map((entry) => (
          <div key={entry.id} className="flex gap-2 leading-5">
            <span className="text-zinc-600 shrink-0 select-none">{formatTime(entry.timestamp)}</span>
            <span className={clsx('shrink-0 w-12 select-none', LEVEL_COLORS[entry.level])}>
              [{entry.level}]
            </span>
            <span className="text-zinc-300 break-all">{entry.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
