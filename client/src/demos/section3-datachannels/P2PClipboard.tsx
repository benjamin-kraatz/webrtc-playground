import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

interface ClipEntry {
  id: number;
  content: string;
  type: 'text' | 'image';
  from: 'local' | 'remote';
  ts: number;
}

let entryId = 0;

const CODE = `// P2P Clipboard — send clipboard content over DataChannel
// Read from clipboard
const text = await navigator.clipboard.readText();
dc.send(JSON.stringify({ type: 'text', content: text }));

// Or read an image
const items = await navigator.clipboard.read();
for (const item of items) {
  if (item.types.includes('image/png')) {
    const blob = await item.getType('image/png');
    const reader = new FileReader();
    reader.onload = () => dc.send(JSON.stringify({
      type: 'image',
      content: reader.result, // base64 data URL
    }));
    reader.readAsDataURL(blob);
  }
}

// Receiver — write to clipboard or display
dc.onmessage = async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === 'text') await navigator.clipboard.writeText(msg.content);
};`;

export default function P2PClipboard() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [text, setText] = useState('');
  const [history, setHistory] = useState<ClipEntry[]>([]);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const pcARef = useRef<RTCPeerConnection | null>(null);
  const pcBRef = useRef<RTCPeerConnection | null>(null);

  const addEntry = (content: string, type: 'text' | 'image', from: 'local' | 'remote') => {
    setHistory((h) => [{ id: ++entryId, content, type, from, ts: Date.now() }, ...h].slice(0, 20));
  };

  const connect = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcARef.current = pcA; pcBRef.current = pcB;
    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);

    const dc = pcA.createDataChannel('clipboard', { ordered: true });
    dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Clipboard channel open — send anything!'); };

    pcB.ondatachannel = (ev) => {
      ev.channel.onmessage = async (e) => {
        const msg = JSON.parse(e.data as string);
        addEntry(msg.content, msg.type, 'remote');
        if (msg.type === 'text') {
          try { await navigator.clipboard.writeText(msg.content); logger.success(`Written to clipboard: "${msg.content.slice(0, 40)}"`); }
          catch { logger.info(`Received: "${msg.content.slice(0, 60)}"`); }
        } else {
          logger.success('Received image from peer');
        }
      };
    };

    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  const sendText = () => {
    if (!dcRef.current || dcRef.current.readyState !== 'open' || !text.trim()) return;
    dcRef.current.send(JSON.stringify({ type: 'text', content: text }));
    addEntry(text, 'text', 'local');
    logger.info(`Sent ${text.length} chars over DataChannel`);
    setText('');
  };

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      setText(t);
      logger.info(`Pasted from clipboard: ${t.length} chars`);
    } catch { logger.error('Clipboard read denied — type manually'); }
  };

  const pasteImageFromClipboard = async () => {
    if (!dcRef.current || dcRef.current.readyState !== 'open') return;
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        if (item.types.includes('image/png') || item.types.includes('image/jpeg')) {
          const blob = await item.getType(item.types.find((t) => t.startsWith('image/'))!);
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            dcRef.current!.send(JSON.stringify({ type: 'image', content: dataUrl }));
            addEntry(dataUrl, 'image', 'local');
            logger.success(`Sent image (${Math.round(blob.size / 1024)} KB) over DataChannel`);
          };
          reader.readAsDataURL(blob);
          return;
        }
      }
      logger.warn('No image found in clipboard');
    } catch { logger.error('Clipboard image read denied'); }
  };

  const disconnect = () => {
    dcRef.current?.close();
    pcARef.current?.close();
    pcBRef.current?.close();
    setConnected(false);
    logger.info('Disconnected');
  };

  return (
    <DemoLayout
      title="P2P Clipboard"
      difficulty="beginner"
      description="Instantly share text and images between browser tabs via RTCDataChannel — no server needed."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            The <strong>Clipboard API</strong> lets you read and write the system clipboard.
            Combined with <strong>RTCDataChannel</strong>, you can build a zero-server clipboard
            sync: paste text or an image in one tab, and it instantly appears in another.
          </p>
          <p>
            Text is serialized as JSON and sent as a string. Images are read as{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">Blob</code> objects,
            base64-encoded into a data URL, and sent as a (potentially large) string message.
            The receiver can write back to the clipboard or just display the content.
          </p>
          <p>
            In production you'd replace base64 with binary{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">ArrayBuffer</code> transfer
            for large images to avoid the 33% size overhead.
          </p>
        </div>
      }
      hints={[
        'Connect first, then type/paste text and hit Send',
        '"Paste from Clipboard" reads your OS clipboard directly',
        '"Send Image" reads an image from your clipboard (copy any image first)',
      ]}
      demo={
        <div className="space-y-4">
          {!connected ? (
            <button onClick={connect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
              Connect Loopback
            </button>
          ) : (
            <div className="space-y-4">
              {/* Input row */}
              <div className="flex gap-2">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendText()}
                  placeholder="Type or paste text..."
                  className="flex-1 bg-surface-0 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                />
                <button onClick={sendText} disabled={!text.trim()}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                  Send
                </button>
              </div>

              <div className="flex gap-2 flex-wrap">
                <button onClick={pasteFromClipboard}
                  className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-xs rounded-lg">
                  📋 Paste from Clipboard
                </button>
                <button onClick={pasteImageFromClipboard}
                  className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-xs rounded-lg">
                  🖼️ Send Image from Clipboard
                </button>
                <button onClick={disconnect} className="ml-auto text-xs text-zinc-600 hover:text-zinc-400">
                  Disconnect
                </button>
              </div>

              {/* History */}
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {history.length === 0 && (
                  <p className="text-xs text-zinc-600 text-center py-4">Clipboard history will appear here</p>
                )}
                {history.map((e) => (
                  <div key={e.id}
                    className={`flex gap-3 p-3 rounded-xl border text-sm ${e.from === 'local' ? 'bg-blue-950/30 border-blue-900/50' : 'bg-violet-950/30 border-violet-900/50'}`}>
                    <span className="text-lg shrink-0">{e.from === 'local' ? '↑' : '↓'}</span>
                    <div className="flex-1 min-w-0">
                      {e.type === 'text' ? (
                        <p className="text-zinc-200 break-all font-mono text-xs">{e.content.slice(0, 200)}{e.content.length > 200 ? '…' : ''}</p>
                      ) : (
                        <img src={e.content} alt="clipboard" className="max-h-32 rounded-lg border border-zinc-800" />
                      )}
                      <p className="text-xs text-zinc-600 mt-1">{e.from === 'local' ? 'Sent' : 'Received'} · {new Date(e.ts).toLocaleTimeString()}</p>
                    </div>
                    {e.type === 'text' && (
                      <button onClick={() => navigator.clipboard.writeText(e.content)}
                        className="shrink-0 text-xs text-zinc-600 hover:text-zinc-300 px-2">
                        Copy
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Clipboard API + DataChannel sync' }}
      mdnLinks={[
        { label: 'Clipboard API', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
