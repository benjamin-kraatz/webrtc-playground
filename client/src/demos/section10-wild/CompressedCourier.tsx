import { useEffect, useMemo, useRef, useState } from 'react';
import * as pako from 'pako';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { createLoopbackDataPair, type LoopbackDataPair } from '@/lib/createLoopbackDataPair';

const CODE = `const raw = new TextEncoder().encode(message);
const packed = pako.deflate(raw);
dc.send(packed);

dc.onmessage = (ev) => {
  const decoded = pako.inflate(new Uint8Array(ev.data), { to: 'string' });
  setMessage(decoded);
};`;

function compressionStats(text: string) {
  const raw = new TextEncoder().encode(text);
  const packed = pako.deflate(raw);
  const ratio = raw.length === 0 ? 1 : packed.length / raw.length;
  return { raw: raw.length, packed: packed.length, ratio };
}

export default function CompressedCourier() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [textA, setTextA] = useState('Packets are compressed with pako before transport.');
  const [textB, setTextB] = useState('Try repeating words words words for better compression.');
  const pairRef = useRef<LoopbackDataPair | null>(null);

  const statsA = useMemo(() => compressionStats(textA), [textA]);
  const statsB = useMemo(() => compressionStats(textB), [textB]);

  const disconnect = () => {
    pairRef.current?.close();
    pairRef.current = null;
    setConnected(false);
  };

  const connect = async () => {
    disconnect();
    const pair = await createLoopbackDataPair('compressed-courier');
    pairRef.current = pair;
    pair.dcA.binaryType = 'arraybuffer';
    pair.dcB.binaryType = 'arraybuffer';

    pair.dcA.onmessage = (ev) => {
      const out = pako.inflate(new Uint8Array(ev.data as ArrayBuffer), { to: 'string' });
      setTextA(out);
    };
    pair.dcB.onmessage = (ev) => {
      const out = pako.inflate(new Uint8Array(ev.data as ArrayBuffer), { to: 'string' });
      setTextB(out);
    };

    setConnected(true);
    logger.success('Compression courier connected.');
  };

  const sendFromA = (value: string) => {
    setTextA(value);
    if (pairRef.current?.dcA.readyState === 'open') {
      pairRef.current.dcA.send(pako.deflate(new TextEncoder().encode(value)));
    }
  };
  const sendFromB = (value: string) => {
    setTextB(value);
    if (pairRef.current?.dcB.readyState === 'open') {
      pairRef.current.dcB.send(pako.deflate(new TextEncoder().encode(value)));
    }
  };

  useEffect(() => () => disconnect(), []);

  return (
    <DemoLayout
      title="Compressed Courier (pako)"
      difficulty="intermediate"
      description="Text sync where every message is deflated before crossing the DataChannel."
      explanation={<p className="text-sm">This playground measures raw vs compressed payload size live, so you can see where compression helps.</p>}
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
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">Peer A</p>
              <textarea value={textA} onChange={(e) => sendFromA(e.target.value)} disabled={!connected} className="w-full h-44 bg-surface-0 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 disabled:opacity-50" />
              <p className="text-xs text-zinc-500">Raw {statsA.raw} B → Compressed {statsA.packed} B ({(statsA.ratio * 100).toFixed(1)}%)</p>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">Peer B</p>
              <textarea value={textB} onChange={(e) => sendFromB(e.target.value)} disabled={!connected} className="w-full h-44 bg-surface-0 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 disabled:opacity-50" />
              <p className="text-xs text-zinc-500">Raw {statsB.raw} B → Compressed {statsB.packed} B ({(statsB.ratio * 100).toFixed(1)}%)</p>
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Deflate + inflate messages' }}
      hints={['Compression shines on repetitive text.', 'DataChannels accept binary payloads directly.']}
    />
  );
}
