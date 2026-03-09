import { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { createLoopbackDataPair, type LoopbackDataPair } from '@/lib/createLoopbackDataPair';

const DEFAULT_CSV = `time,latency_ms,loss_pct
00:00,42,0.2
00:01,47,0.1
00:02,50,0.3
00:03,39,0.0
00:04,63,0.8`;

const CODE = `const parsed = Papa.parse(csvText, {
  header: true,
  dynamicTyping: true,
  skipEmptyLines: true,
});
dc.send(JSON.stringify({ type: 'csv', csvText }));`;

function parseSummary(csv: string) {
  const result = Papa.parse<Record<string, unknown>>(csv, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });
  const rows = result.data ?? [];
  const fields = result.meta.fields ?? [];
  const numericField = fields.find((f) => rows.some((r) => typeof r[f] === 'number'));
  const values = numericField ? rows.map((r) => Number(r[numericField])).filter((v) => Number.isFinite(v)) : [];
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return { rows, fields, numericField: numericField ?? null, avg };
}

export default function CsvWaveStudio() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [csvA, setCsvA] = useState(DEFAULT_CSV);
  const [csvB, setCsvB] = useState(DEFAULT_CSV);
  const pairRef = useRef<LoopbackDataPair | null>(null);

  const summaryA = useMemo(() => parseSummary(csvA), [csvA]);
  const summaryB = useMemo(() => parseSummary(csvB), [csvB]);

  const disconnect = () => {
    pairRef.current?.close();
    pairRef.current = null;
    setConnected(false);
  };

  const connect = async () => {
    disconnect();
    const pair = await createLoopbackDataPair('csv-wave-studio');
    pairRef.current = pair;
    pair.dcA.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type: 'csv'; payload: string };
      if (msg.type === 'csv') setCsvA(msg.payload);
    };
    pair.dcB.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type: 'csv'; payload: string };
      if (msg.type === 'csv') setCsvB(msg.payload);
    };
    setConnected(true);
    logger.success('CSV wave studio connected.');
  };

  const update = (side: 'A' | 'B', value: string) => {
    if (side === 'A') {
      setCsvA(value);
      if (pairRef.current?.dcA.readyState === 'open') pairRef.current.dcA.send(JSON.stringify({ type: 'csv', payload: value }));
    } else {
      setCsvB(value);
      if (pairRef.current?.dcB.readyState === 'open') pairRef.current.dcB.send(JSON.stringify({ type: 'csv', payload: value }));
    }
  };

  useEffect(() => () => disconnect(), []);

  return (
    <DemoLayout
      title="CSV Wave Studio (PapaParse)"
      difficulty="beginner"
      description="Collaborative CSV editor with instant parsing and metric summaries over WebRTC."
      explanation={<p className="text-sm">Paste CSV telemetry on one side; the other peer receives it and computes summaries with PapaParse.</p>}
      demo={
        <div className="space-y-4">
          <div className="flex gap-2">
            {!connected ? (
              <button onClick={connect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg">Connect</button>
            ) : (
              <button onClick={disconnect} className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white text-sm rounded-lg">Disconnect</button>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { side: 'A' as const, title: 'Peer A', csv: csvA, summary: summaryA },
              { side: 'B' as const, title: 'Peer B', csv: csvB, summary: summaryB },
            ].map(({ side, title, csv, summary }) => (
              <div key={side} className="space-y-2 border border-zinc-800 rounded-xl p-3 bg-surface-0">
                <p className="text-xs text-zinc-500">{title}</p>
                <textarea value={csv} onChange={(e) => update(side, e.target.value)} disabled={!connected} className="w-full h-40 bg-black/30 border border-zinc-700 rounded-lg p-2 font-mono text-xs text-zinc-200 disabled:opacity-50" />
                <p className="text-xs text-zinc-500">
                  Rows: {summary.rows.length} | Numeric field: {summary.numericField ?? 'none'} | Avg: {summary.avg.toFixed(2)}
                </p>
                <div className="overflow-auto border border-zinc-800 rounded-lg">
                  <table className="w-full text-xs text-zinc-300">
                    <thead className="bg-zinc-900">
                      <tr>
                        {summary.fields.slice(0, 4).map((f) => (
                          <th key={f} className="text-left px-2 py-1 border-b border-zinc-800">{f}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {summary.rows.slice(0, 4).map((row, idx) => (
                        <tr key={idx} className="odd:bg-zinc-950/30">
                          {summary.fields.slice(0, 4).map((f) => (
                            <td key={f} className="px-2 py-1 border-b border-zinc-900">{String(row[f] ?? '')}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'CSV parse and sync' }}
      hints={['Use headers and numeric columns for best summaries.', 'Try pasting packet stats exported from your own experiments.']}
    />
  );
}
