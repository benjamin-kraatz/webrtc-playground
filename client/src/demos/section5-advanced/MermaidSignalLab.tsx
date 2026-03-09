import { useEffect, useMemo, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { createLoopbackDataChannelPair, type LoopbackDataChannelPair } from '@/lib/loopbackDataChannel';
import { Logger } from '@/lib/logger';

const DEFAULT_SOURCE = `sequenceDiagram
  autonumber
  participant A as Peer A
  participant S as Signaling
  participant B as Peer B

  A->>S: offer
  S->>B: offer
  B->>S: answer
  S->>A: answer
  A-->>B: ICE candidates
  B-->>A: ICE candidates
  A->>B: RTCDataChannel open`;

const CODE = `await mermaid.render('diagram-id', source);
channel.send(JSON.stringify({
  type: 'diagram',
  source,
  theme,
}));`;

type MermaidTheme = 'default' | 'forest' | 'neutral';

async function renderDiagram(source: string, theme: MermaidTheme, container: HTMLDivElement | null, id: string) {
  if (!container) {
    return;
  }

  try {
    mermaid.initialize({
      startOnLoad: false,
      theme,
      securityLevel: 'loose',
      fontFamily: 'Inter, ui-sans-serif, system-ui',
    });
    const { svg } = await mermaid.render(id, source);
    container.innerHTML = svg;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Mermaid render error';
    container.innerHTML = `<div class="rounded-xl border border-rose-900/40 bg-rose-950/30 p-4 text-sm text-rose-300">${message}</div>`;
  }
}

export default function MermaidSignalLab() {
  const logger = useMemo(() => new Logger(), []);
  const pairRef = useRef<LoopbackDataChannelPair | null>(null);
  const leftPreviewRef = useRef<HTMLDivElement>(null);
  const rightPreviewRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);
  const [sourceA, setSourceA] = useState(DEFAULT_SOURCE);
  const [sourceB, setSourceB] = useState(DEFAULT_SOURCE);
  const [theme, setTheme] = useState<MermaidTheme>('default');

  useEffect(() => {
    void renderDiagram(sourceA, theme, leftPreviewRef.current, 'mermaid-a');
  }, [sourceA, theme]);

  useEffect(() => {
    void renderDiagram(sourceB, theme, rightPreviewRef.current, 'mermaid-b');
  }, [sourceB, theme]);

  const connect = async () => {
    pairRef.current?.close();
    const pair = await createLoopbackDataChannelPair('mermaid-lab', { logger });
    pairRef.current = pair;

    pair.channelA.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as { source: string; theme: MermaidTheme };
      setSourceA(payload.source);
      setTheme(payload.theme);
      logger.info('Peer A received a diagram update');
    };

    pair.channelB.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as { source: string; theme: MermaidTheme };
      setSourceB(payload.source);
      setTheme(payload.theme);
      logger.info('Peer B received a diagram update');
    };

    setConnected(true);
    logger.success('Mermaid signal lab connected');
  };

  const broadcast = (peer: 'A' | 'B', nextSource: string, nextTheme = theme) => {
    if (peer === 'A') {
      setSourceA(nextSource);
      pairRef.current?.channelA.send(JSON.stringify({ type: 'diagram', source: nextSource, theme: nextTheme }));
    } else {
      setSourceB(nextSource);
      pairRef.current?.channelB.send(JSON.stringify({ type: 'diagram', source: nextSource, theme: nextTheme }));
    }
  };

  const updateTheme = (nextTheme: MermaidTheme) => {
    setTheme(nextTheme);
    if (pairRef.current) {
      pairRef.current.channelA.send(JSON.stringify({ type: 'diagram', source: sourceA, theme: nextTheme }));
      pairRef.current.channelB.send(JSON.stringify({ type: 'diagram', source: sourceB, theme: nextTheme }));
    }
  };

  return (
    <DemoLayout
      title="Mermaid Signal Lab"
      difficulty="advanced"
      description="Sketch WebRTC call flows as Mermaid diagrams and mirror them live between peers over RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Mermaid gives the playground a high-level language for sequence charts, state machines,
            and flow diagrams. WebRTC supplies the peer-to-peer transport, so both sides can co-edit
            protocol maps without a central server.
          </p>
          <p>
            It is a useful teaching tool for signaling flows, fallback strategies, or product team
            docs that need to stay visual while still feeling hackable.
          </p>
        </div>
      }
      hints={[
        'Try switching the theme while editing to prove metadata can ride along with the source.',
        'Paste a flowchart or state diagram if you want something other than the default sequence diagram.',
        'Mermaid render errors appear inline, which is handy for debugging peer-authored diagrams.',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            {!connected ? (
              <button
                onClick={connect}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Connect diagram peers
              </button>
            ) : (
              <span className="rounded-xl border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
                Connected
              </span>
            )}

            {(['default', 'forest', 'neutral'] as MermaidTheme[]).map((item) => (
              <button
                key={item}
                onClick={() => updateTheme(item)}
                className={`rounded-xl px-3 py-2 text-xs font-medium ${
                  theme === item
                    ? 'bg-violet-900/50 text-violet-300'
                    : 'bg-surface-2 text-zinc-300 hover:bg-surface-3'
                }`}
              >
                Theme: {item}
              </button>
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Peer A</p>
              <textarea
                value={sourceA}
                onChange={(event) => broadcast('A', event.target.value)}
                className="h-64 w-full rounded-2xl border border-zinc-800 bg-surface-0 px-4 py-3 font-mono text-xs text-zinc-200 outline-none focus:border-blue-500"
              />
              <div
                ref={leftPreviewRef}
                className="overflow-auto rounded-2xl border border-zinc-800 bg-surface-0 p-4 [&_svg]:min-w-full"
              />
            </section>

            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">Peer B</p>
              <textarea
                value={sourceB}
                onChange={(event) => broadcast('B', event.target.value)}
                className="h-64 w-full rounded-2xl border border-zinc-800 bg-surface-0 px-4 py-3 font-mono text-xs text-zinc-200 outline-none focus:border-fuchsia-500"
              />
              <div
                ref={rightPreviewRef}
                className="overflow-auto rounded-2xl border border-zinc-800 bg-surface-0 p-4 [&_svg]:min-w-full"
              />
            </section>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Diagram source + theme synchronization' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
