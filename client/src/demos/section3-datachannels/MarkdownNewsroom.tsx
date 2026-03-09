import { useMemo, useRef, useState } from 'react';
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { createLoopbackDataChannelPair, type LoopbackDataChannelPair } from '@/lib/loopbackDataChannel';
import { Logger } from '@/lib/logger';

const DEFAULT_MARKDOWN = `# Orbital Weather Bulletin

## Lead
The relay is live. Both peers edit the same rundown, and the rendered markdown updates instantly.

### Tonight
- Aurora index: **7.4**
- Packet loss front moving east
- Backup uplink stable

> "This is what a peer-to-peer teleprompter feels like."

| Segment | Duration | Status |
| --- | ---: | --- |
| Opening sting | 00:20 | queued |
| Status update | 02:00 | live |
| Viewer Q&A | 01:30 | standby |
`;

const CODE = `const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
const safeHtml = DOMPurify.sanitize(md.render(markdown));

dataChannel.send(JSON.stringify({
  type: 'markdown',
  source: nextMarkdown,
}));`;

function previewClassName(accent: string) {
  return `prose prose-sm prose-invert max-w-none min-h-[260px] rounded-2xl border p-4 ${
    accent === 'blue'
      ? 'border-blue-900/50 bg-blue-950/10'
      : 'border-fuchsia-900/50 bg-fuchsia-950/10'
  }`;
}

export default function MarkdownNewsroom() {
  const logger = useMemo(() => new Logger(), []);
  const md = useMemo(
    () => new MarkdownIt({ html: true, linkify: true, typographer: true, breaks: true }),
    []
  );
  const pairRef = useRef<LoopbackDataChannelPair | null>(null);
  const [connected, setConnected] = useState(false);
  const [sourceA, setSourceA] = useState(DEFAULT_MARKDOWN);
  const [sourceB, setSourceB] = useState(DEFAULT_MARKDOWN);
  const [activeTemplate, setActiveTemplate] = useState<'bulletin' | 'launch'>('bulletin');

  const renderedA = useMemo(() => DOMPurify.sanitize(md.render(sourceA)), [md, sourceA]);
  const renderedB = useMemo(() => DOMPurify.sanitize(md.render(sourceB)), [md, sourceB]);

  const connect = async () => {
    pairRef.current?.close();
    const pair = await createLoopbackDataChannelPair('markdown-newsroom', { logger });
    pairRef.current = pair;

    pair.channelA.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as { source: string };
      setSourceA(payload.source);
      logger.info('Peer A received a markdown update');
    };

    pair.channelB.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as { source: string };
      setSourceB(payload.source);
      logger.info('Peer B received a markdown update');
    };

    setConnected(true);
    logger.success('Markdown newsroom connected');
  };

  const disconnect = () => {
    pairRef.current?.close();
    pairRef.current = null;
    setConnected(false);
    logger.info('Markdown newsroom disconnected');
  };

  const syncSource = (peer: 'A' | 'B', next: string) => {
    if (peer === 'A') {
      setSourceA(next);
      pairRef.current?.channelA.send(JSON.stringify({ type: 'markdown', source: next }));
    } else {
      setSourceB(next);
      pairRef.current?.channelB.send(JSON.stringify({ type: 'markdown', source: next }));
    }
  };

  const loadTemplate = (template: 'bulletin' | 'launch') => {
    const next =
      template === 'bulletin'
        ? DEFAULT_MARKDOWN
        : `# Launch Window Checklist

## T-15 minutes
- Fuel cells balanced
- Camera uplink synced
- Crowd captions enabled

### Host notes
1. Open with the weather shot
2. Drop in the checklist
3. Read the red boxed warning slowly

> **Warning:** do not arm the retro-thrusters until both peers show green.

\`\`\`json
{ "mode": "launch", "latencyBudgetMs": 120, "crew": 4 }
\`\`\`
`;

    setActiveTemplate(template);
    setSourceA(next);
    setSourceB(next);
    if (pairRef.current) {
      pairRef.current.channelA.send(JSON.stringify({ type: 'markdown', source: next }));
      pairRef.current.channelB.send(JSON.stringify({ type: 'markdown', source: next }));
    }
  };

  return (
    <DemoLayout
      title="Markdown Newsroom"
      difficulty="intermediate"
      description="Edit a live markdown rundown, render it safely, and mirror the script to a peer over RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This playground turns a WebRTC data channel into a tiny peer-to-peer newsroom. The
            raw markdown source is synchronized between peers, then rendered with
            <strong> markdown-it</strong> and sanitized with <strong>DOMPurify</strong>.
          </p>
          <p>
            It is a great pattern for teleprompters, collaborative show notes, or lightweight
            publishing tools where the transport is WebRTC but the document experience still feels rich.
          </p>
        </div>
      }
      hints={[
        'Connect first, then edit either script panel to mirror updates instantly.',
        'Switch templates to see tables, quotes, code blocks, and lists render cleanly.',
        'The transport is plain RTCDataChannel text, while the package stack handles authoring and safety.',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <button
                onClick={connect}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Connect newsroom
              </button>
            ) : (
              <button
                onClick={disconnect}
                className="rounded-xl bg-surface-2 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-surface-3"
              >
                Disconnect
              </button>
            )}

            <button
              onClick={() => loadTemplate('bulletin')}
              className={`rounded-xl px-3 py-2 text-xs font-medium ${
                activeTemplate === 'bulletin'
                  ? 'bg-emerald-900/50 text-emerald-300'
                  : 'bg-surface-2 text-zinc-300 hover:bg-surface-3'
              }`}
            >
              Orbital bulletin
            </button>
            <button
              onClick={() => loadTemplate('launch')}
              className={`rounded-xl px-3 py-2 text-xs font-medium ${
                activeTemplate === 'launch'
                  ? 'bg-amber-900/50 text-amber-300'
                  : 'bg-surface-2 text-zinc-300 hover:bg-surface-3'
              }`}
            >
              Launch checklist
            </button>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Peer A</p>
                <span className="text-xs text-zinc-500">{sourceA.length} chars</span>
              </div>
              <textarea
                value={sourceA}
                onChange={(event) => syncSource('A', event.target.value)}
                className="h-64 w-full rounded-2xl border border-zinc-800 bg-surface-0 px-4 py-3 font-mono text-xs text-zinc-200 outline-none focus:border-blue-500"
              />
              <div
                className={previewClassName('blue')}
                dangerouslySetInnerHTML={{ __html: renderedA }}
              />
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">Peer B</p>
                <span className="text-xs text-zinc-500">{sourceB.length} chars</span>
              </div>
              <textarea
                value={sourceB}
                onChange={(event) => syncSource('B', event.target.value)}
                className="h-64 w-full rounded-2xl border border-zinc-800 bg-surface-0 px-4 py-3 font-mono text-xs text-zinc-200 outline-none focus:border-fuchsia-500"
              />
              <div
                className={previewClassName('fuchsia')}
                dangerouslySetInnerHTML={{ __html: renderedB }}
              />
            </section>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Peer-synced markdown rendering' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
