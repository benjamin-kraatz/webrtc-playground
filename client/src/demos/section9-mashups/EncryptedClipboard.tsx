import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

interface Entry { id: number; plaintext: string; cipherHex: string; from: 'local' | 'remote'; ts: number }
let entryId = 0;

function toHex(buf: ArrayBuffer) { return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join(''); }

const CODE = `// MASHUP: P2P Clipboard + Encrypted Messenger
// All clipboard content is AES-256-GCM encrypted before sending

// 1. Derive a shared key from a password (PBKDF2)
const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
const key = await crypto.subtle.deriveKey(
  { name: 'PBKDF2', salt: enc.encode('webrtc-clipboard'), iterations: 100000, hash: 'SHA-256' },
  keyMaterial,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt', 'decrypt']
);

// 2. Encrypt clipboard content
const iv = crypto.getRandomValues(new Uint8Array(12));
const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));

// 3. Send over DataChannel
dc.send(JSON.stringify({ iv: toBase64(iv), ct: toBase64(ciphertext) }));

// 4. Receive and decrypt
dc.onmessage = async ({ data }) => {
  const { iv, ct } = JSON.parse(data);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(ct));
  console.log(new TextDecoder().decode(plain));
};`;

export default function EncryptedClipboard() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [password, setPassword] = useState('my-secret-key');
  const [input, setInput] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [keyDerived, setKeyDerived] = useState(false);
  const keyRef = useRef<CryptoKey | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  const deriveKey = async (pw: string) => {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: enc.encode('webrtc-enc-clipboard'), iterations: 100000, hash: 'SHA-256' },
      km,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  };

  const connect = async () => {
    logger.info('Deriving AES-256-GCM key from password...');
    keyRef.current = await deriveKey(password);
    setKeyDerived(true);
    logger.success('Key derived — connecting loopback...');

    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = ev => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = ev => ev.candidate && pcA.addIceCandidate(ev.candidate);
    const dc = pcA.createDataChannel('enc-clipboard', { ordered: true });
    dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Encrypted clipboard channel open!'); };

    pcB.ondatachannel = ev => {
      ev.channel.onmessage = async e => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'encrypted' && keyRef.current) {
          try {
            const iv = Uint8Array.from(atob(msg.iv), c => c.charCodeAt(0));
            const ct = Uint8Array.from(atob(msg.ct), c => c.charCodeAt(0));
            const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, keyRef.current, ct);
            const text = new TextDecoder().decode(plain);
            const cipherHex = toHex(ct.buffer).slice(0, 40) + '…';
            setEntries(h => [{ id: ++entryId, plaintext: text, cipherHex, from: 'remote' as const, ts: Date.now() }, ...h].slice(0, 20));
            try { await navigator.clipboard.writeText(text); } catch {}
            logger.success(`Decrypted: "${text.slice(0,60)}"`);
          } catch { logger.error('Decryption failed — wrong password?'); }
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

  const sendText = async (text: string) => {
    if (!text.trim() || !keyRef.current || dcRef.current?.readyState !== 'open') return;
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keyRef.current, enc.encode(text));
    const ivB64 = btoa(String.fromCharCode(...iv));
    const ctB64 = btoa(String.fromCharCode(...new Uint8Array(ct)));
    dcRef.current.send(JSON.stringify({ type: 'encrypted', iv: ivB64, ct: ctB64 }));
    const cipherHex = toHex(ct).slice(0, 40) + '…';
    setEntries(h => [{ id: ++entryId, plaintext: text, cipherHex, from: 'local' as const, ts: Date.now() }, ...h].slice(0, 20));
    logger.info(`Encrypted & sent: ${ct.byteLength} cipher bytes for "${text.slice(0,40)}"`);
    setInput('');
  };

  const pasteAndSend = async () => {
    try { const t = await navigator.clipboard.readText(); await sendText(t); }
    catch { logger.error('Clipboard read denied'); }
  };

  return (
    <DemoLayout
      title="Encrypted Clipboard"
      difficulty="intermediate"
      description="MASHUP: P2P Clipboard + Encrypted Messenger — clipboard content is AES-256-GCM encrypted before every DataChannel send."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This mashup combines <strong>P2P Clipboard</strong>'s instant text sharing with{' '}
            <strong>Encrypted Messenger</strong>'s cryptography. Instead of ECDH key exchange,
            a <em>shared password</em> is stretched into an AES-256-GCM key using{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">PBKDF2</code> (100,000 iterations,
            SHA-256) — the same algorithm used by password managers.
          </p>
          <p>
            Both peers must use the <strong>same password</strong>. Any intercepted DataChannel
            message is pure ciphertext. The IV is randomized per message so identical plaintexts
            always produce different ciphertexts. The ciphertext hex is shown alongside the
            plaintext to make the encryption tangible.
          </p>
        </div>
      }
      hints={[
        'Both "peers" (loopback) use the same password — in real use, share it out-of-band',
        'Try changing the password before connecting — decryption will fail',
        'Each send uses a fresh random IV, so identical messages look different encrypted',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <input value={password} onChange={e => setPassword(e.target.value)} disabled={connected}
              placeholder="Shared password"
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm w-44 focus:outline-none focus:border-emerald-500 disabled:opacity-50 font-mono" />
            {!connected ? (
              <button onClick={connect} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg">
                🔐 Connect & Derive Key
              </button>
            ) : (
              <span className="text-xs px-2 py-1 rounded-full bg-emerald-900 text-emerald-300 border border-emerald-700">🔐 AES-256-GCM Active</span>
            )}
          </div>

          {connected && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendText(input)}
                  placeholder="Type text to encrypt and send…"
                  className="flex-1 bg-surface-0 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                <button onClick={() => sendText(input)} disabled={!input.trim()} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm rounded-lg">Send 🔒</button>
                <button onClick={pasteAndSend} className="px-3 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm rounded-lg">📋 Paste & Send</button>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {entries.length === 0 && <p className="text-xs text-zinc-600 text-center py-3">Send something to see encrypted output</p>}
                {entries.map(e => (
                  <div key={e.id} className={`p-3 rounded-xl border space-y-1.5 ${e.from === 'local' ? 'border-emerald-900/50 bg-emerald-950/20' : 'border-blue-900/50 bg-blue-950/20'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-zinc-200">{e.plaintext.slice(0,100)}{e.plaintext.length>100?'…':''}</p>
                      <span className="text-xs text-zinc-600 shrink-0">{e.from === 'local' ? '→ sent' : '← rcvd'}</span>
                    </div>
                    <p className="text-xs font-mono text-zinc-600 break-all">🔒 {e.cipherHex}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'PBKDF2 password → AES-256-GCM clipboard encryption' }}
      mdnLinks={[
        { label: 'SubtleCrypto.deriveKey() / PBKDF2', href: 'https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey#pbkdf2' },
        { label: 'SubtleCrypto.encrypt()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt' },
      ]}
    />
  );
}
