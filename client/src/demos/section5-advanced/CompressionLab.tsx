import { useMemo, useRef, useState } from 'react';
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { createLoopbackDataChannelPair, type LoopbackDataChannelPair } from '@/lib/loopbackDataChannel';
import { formatBytes, formatPercent } from '@/lib/format';
import { Logger } from '@/lib/logger';

const SAMPLE_TEXT = JSON.stringify(
  {
    room: 'compression-lab',
    packets: Array.from({ length: 8 }, (_, index) => ({
      ts: Date.now() + index * 30,
      bitrateKbps: 1200 + index * 45,
      jitterMs: Number((Math.random() * 8 + 2).toFixed(2)),
      packetLoss: Number((Math.random() * 0.8).toFixed(2)),
      annotations: 'Repeated telemetry blocks compress beautifully across data channels.',
    })),
  },
  null,
  2
);

const CODE = `const raw = strToU8(payload);
const compressed = gzipSync(raw, { level: 9 });
dataChannel.send(compressed);

channel.onmessage = (event) => {
  const restored = strFromU8(gunzipSync(new Uint8Array(event.data)));
};`;

interface TransferStats {
  originalBytes: number;
  compressedBytes: number;
  level: number;
}

type CompressionLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

export default function CompressionLab() {
  const logger = useMemo(() => new Logger(), []);
  const pairRef = useRef<LoopbackDataChannelPair | null>(null);
  const [connected, setConnected] = useState(false);
  const [textA, setTextA] = useState(SAMPLE_TEXT);
  const [textB, setTextB] = useState(SAMPLE_TEXT);
  const [level, setLevel] = useState<CompressionLevel>(6);
  const [statsA, setStatsA] = useState<TransferStats | null>(null);
  const [statsB, setStatsB] = useState<TransferStats | null>(null);

  const connect = async () => {
    pairRef.current?.close();
    const pair = await createLoopbackDataChannelPair('compression-lab', { logger });
    pair.channelA.binaryType = 'arraybuffer';
    pair.channelB.binaryType = 'arraybuffer';

    pair.channelA.onmessage = (event) => {
      const compressed = new Uint8Array(event.data as ArrayBuffer);
      const restored = strFromU8(gunzipSync(compressed));
      setTextA(restored);
      setStatsA({
        originalBytes: new TextEncoder().encode(restored).length,
        compressedBytes: compressed.byteLength,
        level,
      });
      logger.success(`Peer A restored ${formatBytes(compressed.byteLength)} of compressed data`);
    };

    pair.channelB.onmessage = (event) => {
      const compressed = new Uint8Array(event.data as ArrayBuffer);
      const restored = strFromU8(gunzipSync(compressed));
      setTextB(restored);
      setStatsB({
        originalBytes: new TextEncoder().encode(restored).length,
        compressedBytes: compressed.byteLength,
        level,
      });
      logger.success(`Peer B restored ${formatBytes(compressed.byteLength)} of compressed data`);
    };

    pairRef.current = pair;
    setConnected(true);
    logger.success('Compression lab connected');
  };

  const sendCompressed = (peer: 'A' | 'B') => {
    const source = peer === 'A' ? textA : textB;
    const raw = strToU8(source);
    const compressed = gzipSync(raw, { level });
    const nextStats = {
      originalBytes: raw.byteLength,
      compressedBytes: compressed.byteLength,
      level,
    };

    if (peer === 'A') {
      pairRef.current?.channelA.send(toArrayBuffer(compressed));
      setStatsB(nextStats);
    } else {
      pairRef.current?.channelB.send(toArrayBuffer(compressed));
      setStatsA(nextStats);
    }

    logger.info(
      `${peer} sent ${formatBytes(raw.byteLength)} as ${formatBytes(compressed.byteLength)} at level ${level}`
    );
  };

  const renderStats = (stats: TransferStats | null) => {
    if (!stats) {
      return <p className="text-xs text-zinc-600">No transfer yet</p>;
    }

    const savings = 100 - (stats.compressedBytes / Math.max(1, stats.originalBytes)) * 100;

    return (
      <div className="grid grid-cols-3 gap-2 text-xs text-zinc-300">
        <div className="rounded-xl border border-zinc-800 bg-surface-0 p-3">
          <p className="text-zinc-500">Original</p>
          <p className="mt-1 text-sm font-semibold">{formatBytes(stats.originalBytes)}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-surface-0 p-3">
          <p className="text-zinc-500">Compressed</p>
          <p className="mt-1 text-sm font-semibold">{formatBytes(stats.compressedBytes)}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-surface-0 p-3">
          <p className="text-zinc-500">Saved</p>
          <p className="mt-1 text-sm font-semibold text-emerald-300">{formatPercent(savings)}</p>
        </div>
      </div>
    );
  };

  return (
    <DemoLayout
      title="Compression Lab"
      difficulty="advanced"
      description="Compress payloads with fflate before they cross an RTCDataChannel, then inspect the size savings on the other side."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Data channels already move bytes directly between peers. This demo adds an explicit
            compression stage with <strong>fflate</strong>, which is especially useful for bulky JSON,
            collaborative snapshots, and repeated telemetry structures.
          </p>
          <p>
            The receiver only gets compressed binary, inflates it locally, and shows how much
            bandwidth the compression level saved.
          </p>
        </div>
      }
      hints={[
        'Higher gzip levels cost more CPU but usually shrink repeated JSON further.',
        'Paste a wall of repeated text to make the compression ratio jump.',
        'RTCDataChannel accepts raw binary buffers, so you do not need to stringify the payload itself.',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            {!connected ? (
              <button
                onClick={connect}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Connect compression pair
              </button>
            ) : (
              <span className="rounded-xl border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
                Binary channel live
              </span>
            )}
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              Compression level
              <input
                type="range"
                min={1}
                max={9}
                value={level}
                onChange={(event) => setLevel(Number(event.target.value) as CompressionLevel)}
                className="accent-blue-400"
              />
              <span className="w-4 text-right text-zinc-200">{level}</span>
            </label>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Peer A source</p>
                <button
                  onClick={() => sendCompressed('A')}
                  disabled={!connected}
                  className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  Send compressed →
                </button>
              </div>
              <textarea
                value={textA}
                onChange={(event) => setTextA(event.target.value)}
                className="h-72 w-full rounded-2xl border border-zinc-800 bg-surface-0 px-4 py-3 font-mono text-xs text-zinc-200 outline-none focus:border-blue-500"
              />
              {renderStats(statsA)}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">Peer B source</p>
                <button
                  onClick={() => sendCompressed('B')}
                  disabled={!connected}
                  className="rounded-xl bg-fuchsia-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  ← Send compressed
                </button>
              </div>
              <textarea
                value={textB}
                onChange={(event) => setTextB(event.target.value)}
                className="h-72 w-full rounded-2xl border border-zinc-800 bg-surface-0 px-4 py-3 font-mono text-xs text-zinc-200 outline-none focus:border-fuchsia-500"
              />
              {renderStats(statsB)}
            </section>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Compress, send binary, inflate on receipt' }}
      mdnLinks={[
        { label: 'RTCDataChannel.send()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/send' },
      ]}
    />
  );
}
