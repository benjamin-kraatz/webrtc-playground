import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCenter, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { createLoopbackDataPair, type LoopbackDataPair } from '@/lib/createLoopbackDataPair';

interface GraphState {
  nodes: number;
  charge: number;
  seed: number;
}

interface SimNode {
  id: string;
  x?: number;
  y?: number;
}

interface SimLink {
  source: string | SimNode;
  target: string | SimNode;
}

const CODE = `const sim = forceSimulation(nodes)
  .force('charge', forceManyBody().strength(charge))
  .force('link', forceLink(links).id((d) => d.id))
  .force('center', forceCenter(160, 100))
  .stop();
for (let i = 0; i < 120; i++) sim.tick();`;

const INITIAL: GraphState = { nodes: 14, charge: -85, seed: 11 };

function makeRng(seed: number) {
  let x = seed || 1;
  return () => {
    x = (1103515245 * x + 12345) % 2147483648;
    return x / 2147483648;
  };
}

function buildGraph(state: GraphState) {
  const rand = makeRng(state.seed);
  const nodes: SimNode[] = Array.from({ length: state.nodes }, (_, i) => ({ id: `n${i}` }));
  const links: SimLink[] = [];
  for (let i = 1; i < nodes.length; i++) {
    links.push({ source: `n${i}`, target: `n${Math.floor(rand() * i)}` });
    if (rand() > 0.7) links.push({ source: `n${i}`, target: `n${Math.floor(rand() * i)}` });
  }
  const sim = forceSimulation(nodes)
    .force('charge', forceManyBody<SimNode>().strength(state.charge))
    .force('link', forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(36))
    .force('center', forceCenter(160, 100))
    .stop();
  for (let i = 0; i < 140; i++) sim.tick();
  return { nodes, links };
}

export default function ForceFieldPresence() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [stateA, setStateA] = useState<GraphState>(INITIAL);
  const [stateB, setStateB] = useState<GraphState>(INITIAL);
  const pairRef = useRef<LoopbackDataPair | null>(null);

  const graphA = useMemo(() => buildGraph(stateA), [stateA]);
  const graphB = useMemo(() => buildGraph(stateB), [stateB]);

  const disconnect = () => {
    pairRef.current?.close();
    pairRef.current = null;
    setConnected(false);
  };

  const connect = async () => {
    disconnect();
    const pair = await createLoopbackDataPair('force-field-presence');
    pairRef.current = pair;
    pair.dcA.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type: 'graph'; payload: GraphState };
      if (msg.type === 'graph') setStateA(msg.payload);
    };
    pair.dcB.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type: 'graph'; payload: GraphState };
      if (msg.type === 'graph') setStateB(msg.payload);
    };
    setConnected(true);
    logger.success('Force-field graph sync connected.');
  };

  const update = (side: 'A' | 'B', patch: Partial<GraphState>) => {
    if (side === 'A') {
      const next = { ...stateA, ...patch };
      setStateA(next);
      if (pairRef.current?.dcA.readyState === 'open') pairRef.current.dcA.send(JSON.stringify({ type: 'graph', payload: next }));
    } else {
      const next = { ...stateB, ...patch };
      setStateB(next);
      if (pairRef.current?.dcB.readyState === 'open') pairRef.current.dcB.send(JSON.stringify({ type: 'graph', payload: next }));
    }
  };

  useEffect(() => () => disconnect(), []);

  return (
    <DemoLayout
      title="Force-Field Presence Graph (d3-force)"
      difficulty="intermediate"
      description="Synchronized force-directed topology playground over RTCDataChannel."
      explanation={<p className="text-sm">Peers share only graph parameters (node count, charge, seed) while each side runs d3-force locally for layout.</p>}
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
              { side: 'A' as const, title: 'Peer A', state: stateA, graph: graphA },
              { side: 'B' as const, title: 'Peer B', state: stateB, graph: graphB },
            ].map(({ side, title, state, graph }) => (
              <div key={side} className="space-y-2 border border-zinc-800 rounded-xl p-3 bg-surface-0">
                <p className="text-xs text-zinc-500">{title}</p>
                <div className="flex gap-2 items-center">
                  <label className="text-xs text-zinc-500">Nodes</label>
                  <input type="range" min={6} max={34} value={state.nodes} onChange={(e) => update(side, { nodes: Number(e.target.value) })} disabled={!connected} />
                  <label className="text-xs text-zinc-500">Charge</label>
                  <input type="range" min={-180} max={-20} value={state.charge} onChange={(e) => update(side, { charge: Number(e.target.value) })} disabled={!connected} />
                  <button onClick={() => update(side, { seed: Math.floor(Math.random() * 9999) })} disabled={!connected} className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 rounded">Reseed</button>
                </div>
                <svg viewBox="0 0 320 200" className="w-full h-52 border border-zinc-800 rounded-lg bg-black">
                  {graph.links.map((l, idx) => {
                    const sourceId = typeof l.source === 'string' ? l.source : l.source.id;
                    const targetId = typeof l.target === 'string' ? l.target : l.target.id;
                    const s = graph.nodes.find((n) => n.id === sourceId);
                    const t = graph.nodes.find((n) => n.id === targetId);
                    if (!s || !t) return null;
                    return <line key={idx} x1={s.x ?? 0} y1={s.y ?? 0} x2={t.x ?? 0} y2={t.y ?? 0} stroke="#334155" strokeWidth={1} />;
                  })}
                  {graph.nodes.map((n) => <circle key={n.id} cx={n.x ?? 0} cy={n.y ?? 0} r={4} fill="#38bdf8" />)}
                </svg>
              </div>
            ))}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Static force simulation ticks' }}
      hints={['Reseed to instantly reshape the topology.', 'Only tiny param updates are sent over the wire.']}
    />
  );
}
