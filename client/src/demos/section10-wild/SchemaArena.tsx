import { useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { createLoopbackDataPair, type LoopbackDataPair } from '@/lib/createLoopbackDataPair';

const CommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('spawn'),
    id: z.string(),
    x: z.number().min(0).max(100),
    y: z.number().min(0).max(100),
    color: z.string(),
  }),
  z.object({ type: z.literal('clear') }),
]);

type Command = z.infer<typeof CommandSchema>;

interface Orb {
  id: string;
  x: number;
  y: number;
  color: string;
}

const CODE = `const result = CommandSchema.safeParse(JSON.parse(payload));
if (!result.success) return; // drop malformed packets
applyCommand(result.data);`;

const COLORS = ['#38bdf8', '#a78bfa', '#34d399', '#f472b6', '#fbbf24'];

export default function SchemaArena() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [orbsA, setOrbsA] = useState<Orb[]>([]);
  const [orbsB, setOrbsB] = useState<Orb[]>([]);
  const [droppedPackets, setDroppedPackets] = useState(0);
  const pairRef = useRef<LoopbackDataPair | null>(null);

  const disconnect = () => {
    pairRef.current?.close();
    pairRef.current = null;
    setConnected(false);
  };

  const applyTo = (side: 'A' | 'B', command: Command) => {
    const setter = side === 'A' ? setOrbsA : setOrbsB;
    setter((prev) => {
      if (command.type === 'clear') return [];
      return [...prev, { id: command.id, x: command.x, y: command.y, color: command.color }].slice(-40);
    });
  };

  const handlePacket = (side: 'A' | 'B', raw: string) => {
    try {
      const parsed = CommandSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        setDroppedPackets((v) => v + 1);
        return;
      }
      applyTo(side, parsed.data);
    } catch {
      setDroppedPackets((v) => v + 1);
    }
  };

  const connect = async () => {
    disconnect();
    const pair = await createLoopbackDataPair('schema-arena');
    pairRef.current = pair;
    pair.dcA.onmessage = (ev) => handlePacket('A', ev.data as string);
    pair.dcB.onmessage = (ev) => handlePacket('B', ev.data as string);
    setConnected(true);
    logger.success('Schema arena connected with zod validation.');
  };

  const send = (side: 'A' | 'B', command: Command) => {
    applyTo(side, command);
    const serialized = JSON.stringify(command);
    if (side === 'A' && pairRef.current?.dcA.readyState === 'open') pairRef.current.dcA.send(serialized);
    if (side === 'B' && pairRef.current?.dcB.readyState === 'open') pairRef.current.dcB.send(serialized);
  };

  const spawn = (side: 'A' | 'B') => {
    send(side, {
      type: 'spawn',
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      x: Math.random() * 100,
      y: Math.random() * 100,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
  };

  const clear = (side: 'A' | 'B') => send(side, { type: 'clear' });

  useEffect(() => () => disconnect(), []);

  return (
    <DemoLayout
      title="Schema Arena (zod)"
      difficulty="intermediate"
      description="Typed command packets over DataChannel with strict runtime validation."
      explanation={<p className="text-sm">Each control action becomes a JSON command. Incoming packets are validated with zod before they can mutate state.</p>}
      demo={
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            {!connected ? (
              <button onClick={connect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg">Connect</button>
            ) : (
              <button onClick={disconnect} className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white text-sm rounded-lg">Disconnect</button>
            )}
            <span className="text-xs text-zinc-500">Dropped invalid packets: {droppedPackets}</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { side: 'A' as const, title: 'Peer A', orbs: orbsA },
              { side: 'B' as const, title: 'Peer B', orbs: orbsB },
            ].map((item) => (
              <div key={item.side} className="space-y-2">
                <div className="flex items-center gap-2">
                  <button onClick={() => spawn(item.side)} disabled={!connected} className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs rounded-md">Spawn</button>
                  <button onClick={() => clear(item.side)} disabled={!connected} className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 text-white text-xs rounded-md">Clear</button>
                  <span className="text-xs text-zinc-500">{item.title}</span>
                </div>
                <div className="relative h-52 border border-zinc-800 rounded-lg bg-surface-0 overflow-hidden">
                  {item.orbs.map((orb) => (
                    <div
                      key={orb.id}
                      className="absolute w-4 h-4 rounded-full shadow-lg"
                      style={{ left: `${orb.x}%`, top: `${orb.y}%`, backgroundColor: orb.color, transform: 'translate(-50%, -50%)' }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Validate every packet with zod' }}
      hints={['This guards against malformed or malicious payloads.', 'The same pattern works for multiplayer game commands.']}
    />
  );
}
