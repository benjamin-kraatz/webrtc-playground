import { useRef, useState, useCallback } from 'react';
import { parseStats, resetStatsParser } from '@/lib/statsParser';
import type { DerivedStats } from '@/types/stats';

export function useRtcStats(intervalMs = 1000) {
  const [stats, setStats] = useState<DerivedStats | null>(null);
  const [history, setHistory] = useState<DerivedStats[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback((pc: RTCPeerConnection) => {
    if (timer.current) return;
    resetStatsParser();

    timer.current = setInterval(async () => {
      try {
        const report = await pc.getStats();
        const derived = parseStats(report);
        setStats(derived);
        setHistory((h) => {
          const next = [...h, derived];
          return next.length > 60 ? next.slice(-60) : next;
        });
      } catch {
        // connection might be closed
      }
    }, intervalMs);
  }, [intervalMs]);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  return { stats, history, start, stop };
}
