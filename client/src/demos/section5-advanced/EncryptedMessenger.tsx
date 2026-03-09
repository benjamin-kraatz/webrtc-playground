import { useMemo, useRef, useState, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

interface Message {
  id: number;
  plaintext: string;
  cipherHex: string;
  from: 'local' | 'remote';
  ts: number;
}
let msgId = 0;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function exportPubKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

async function importPubKey(b64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
}

const CODE = `// End-to-end encryption via Web Crypto ECDH + AES-GCM

// 1. Each peer generates an ECDH key pair
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
);

// 2. Exchange public keys over DataChannel
dc.send(JSON.stringify({ type: 'pubkey', key: exportedPublicKey }));

// 3. Derive shared AES key
const sharedKey = await crypto.subtle.deriveKey(
  { name: 'ECDH', public: remotePubKey },
  privateKey,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt']
);

// 4. Encrypt a message
const iv = crypto.getRandomValues(new Uint8Array(12));
const ciphertext = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv },
  sharedKey,
  new TextEncoder().encode(plaintext)
);
dc.send(JSON.stringify({ iv: toBase64(iv), ct: toBase64(ciphertext) }));

// 5. Decrypt on the other side
const plaintext = await crypto.subtle.decrypt(
  { name: 'AES-GCM', iv },
  sharedKey,
  ciphertext
);`;

export default function EncryptedMessenger() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [roomId, setRoomId] = useState('CRYPTO01');
  const [joined, setJoined] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [keyStatus, setKeyStatus] = useState<'none' | 'generated' | 'exchanged'>('none');
  const privateKeyRef = useRef<CryptoKey | null>(null);
  const sharedKeyRef = useRef<CryptoKey | null>(null);
  const pubKeyB64Ref = useRef('');
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const dataChannels = useRef(new Map<string, RTCDataChannel>());
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const encrypt = async (text: string): Promise<{ iv: string; ct: string }> => {
    if (!sharedKeyRef.current) throw new Error('No shared key');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      sharedKeyRef.current,
      new TextEncoder().encode(text)
    );
    return { iv: btoa(String.fromCharCode(...iv)), ct: btoa(String.fromCharCode(...new Uint8Array(ct))) };
  };

  const decrypt = async (ivB64: string, ctB64: string): Promise<string> => {
    if (!sharedKeyRef.current) throw new Error('No shared key');
    const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, sharedKeyRef.current, ct);
    return new TextDecoder().decode(plain);
  };

  const broadcast = async (msg: object) => {
    const s = JSON.stringify(msg);
    dataChannels.current.forEach((dc) => { if (dc.readyState === 'open') dc.send(s); });
  };

  const setupDc = useCallback((dc: RTCDataChannel, remotePeerId: string) => {
    dataChannels.current.set(remotePeerId, dc);
    dc.onopen = async () => {
      logger.success(`Secure channel open with ${remotePeerId} — exchanging keys...`);
      // Send our public key
      dc.send(JSON.stringify({ type: 'pubkey', key: pubKeyB64Ref.current }));
    };
    dc.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'pubkey') {
        const remotePub = await importPubKey(msg.key);
        sharedKeyRef.current = await crypto.subtle.deriveKey(
          { name: 'ECDH', public: remotePub },
          privateKeyRef.current!,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']
        );
        setKeyStatus('exchanged');
        logger.success('🔐 ECDH key exchange complete — AES-256-GCM session key derived!');
      } else if (msg.type === 'encrypted') {
        try {
          const plaintext = await decrypt(msg.iv, msg.ct);
          const ctBytes = Uint8Array.from(atob(msg.ct), (c) => c.charCodeAt(0));
          const cipherHex = toHex(ctBytes.buffer).slice(0, 48) + '…';
          setMessages((m) => [...m, { id: ++msgId, plaintext, cipherHex, from: 'remote', ts: Date.now() }]);
          logger.success(`Decrypted: "${plaintext}"`);
        } catch (e) { logger.error(`Decryption failed: ${e}`); }
      }
    };
  }, []);

  const createPc = useCallback((remotePeerId: string) => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    peerConnections.current.set(remotePeerId, pc);
    pc.onicecandidate = (ev) => { if (ev.candidate) sendRef.current({ type: 'ice-candidate', from: peerId, to: remotePeerId, candidate: ev.candidate.toJSON() }); };
    pc.ondatachannel = (ev) => setupDc(ev.channel, remotePeerId);
    return pc;
  }, [peerId, setupDc]);

  const { connect, join, send } = useSignaling({
    logger,
    onMessage: useCallback(async (msg: SignalingMessage) => {
      switch (msg.type) {
        case 'peer-list': {
          for (const peer of msg.peers) {
            const pc = createPc(peer.peerId);
            const dc = pc.createDataChannel('secure');
            setupDc(dc, peer.peerId);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendRef.current({ type: 'offer', from: peerId, to: peer.peerId, sdp: offer });
          }
          break;
        }
        case 'offer': {
          const pc = createPc(msg.from);
          await pc.setRemoteDescription(msg.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendRef.current({ type: 'answer', from: peerId, to: msg.from, sdp: answer });
          break;
        }
        case 'answer': await peerConnections.current.get(msg.from)?.setRemoteDescription(msg.sdp); break;
        case 'ice-candidate': await peerConnections.current.get(msg.from)?.addIceCandidate(msg.candidate).catch(console.warn); break;
      }
    }, [createPc, setupDc, peerId]),
  });
  sendRef.current = send;

  const handleJoin = async () => {
    logger.info('Generating ECDH P-256 key pair...');
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey']
    );
    privateKeyRef.current = privateKey;
    pubKeyB64Ref.current = await exportPubKey(publicKey);
    setKeyStatus('generated');
    logger.success('Key pair generated — joining room...');
    connect();
    setTimeout(() => { join(roomId, peerId); setJoined(true); }, 500);
  };

  const sendMessage = async () => {
    if (!input.trim() || keyStatus !== 'exchanged') return;
    const text = input.trim();
    setInput('');
    try {
      const { iv, ct } = await encrypt(text);
      const ctBytes = Uint8Array.from(atob(ct), (c) => c.charCodeAt(0));
      const cipherHex = toHex(ctBytes.buffer).slice(0, 48) + '…';
      await broadcast({ type: 'encrypted', iv, ct });
      setMessages((m) => [...m, { id: ++msgId, plaintext: text, cipherHex, from: 'local', ts: Date.now() }]);
      logger.info(`Encrypted & sent: "${text}"`);
    } catch (e) { logger.error(`Encryption failed: ${e}`); }
  };

  const handleLeave = () => {
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    dataChannels.current.clear();
    sharedKeyRef.current = null;
    setJoined(false);
    setKeyStatus('none');
    setMessages([]);
  };

  const keyBadge = keyStatus === 'exchanged'
    ? <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-900 text-emerald-300 border border-emerald-700">🔐 E2E Encrypted</span>
    : keyStatus === 'generated'
    ? <span className="px-2 py-0.5 rounded-full text-xs bg-amber-900 text-amber-300 border border-amber-700">🔑 Key Generated</span>
    : null;

  return (
    <DemoLayout
      title="Encrypted Messenger"
      difficulty="advanced"
      description="End-to-end encrypted chat using ECDH key exchange and AES-256-GCM — powered entirely by the Web Crypto API."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This demo implements real <strong>end-to-end encryption</strong> using only built-in browser APIs:
          </p>
          <ol className="list-decimal list-inside space-y-1 pl-2">
            <li>Each peer generates an <strong>ECDH P-256</strong> key pair</li>
            <li>Public keys are exchanged over the DataChannel</li>
            <li>Each side derives the same <strong>AES-256-GCM</strong> session key using their private key + the peer's public key</li>
            <li>All messages are encrypted with a random IV before sending</li>
            <li>The receiver decrypts with the shared key — the signaling server never sees the plaintext</li>
          </ol>
          <p>
            This is Diffie-Hellman key agreement in the browser — the mathematical foundation of
            Signal, WhatsApp, and TLS. No libraries, no servers, just Web Crypto.
          </p>
        </div>
      }
      hints={[
        'Open two tabs with the same room code',
        'The 🔐 badge lights up when the key exchange is complete',
        'Notice the ciphertext shown below each message — same key but different IV every time',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap gap-3 items-center">
            <input value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={joined}
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono w-32 focus:outline-none disabled:opacity-50" />
            {!joined ? (
              <button onClick={handleJoin} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg">Generate Keys & Join</button>
            ) : (
              <button onClick={handleLeave} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">Leave</button>
            )}
            {keyBadge}
          </div>

          {/* Messages */}
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {messages.length === 0 && keyStatus === 'exchanged' && (
              <p className="text-xs text-zinc-600 text-center py-4">Send your first encrypted message ↓</p>
            )}
            {keyStatus !== 'exchanged' && joined && (
              <p className="text-xs text-amber-500/80 text-center py-4">Waiting for peer to join and exchange keys…</p>
            )}
            {messages.map((m) => (
              <div key={m.id} className={`p-3 rounded-xl border space-y-1 ${m.from === 'local' ? 'border-emerald-900/50 bg-emerald-950/20' : 'border-blue-900/50 bg-blue-950/20'}`}>
                <p className="text-sm text-zinc-200">{m.plaintext}</p>
                <p className="text-xs font-mono text-zinc-600 break-all">🔒 {m.cipherHex}</p>
                <p className="text-xs text-zinc-600">{m.from === 'local' ? 'You →' : '← Peer'} · {new Date(m.ts).toLocaleTimeString()}</p>
              </div>
            ))}
          </div>

          {/* Input */}
          <div className="flex gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder={keyStatus === 'exchanged' ? 'Type a secret message…' : 'Waiting for key exchange…'}
              disabled={keyStatus !== 'exchanged'}
              className="flex-1 bg-surface-0 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50" />
            <button onClick={sendMessage} disabled={keyStatus !== 'exchanged' || !input.trim()}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              Send 🔐
            </button>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'ECDH P-256 + AES-256-GCM via Web Crypto API' }}
      mdnLinks={[
        { label: 'SubtleCrypto.deriveKey()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey' },
        { label: 'SubtleCrypto.encrypt()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt' },
        { label: 'ECDH', href: 'https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey#ecdh' },
      ]}
    />
  );
}
