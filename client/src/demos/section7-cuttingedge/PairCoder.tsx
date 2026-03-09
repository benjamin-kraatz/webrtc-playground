import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, historyKeymap, history } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { oneDark } from '@codemirror/theme-one-dark';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

type Lang = 'javascript' | 'html' | 'css' | 'plain';

const LANG_EXTENSIONS = {
  javascript: () => javascript({ typescript: true }),
  html: () => html(),
  css: () => css(),
  plain: () => [],
};

const STARTER: Record<Lang, string> = {
  javascript: `// Collaborative TypeScript/JavaScript
// Both peers type simultaneously!

interface Peer {
  id: string;
  connected: boolean;
}

function greet(peer: Peer): string {
  return \`Hello, \${peer.id}! Connected: \${peer.connected}\`;
}

const me: Peer = { id: 'alice', connected: true };
console.log(greet(me));
`,
  html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Collaborative HTML</title>
</head>
<body>
  <h1>Hello, WebRTC!</h1>
  <p>Edit this HTML together in real time.</p>
</body>
</html>
`,
  css: `/* Collaborative CSS */
:root {
  --primary: #3b82f6;
  --bg: #18181b;
}

body {
  background: var(--bg);
  color: white;
  font-family: system-ui, sans-serif;
}

.card {
  background: #27272a;
  border-radius: 12px;
  padding: 1.5rem;
  border: 1px solid #3f3f46;
}
`,
  plain: `Type anything here — it will sync to your peer via RTCDataChannel.

No syntax highlighting in plain text mode,
but all other modes use CodeMirror 6 with syntax highlighting.

Fun fact: CodeMirror 6 is architected around a functional state model
where the editor state is immutable and changes are described as
transactions.`,
};

const CODE = `// CodeMirror 6 collaborative editing via RTCDataChannel
// Update listener sends changes on every keystroke
const view = new EditorView({
  doc: initialContent,
  extensions: [
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !isRemoteUpdate.current) {
        const newText = update.state.doc.toString();
        dc.send(JSON.stringify({ type: 'doc', text: newText }));
      }
    }),
  ],
});

