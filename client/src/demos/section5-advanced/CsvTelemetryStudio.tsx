import { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { createLoopbackDataChannelPair, type LoopbackDataChannelPair } from '@/lib/loopbackDataChannel';
import { Logger } from '@/lib/logger';

const SAMPLE_CSV = `timestamp_ms,rtt_ms,jitter_ms,packet_loss_percent
0,41,2.1,0.1
250,39,1.8,0.0
500,48,2.9,0.3
750,56,4.5,0.5
1000,44,2.2,0.1
1250,62,5.1,0.7
1500,51,3.4,0.2
1750,47,2.0,0.0`;

const CODE = `const parsed = Papa.parse(csv, {
  header: true,
  dynamicTyping: true,
  skipEmptyLines: true,
});

channel.send(JSON.stringify({
  type: 'telemetry',
  csv,
  rows: parsed.data,
}));`;

interface TelemetryRow {
  timestampMs: number;
  rttMs: number;
  jitterMs: number;
  packetLossPercent: number;
}

function parseTelemetry(csv: string): TelemetryRow[] {
  const parsed = Papa.parse<Record<string, number | string>>(csv, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });

  return parsed.data
    .map((row: Record<string, number | string>) => ({
      timestampMs: Number(row.timestamp_ms ?? 0),
      rttMs: Number(row.rtt_ms ?? 0),
      jitterMs: Number(row.jitter_ms ?? 0),
      packetLossPercent: Number(row.packet_loss_percent ?? 0),
    }))
    .filter((row: TelemetryRow) => Number.isFinite(row.rttMs) && row.timestampMs >= 0);
}

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sparkline(rows: TelemetryRow[], key: keyof Pick<TelemetryRow, 'rttMs' | 'jitterMs' | 'packetLossPercent'>, color: string) {
  if (!rows.length) {
    return null;
  }

  const values = rows.map((row) => row[key]);
  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => `${(index / Math.max(1, values.length - 1)) * 220},${56 - (value / max) * 48}`)
    .join(' ');

  return (
    <svg viewBox="0 0 220 60" className="h-14 w-full overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
}

function StatsBlock({ rows, label }: { rows: TelemetryRow[]; label: string }) {
  const avgRtt = average(rows.map((row) => row.rttMs));
  const avgJitter = average(rows.map((row) => row.jitterMs));
  const avgLoss = average(rows.map((row) => row.packetLossPercent));

  return (
    <div className="space-y-3 rounded-2xl border border-zinc-800 bg-surface-0 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-400">{label}</p>
        <span className="text-xs text-zinc-500">{rows.length} samples</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-xl bg-surface-1 p-3">
          <p className="text-zinc-500">Avg RTT</p>
          <p className="mt-1 text-lg font-semibold text-blue-300">{avgRtt.toFixed(1)} ms</p>
        </div>
        <div className="rounded-xl bg-surface-1 p-3">
          <p className="text-zinc-500">Avg jitter</p>
          <p className="mt-1 text-lg font-semibold text-amber-300">{avgJitter.toFixed(1)} ms</p>
        </div>
        <div className="rounded-xl bg-surface-1 p-3">
          <p className="text-zinc-500">Avg loss</p>
          <p className="mt-1 text-lg font-semibold text-rose-300">{avgLoss.toFixed(2)}%</p>
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">RTT</p>
        {sparkline(rows, 'rttMs', '#60a5fa')}
      </div>
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Jitter</p>
        {sparkline(rows, 'jitterMs', '#fbbf24')}
      </div>
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">Packet loss</p>
        {sparkline(rows, 'packetLossPercent', '#fb7185')}
      </div>
    </div>
  );
}

export default function CsvTelemetryStudio() {
  const logger = useMemo(() => new Logger(), []);
  const pairRef = useRef<LoopbackDataChannelPair | null>(null);
  const [connected, setConnected] = useState(false);
  const [csvA, setCsvA] = useState(SAMPLE_CSV);
  const [csvB, setCsvB] = useState(SAMPLE_CSV);
  const rowsA = useMemo(() => parseTelemetry(csvA), [csvA]);
  const rowsB = useMemo(() => parseTelemetry(csvB), [csvB]);

  const connect = async () => {
    pairRef.current?.close();
    const pair = await createLoopbackDataChannelPair('csv-telemetry', { logger });
    pairRef.current = pair;

    pair.channelA.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as { csv: string };
      setCsvA(payload.csv);
      logger.info('Peer A received telemetry CSV');
    };

    pair.channelB.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as { csv: string };
      setCsvB(payload.csv);
      logger.info('Peer B received telemetry CSV');
    };

    setConnected(true);
    logger.success('CSV telemetry studio connected');
  };

  const broadcast = (peer: 'A' | 'B') => {
    const csv = peer === 'A' ? csvA : csvB;
    const rows = parseTelemetry(csv);
    logger.success(`${peer} parsed ${rows.length} telemetry rows`);

    if (peer === 'A') {
      pairRef.current?.channelA.send(JSON.stringify({ type: 'telemetry', csv }));
    } else {
      pairRef.current?.channelB.send(JSON.stringify({ type: 'telemetry', csv }));
    }
  };

  return (
    <DemoLayout
      title="CSV Telemetry Studio"
      difficulty="advanced"
      description="Parse network telemetry CSV with PapaParse, then beam the dataset to a peer over RTCDataChannel for instant inspection."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Not every WebRTC workflow begins as a live stream. Sometimes a peer sends a diagnostics
            snapshot, a field report, or an exported metrics file. This demo uses <strong>PapaParse</strong>
            to ingest CSV and turn it into a lightweight telemetry dashboard.
          </p>
          <p>
            It is a handy pattern for support tools and incident war rooms where structured data still
            needs to move peer-to-peer.
          </p>
        </div>
      }
      hints={[
        'Edit the CSV, then broadcast it to the other panel to update the mini dashboard.',
        'Malformed lines are ignored once they no longer produce numeric metrics.',
        'This is a pure data-channel workflow: no media tracks required.',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            {!connected ? (
              <button
                onClick={connect}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Connect telemetry peers
              </button>
            ) : (
              <span className="rounded-xl border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
                Telemetry link live
              </span>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Peer A CSV</p>
                <button
                  onClick={() => broadcast('A')}
                  disabled={!connected}
                  className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  Broadcast →
                </button>
              </div>
              <textarea
                value={csvA}
                onChange={(event) => setCsvA(event.target.value)}
                className="h-56 w-full rounded-2xl border border-zinc-800 bg-surface-0 px-4 py-3 font-mono text-xs text-zinc-200 outline-none focus:border-blue-500"
              />
              <StatsBlock rows={rowsA} label="Peer A dashboard" />
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">Peer B CSV</p>
                <button
                  onClick={() => broadcast('B')}
                  disabled={!connected}
                  className="rounded-xl bg-fuchsia-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  ← Broadcast
                </button>
              </div>
              <textarea
                value={csvB}
                onChange={(event) => setCsvB(event.target.value)}
                className="h-56 w-full rounded-2xl border border-zinc-800 bg-surface-0 px-4 py-3 font-mono text-xs text-zinc-200 outline-none focus:border-fuchsia-500"
              />
              <StatsBlock rows={rowsB} label="Peer B dashboard" />
            </section>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'CSV parse + peer broadcast' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
