import { useEffect, useMemo, useRef, useState } from 'react';
import chroma from 'chroma-js';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { createLoopbackDataPair, type LoopbackDataPair } from '@/lib/createLoopbackDataPair';

interface PaletteState {
  start: string;
  end: string;
  mode: 'rgb' | 'lab' | 'lch';
  steps: number;
}

const CODE = `const scale = chroma.scale([start, end]).mode(mode).colors(steps);
dc.send(JSON.stringify({ type: 'palette', payload }));`;

const INITIAL: PaletteState = { start: '#22d3ee', end: '#8b5cf6', mode: 'lab', steps: 7 };

function swatches(s: PaletteState) {
  return chroma.scale([s.start, s.end]).mode(s.mode).colors(s.steps);
}

export default function PaletteAlchemy() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [stateA, setStateA] = useState<PaletteState>(INITIAL);
  const [stateB, setStateB] = useState<PaletteState>(INITIAL);
  const pairRef = useRef<LoopbackDataPair | null>(null);

  const colorsA = useMemo(() => swatches(stateA), [stateA]);
  const colorsB = useMemo(() => swatches(stateB), [stateB]);

  const disconnect = () => {
    pairRef.current?.close();
    pairRef.current = null;
    setConnected(false);
  };

  const connect = async () => {
    disconnect();
    const pair = await createLoopbackDataPair('palette-alchemy');
    pairRef.current = pair;
    pair.dcA.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type: 'palette'; payload: PaletteState };
      if (msg.type === 'palette') setStateA(msg.payload);
    };
    pair.dcB.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type: 'palette'; payload: PaletteState };
      if (msg.type === 'palette') setStateB(msg.payload);
    };
    setConnected(true);
    logger.success('Palette alchemy connected.');
  };

  const update = (side: 'A' | 'B', patch: Partial<PaletteState>) => {
    if (side === 'A') {
      const next = { ...stateA, ...patch };
      setStateA(next);
      if (pairRef.current?.dcA.readyState === 'open') {
        pairRef.current.dcA.send(JSON.stringify({ type: 'palette', payload: next }));
      }
    } else {
      const next = { ...stateB, ...patch };
      setStateB(next);
      if (pairRef.current?.dcB.readyState === 'open') {
        pairRef.current.dcB.send(JSON.stringify({ type: 'palette', payload: next }));
      }
    }
  };

  useEffect(() => () => disconnect(), []);

  return (
    <DemoLayout
      title="Palette Alchemy (chroma.js)"
      difficulty="beginner"
      description="Real-time collaborative color ramps generated with chroma.js and synced via WebRTC."
      explanation={<p className="text-sm">Interpolation mode dramatically changes color feel. Compare RGB, LAB, and LCH while syncing settings peer-to-peer.</p>}
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
              { side: 'A' as const, title: 'Peer A', state: stateA, colors: colorsA },
              { side: 'B' as const, title: 'Peer B', state: stateB, colors: colorsB },
            ].map(({ side, title, state, colors }) => (
              <div key={side} className="space-y-2 border border-zinc-800 rounded-xl p-3 bg-surface-0">
                <p className="text-xs text-zinc-500">{title}</p>
                <div className="flex items-center gap-2">
                  <input type="color" value={state.start} onChange={(e) => update(side, { start: e.target.value })} disabled={!connected} />
                  <input type="color" value={state.end} onChange={(e) => update(side, { end: e.target.value })} disabled={!connected} />
                  <select value={state.mode} onChange={(e) => update(side, { mode: e.target.value as PaletteState['mode'] })} disabled={!connected} className="bg-surface-1 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200">
                    <option value="rgb">rgb</option>
                    <option value="lab">lab</option>
                    <option value="lch">lch</option>
                  </select>
                  <input type="range" min={3} max={12} value={state.steps} onChange={(e) => update(side, { steps: Number(e.target.value) })} disabled={!connected} />
                </div>
                <div className="grid grid-cols-6 gap-1">
                  {colors.map((c) => (
                    <div key={c} className="h-10 rounded" style={{ background: c }} title={c} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Generate ramps with chroma.js' }}
      hints={['LAB/LCH usually create smoother perceptual gradients than RGB.', 'Try 12 steps for richer palettes.']}
    />
  );
}