// Receive and apply remote changes
dc.onmessage = ({ data }) => {
  const { text } = JSON.parse(data);
  isRemoteUpdate.current = true;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  isRemoteUpdate.current = false;
};`;

export default function PairCoder() {
  const logger = useMemo(() => new Logger(), []);
  const [roomId, setRoomId] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase());
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [joined, setJoined] = useState(false);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [lang, setLang] = useState<Lang>('javascript');
  const [peerTyping, setPeerTyping] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langCompartmentRef = useRef(new Compartment());
  const isRemoteRef = useRef(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initEditor = useCallback((container: HTMLDivElement, initialDoc: string) => {
    viewRef.current?.destroy();

    const state = EditorState.create({
      doc: initialDoc,
      extensions: [
        history(),
        lineNumbers(),
        highlightActiveLine(),
        oneDark,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        langCompartmentRef.current.of(LANG_EXTENSIONS[lang]()),
        EditorView.updateListener.of((update: { docChanged: boolean; state: { doc: { toString: () => string } } }) => {
          if (update.docChanged && !isRemoteRef.current) {
            const text = update.state.doc.toString();
            if (debounceTimer.current) clearTimeout(debounceTimer.current);
            debounceTimer.current = setTimeout(() => {
              dcRef.current?.send(JSON.stringify({ type: 'doc', text }));
            }, 80);
          }
        }),
        EditorView.theme({
          '&': { height: '360px', fontSize: '13px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: '"Fira Code", "Cascadia Code", monospace' },
        }),
      ],
    });

    viewRef.current = new EditorView({ state, parent: container });
  }, [lang]);

  useEffect(() => {
    if (!editorRef.current) return;
    initEditor(editorRef.current, STARTER[lang]);
  }, []);

  // Update language compartment when lang changes
  useEffect(() => {
    if (!viewRef.current) return;
    viewRef.current.dispatch({
      effects: langCompartmentRef.current.reconfigure(LANG_EXTENSIONS[lang]()),
    });
  }, [lang]);

  const setupDc = useCallback((dc: RTCDataChannel) => {
    dcRef.current = dc;
    dc.onopen = () => {
      logger.success('Code channel open — start pair programming!');
      // Share current doc to new peer
      if (viewRef.current) {
        dc.send(JSON.stringify({ type: 'doc', text: viewRef.current.state.doc.toString() }));
      }
    };
    dc.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'doc' && viewRef.current) {
        isRemoteRef.current = true;
        const cursor = viewRef.current.state.selection.main.head;
        viewRef.current.dispatch({
          changes: { from: 0, to: viewRef.current.state.doc.length, insert: msg.text },
          selection: { anchor: Math.min(cursor, msg.text.length) },
        });
        isRemoteRef.current = false;
        setPeerTyping(true);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setPeerTyping(false), 1500);
      }
    };
  }, [logger]);

  const onMessage = useCallback(async (msg: SignalingMessage) => {
    const pc = pcRef.current;
    if (!pc) return;
    switch (msg.type) {
      case 'peer-joined': {
        remotePeerIdRef.current = msg.peerId;
        const dc = pc.createDataChannel('code');
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

  const handleLangChange = (newLang: Lang) => {
    setLang(newLang);
    if (viewRef.current && !dcRef.current) {
      const doc = STARTER[newLang];
      viewRef.current.dispatch({ changes: { from: 0, to: viewRef.current.state.doc.length, insert: doc } });
    }
  };

  useEffect(() => {
    return () => {
      viewRef.current?.destroy();
      pcRef.current?.close();
    };
  }, []);

  return (
    <DemoLayout
      title="Pair Coder"
      difficulty="advanced"
      description="Real-time collaborative code editor powered by CodeMirror 6, synced keystroke-by-keystroke via RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>CodeMirror 6</strong> is a modular, extensible code editor. Its
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded ml-1">EditorView.updateListener</code> fires
            on every document change. We serialize the full document text and debounce-send it over
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded ml-1">RTCDataChannel</code> — last-write-wins
            for lightweight pair programming without CRDT complexity.
          </p>
          <p>
            Switch languages to reload the editor with JavaScript/TypeScript, HTML, or CSS starter
            code. The editor preserves cursor position across remote updates.
          </p>
          {sigStatus !== 'connected' && (
            <p className="text-amber-400 text-xs">⚠ Run <code className="bg-surface-2 px-1 py-0.5 rounded">bun run dev</code> to start the signaling server.</p>
          )}
        </div>
      }
      hints={['Open two tabs with the same room code', 'Both peers type in the same editor — changes sync ~80ms', 'Switch language to change syntax highlighting']}
      demo={
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <ConnectionStatus state={connectionState} />
            <span className="text-xs text-zinc-500">Signaling: <span className={sigStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{sigStatus}</span></span>
            {peerTyping && <span className="text-xs text-indigo-400 animate-pulse">Peer is typing…</span>}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Language picker */}
            <div className="flex gap-1 bg-surface-0 border border-zinc-800 rounded-lg p-1">
              {(['javascript', 'html', 'css', 'plain'] as Lang[]).map((l) => (
                <button
                  key={l}
                  onClick={() => handleLangChange(l)}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${lang === l ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  {l === 'javascript' ? 'JS/TS' : l.toUpperCase()}
                </button>
              ))}
            </div>

            {!joined ? (
              <>
                <div>
                  <label className="text-xs text-zinc-500">Room Code</label>
                  <input value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                    className="block mt-1 bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-zinc-200 w-28 focus:outline-none focus:border-blue-500" />
                </div>
                <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg mt-4">
                  Join Room
                </button>
              </>
            ) : (
              <button onClick={handleLeave} className="px-3 py-1.5 bg-red-900/40 text-red-400 text-xs rounded border border-red-800">
                Leave
              </button>
            )}
          </div>

          <div
            ref={editorRef}
            className="rounded-xl overflow-hidden border border-zinc-800"
            style={{ minHeight: 360 }}
          />
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'CodeMirror 6 sync via RTCDataChannel' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
