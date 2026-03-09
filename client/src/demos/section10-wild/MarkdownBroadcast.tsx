import { useEffect, useMemo, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { createLoopbackDataPair, type LoopbackDataPair } from '@/lib/createLoopbackDataPair';

const START_MD = `# P2P Markdown Studio

- WebRTC DataChannels for transport
- **marked** for markdown parsing
- **DOMPurify** for safe preview rendering

\`\`\`ts
dc.send(JSON.stringify({ type: 'md', text }));
\`\`\`
`;

const CODE = `const html = marked.parse(markdown) as string;
const safeHtml = DOMPurify.sanitize(html);
preview.innerHTML = safeHtml;`;

function mdToHtml(markdown: string): string {
  const parsed = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(parsed);
}

export default function MarkdownBroadcast() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [mdA, setMdA] = useState(START_MD);
  const [mdB, setMdB] = useState(START_MD);
  const pairRef = useRef<LoopbackDataPair | null>(null);

  const htmlA = useMemo(() => mdToHtml(mdA), [mdA]);
  const htmlB = useMemo(() => mdToHtml(mdB), [mdB]);

  const disconnect = () => {
    pairRef.current?.close();
    pairRef.current = null;
    setConnected(false);
  };

  const connect = async () => {
    disconnect();
    const pair = await createLoopbackDataPair('markdown-broadcast');
    pairRef.current = pair;

    pair.dcA.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type: 'md'; text: string };
      if (msg.type === 'md') setMdA(msg.text);
    };
    pair.dcB.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { type: 'md'; text: string };
      if (msg.type === 'md') setMdB(msg.text);
    };

    setConnected(true);
    logger.success('Markdown broadcast connected.');
  };

  const changeA = (value: string) => {
    setMdA(value);
    if (pairRef.current?.dcA.readyState === 'open') {
      pairRef.current.dcA.send(JSON.stringify({ type: 'md', text: value }));
    }
  };
  const changeB = (value: string) => {
    setMdB(value);
    if (pairRef.current?.dcB.readyState === 'open') {
      pairRef.current.dcB.send(JSON.stringify({ type: 'md', text: value }));
    }
  };

  useEffect(() => () => disconnect(), []);

  return (
    <DemoLayout
      title="Markdown Broadcast Studio"
      difficulty="beginner"
      description="Collaborative markdown preview over WebRTC using marked + DOMPurify."
      explanation={<p className="text-sm">Type markdown in either pane and watch safe HTML previews sync peer-to-peer.</p>}
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <textarea value={mdA} onChange={(e) => changeA(e.target.value)} disabled={!connected} className="h-64 bg-surface-0 border border-zinc-700 rounded-lg p-3 text-xs font-mono text-zinc-200 disabled:opacity-50" />
              <article className="prose prose-sm prose-invert max-w-none h-64 overflow-auto border border-zinc-800 rounded-lg bg-surface-0 p-3" dangerouslySetInnerHTML={{ __html: htmlA }} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <textarea value={mdB} onChange={(e) => changeB(e.target.value)} disabled={!connected} className="h-64 bg-surface-0 border border-zinc-700 rounded-lg p-3 text-xs font-mono text-zinc-200 disabled:opacity-50" />
              <article className="prose prose-sm prose-invert max-w-none h-64 overflow-auto border border-zinc-800 rounded-lg bg-surface-0 p-3" dangerouslySetInnerHTML={{ __html: htmlB }} />
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Parse + sanitize markdown' }}
      hints={['Try code blocks, tables, and lists.', 'Sanitization protects previews from unsafe HTML injection.']}
    />
  );
}
