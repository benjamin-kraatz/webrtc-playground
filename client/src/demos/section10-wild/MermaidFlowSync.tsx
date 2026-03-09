import { useEffect, useMemo, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { createLoopbackDataPair, type LoopbackDataPair } from '@/lib/createLoopbackDataPair';

const DEFAULT_GRAPH = `flowchart LR
  A[Webcam] --> B{WebRTC}
  B --> C[MediaStream]
  B --> D[DataChannel]
  C --> E[Canvas FX]
  D --> F[State Sync]`;

const CODE = `const { svg } = await mermaid.render('id-123', graphCode);
preview.innerHTML = svg;
dc.send(JSON.stringify({ type: 'graph', code: graphCode }));`;

mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'dark' });

async function toSvg(code: string, id: string): Promise<string> {
  try {
    const result = await mermaid.render(id, code);
    return result.svg;
  } catch {
    return `<div style="padding:12px;color:#f87171;font-size:12px;">Invalid Mermaid syntax</div>`;
  }
}

export default function MermaidFlowSync() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [codeA, setCodeA] = useState(DEFAULT_GRAPH);
  const [codeB, setCodeB] = useState(DEFAULT_GRAPH);
  const [svgA, setSvgA] = useState('');
  const [svgB, setSvgB] = useState('');
  const pairRef = useRef<LoopbackDataPair | null>(null);

  useEffect(() => {
    toSvg(codeA, `mermaid-a-${Date.now()}`).then(setSvgA);
    toSvg(codeB, `mermaid-b-${Date.now()}`).then(setSvgB);
  }, [codeA, codeB]);

  const disconnect = () => {
    pairRef.current?.close();
    pairRef.current = null;
    setConnected(false);
    logger.info('Disconnected Mermaid sync.');
  };

  const connect = async () => {
    disconnect();
    const pair = await createLoopbackDataPair('mermaid-sync');
    pairRef.current = pair;

    pair.dcA.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type: 'graph'; code: string };
      if (msg.type === 'graph') setCodeA(msg.code);
    };
    pair.dcB.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type: 'graph'; code: string };
      if (msg.type === 'graph') setCodeB(msg.code);
    };

    setConnected(true);
    logger.success('Mermaid diagram sync connected.');
  };

  const updateA = (value: string) => {
    setCodeA(value);
    if (pairRef.current?.dcA.readyState === 'open') {
      pairRef.current.dcA.send(JSON.stringify({ type: 'graph', code: value }));
    }
  };
  const updateB = (value: string) => {
    setCodeB(value);
    if (pairRef.current?.dcB.readyState === 'open') {
      pairRef.current.dcB.send(JSON.stringify({ type: 'graph', code: value }));
    }
  };

  useEffect(() => () => disconnect(), []);

  return (
    <DemoLayout
      title="Mermaid Flow Sync"
      difficulty="intermediate"
      description="Live architecture diagrams synced between peers with Mermaid + RTCDataChannel."
      explanation={
        <div className="space-y-2 text-sm">
          <p>Write Mermaid flowchart syntax on either side. The text syncs over WebRTC and both previews rerender.</p>
          <p>This is great for real-time protocol sketching during debugging calls.</p>
        </div>
      }
      demo={
        <div className="space-y-4">
          <div className="flex gap-2">
            {!connected ? (
              <button onClick={connect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg">Connect</button>
            ) : (
              <button onClick={disconnect} className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white text-sm rounded-lg">Disconnect</button>
            )}
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">Peer A editor</p>
              <textarea value={codeA} onChange={(e) => updateA(e.target.value)} disabled={!connected} className="w-full h-44 bg-surface-0 border border-zinc-700 rounded-lg p-3 text-xs font-mono text-zinc-200 disabled:opacity-50" />
              <div className="border border-zinc-800 rounded-lg bg-surface-0 p-2 overflow-auto" dangerouslySetInnerHTML={{ __html: svgA }} />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-zinc-500">Peer B editor</p>
              <textarea value={codeB} onChange={(e) => updateB(e.target.value)} disabled={!connected} className="w-full h-44 bg-surface-0 border border-zinc-700 rounded-lg p-3 text-xs font-mono text-zinc-200 disabled:opacity-50" />
              <div className="border border-zinc-800 rounded-lg bg-surface-0 p-2 overflow-auto" dangerouslySetInnerHTML={{ __html: svgB }} />
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Mermaid render + sync' }}
      hints={['Edit either side; syntax replicates to the opposite peer instantly.', 'Mermaid parse errors stay local in the preview pane.']}
    />
  );
}
