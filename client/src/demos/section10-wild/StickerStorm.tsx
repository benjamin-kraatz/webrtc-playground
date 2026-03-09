import { useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { createLoopbackDataPair, type LoopbackDataPair } from '@/lib/createLoopbackDataPair';

interface Sticker {
  id: string;
  emoji: string;
  x: number;
  y: number;
  rot: number;
}

type Packet =
  | { type: 'add'; sticker: Sticker }
  | { type: 'clear' };

const EMOJI = ['🔥', '✨', '🧠', '🌈', '🛰️', '⚡', '🦄', '🧪', '🚀', '🎉'];

const CODE = `const sticker = { id: nanoid(), emoji: '🚀', x, y, rot };
dc.send(JSON.stringify({ type: 'add', sticker }));`;

export default function StickerStorm() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [stickersA, setStickersA] = useState<Sticker[]>([]);
  const [stickersB, setStickersB] = useState<Sticker[]>([]);
  const pairRef = useRef<LoopbackDataPair | null>(null);

  const disconnect = () => {
    pairRef.current?.close();
    pairRef.current = null;
    setConnected(false);
  };

  const applyPacket = (side: 'A' | 'B', packet: Packet) => {
    const set = side === 'A' ? setStickersA : setStickersB;
    if (packet.type === 'clear') {
      set([]);
      return;
    }
    set((prev) => [...prev, packet.sticker].slice(-80));
  };

  const connect = async () => {
    disconnect();
    const pair = await createLoopbackDataPair('sticker-storm');
    pairRef.current = pair;
    pair.dcA.onmessage = (ev) => applyPacket('A', JSON.parse(ev.data as string) as Packet);
    pair.dcB.onmessage = (ev) => applyPacket('B', JSON.parse(ev.data as string) as Packet);
    setConnected(true);
    logger.success('Sticker storm connected.');
  };

  const send = (side: 'A' | 'B', packet: Packet) => {
    applyPacket(side, packet);
    const serialized = JSON.stringify(packet);
    if (side === 'A' && pairRef.current?.dcA.readyState === 'open') pairRef.current.dcA.send(serialized);
    if (side === 'B' && pairRef.current?.dcB.readyState === 'open') pairRef.current.dcB.send(serialized);
  };

  const dropSticker = (side: 'A' | 'B') => {
    send(side, {
      type: 'add',
      sticker: {
        id: nanoid(),
        emoji: EMOJI[Math.floor(Math.random() * EMOJI.length)],
        x: 5 + Math.random() * 90,
        y: 10 + Math.random() * 80,
        rot: -20 + Math.random() * 40,
      },
    });
  };

  useEffect(() => () => disconnect(), []);

  return (
    <DemoLayout
      title="Sticker Storm (nanoid)"
      difficulty="beginner"
      description="Ephemeral emoji sticker events synchronized across peers with nanoid event IDs."
      explanation={<p className="text-sm">This is an event-stream demo: each sticker drop is a tiny immutable packet. Great for reactions, cursors, and overlays.</p>}
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
              { side: 'A' as const, title: 'Peer A', stickers: stickersA },
              { side: 'B' as const, title: 'Peer B', stickers: stickersB },
            ].map(({ side, title, stickers }) => (
              <div key={side} className="space-y-2">
                <div className="flex gap-2">
                  <button onClick={() => dropSticker(side)} disabled={!connected} className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs rounded-md">Drop sticker</button>
                  <button onClick={() => send(side, { type: 'clear' })} disabled={!connected} className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-xs rounded-md">Clear</button>
                  <span className="text-xs text-zinc-500">{title}</span>
                </div>
                <div className="relative h-56 border border-zinc-800 rounded-lg bg-surface-0 overflow-hidden">
                  {stickers.map((s) => (
                    <div
                      key={s.id}
                      className="absolute text-2xl"
                      style={{ left: `${s.x}%`, top: `${s.y}%`, transform: `translate(-50%, -50%) rotate(${s.rot}deg)` }}
                    >
                      {s.emoji}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Event IDs with nanoid' }}
      hints={['These packets are idempotent-friendly thanks to unique IDs.', 'Use this pattern for real-time reactions in calls.']}
    />
  );
}
