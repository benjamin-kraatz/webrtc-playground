import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { marked } from 'marked';
import hljs from 'highlight.js';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

// Configure marked with highlight.js
const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) => {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  const highlighted = hljs.highlight(text, { language }).value;
  return `<pre class="hljs-pre"><code class="hljs language-${language}">${highlighted}</code></pre>`;
};
marked.use({ renderer });

const DEFAULT_MD = `# Collaborative Markdown

Type here and your peer sees the preview update in **real time** via \`RTCDataChannel\`.

## Features
- **Bold**, *italic*, \`inline code\`
- Lists & headings
- Code blocks with syntax highlighting

\`\`\`typescript
const dc = pc.createDataChannel('markdown');
dc.send(JSON.stringify({ type: 'doc', content: text }));
\`\`\`

> Both peers share one document — last write wins.

---

Start editing!
`;

const CODE = `// Markdown sync via RTCDataChannel
// Sender: debounce and send full content
const debouncedSync = debounce((text: string) => {
  dc.send(JSON.stringify({ type: 'doc', content: text }));
}, 150);

// Receiver: update the editor textarea value
dc.onmessage = ({ data }) => {
  const { content } = JSON.parse(data);
  isRemoteUpdate.current = true;
  setContent(content);
};`;

export default function MarkdownCollab() {
  const logger = useMemo(() => new Logger(), []);
  const [roomId, setRoomId] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase());
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [joined, setJoined] = useState(false);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [content, setContent] = useState(DEFAULT_MD);
  const [peerTyping, setPeerTyping] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});
  const isRemote = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const renderedHtml = useMemo(() => {
    try { return marked.parse(content) as string; }
    catch { return '<p>Parse error</p>'; }
  }, [content]);

  const syncContent = useCallback((text: string) => {
    if (!dcRef.current || dcRef.current.readyState !== 'open') return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      dcRef.current?.send(JSON.stringify({ type: 'doc', content: text }));
    }, 120);
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isRemote.current) return;
    setContent(e.target.value);
    syncContent(e.target.value);
  };

  const setupDc = useCallback((dc: RTCDataChannel) => {
    dcRef.current = dc;
    dc.onopen = () => {
      logger.success('Markdown channel open — start collaborating!');
      dc.send(JSON.stringify({ type: 'doc', content }));
    };
    dc.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'doc') {
        isRemote.current = true;
        setContent(msg.content);
        setTimeout(() => { isRemote.current = false; }, 0);
        setPeerTyping(true);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setPeerTyping(false), 1500);
      }
    };
  }, [content, logger]);

  const onMessage = useCallback(async (msg: SignalingMessage) => {
    const pc = pcRef.current;
    if (!pc) return;
    switch (msg.type) {
      case 'peer-joined': {
        remotePeerIdRef.current = msg.peerId;
        const dc = pc.createDataChannel('markdown');
        setupDc(dc);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendRef.current({ type: 'offer', from: peerId, to: msg.peerId, sdp: offer });
        break;
      }
      case 'offer':
        remotePeerIdRef.current = msg.from;
        await pc.setRemoteDescription(msg.sdp);
        pc.ondatachannel = (ev) => setupDc(ev.channel);
        {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendRef.current({ type: 'answer', from: peerId, to: msg.from, sdp: answer });
        }
        break;
      case 'answer':
        await pc.setRemoteDescription(msg.sdp);
        break;
      case 'ice-candidate':
        await pc.addIceCandidate(msg.candidate).catch(() => {});
        break;
    }
  }, [peerId, logger, setupDc]);

  const { status: sigStatus, connect, join, send, disconnect } = useSignaling({ logger, onMessage });
  sendRef.current = send;

  const handleJoin = () => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcRef.current = pc;
    pc.onconnectionstatechange = () => setConnectionState(pc.connectionState);
    pc.onicecandidate = (ev) => {
      if (ev.candidate && remotePeerIdRef.current) {
        send({ type: 'ice-candidate', from: peerId, to: remotePeerIdRef.current, candidate: ev.candidate.toJSON() });
      }
    };
    connect();
    setTimeout(() => { join(roomId, peerId); setJoined(true); }, 400);
  };

  const handleLeave = () => {
    pcRef.current?.close();
    disconnect();
    setJoined(false);
    setConnectionState('new');
  };

  useEffect(() => { return () => { pcRef.current?.close(); }; }, []);

  return (
    <DemoLayout
      title="Markdown Collab Pad"
      difficulty="intermediate"
      description="Real-time collaborative Markdown editor — rendered live with highlight.js syntax highlighting, synced via RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>marked</strong> parses Markdown to HTML, and <strong>highlight.js</strong> adds
            syntax-highlighted code blocks. Changes are debounced 120 ms and sent as a simple JSON
            payload over <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">RTCDataChannel</code>.
            Both peers always see the same rendered document — no CRDT needed for light collaboration.
          </p>
          {sigStatus !== 'connected' && (
            <p className="text-amber-400 text-xs">⚠ Run <code className="bg-surface-2 px-1 py-0.5 rounded">bun run dev</code> to start the signaling server.</p>
          )}
        </div>
      }
      hints={['Open a second tab with the same room code and watch edits sync instantly', 'Code blocks use highlight.js for syntax coloring', 'Try pasting any Markdown — tables, blockquotes, task lists']}
      demo={
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <ConnectionStatus state={connectionState} />
            <span className="text-xs text-zinc-500">Signaling: <span className={sigStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{sigStatus}</span></span>
            {peerTyping && <span className="text-xs text-indigo-400 animate-pulse">Peer is editing…</span>}
          </div>

          {!joined ? (
            <div className="flex items-center gap-3">
              <div>
                <label className="text-xs text-zinc-500">Room Code</label>
                <input value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="block mt-1 bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-zinc-200 w-28 focus:outline-none focus:border-blue-500" />
              </div>
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg mt-4">
                Join Room
              </button>
            </div>
          ) : (
            <div className="flex justify-end">
              <button onClick={handleLeave} className="px-3 py-1.5 bg-red-900/40 text-red-400 text-xs font-medium rounded-lg border border-red-800">
                Leave
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ minHeight: 400 }}>
            <div className="flex flex-col">
              <p className="text-xs text-zinc-500 mb-1">Markdown Source</p>
              <textarea
                value={content}
                onChange={handleChange}
                spellCheck={false}
                className="flex-1 bg-surface-0 border border-zinc-800 rounded-xl p-3 text-sm font-mono text-zinc-200 resize-none focus:outline-none focus:border-blue-600 min-h-80"
                placeholder="Type Markdown here…"
              />
            </div>
            <div className="flex flex-col">
              <p className="text-xs text-zinc-500 mb-1">Live Preview</p>
              <div
                className="flex-1 bg-surface-0 border border-zinc-800 rounded-xl p-4 overflow-auto prose prose-sm prose-invert max-w-none min-h-80"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
                style={{ fontSize: '13px' }}
              />
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Markdown sync via RTCDataChannel' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
