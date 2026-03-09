import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

type CapsuleState = 'idle' | 'sent' | 'locked' | 'unlocked';

const CODE = `// P2P Time Capsule — encrypted message, timed reveal via Web Crypto

// 1. Derive AES key from the reveal timestamp (both peers can compute the same key)
async function deriveRevealKey(revealAtMs) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(String(revealAtMs)), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: new TextEncoder().encode('time-capsule'), iterations: 50000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// 2. Encrypt the message and send it with the reveal timestamp
const iv = crypto.getRandomValues(new Uint8Array(12));
const key = await deriveRevealKey(revealAt);
const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(message));
dc.send(JSON.stringify({ type: 'capsule', revealAt, iv: toBase64(iv), ct: toBase64(ct) }));

// 3. Receiver waits for the scheduled time, then decrypts
function scheduleReveal(capsule) {
  const msUntil = capsule.revealAt - Date.now();
  setTimeout(async () => {
    const key = await deriveRevealKey(capsule.revealAt);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(capsule.iv) }, key, fromBase64(capsule.ct));
    showMessage(new TextDecoder().decode(plain));
  }, msUntil);
}`;

const DELAYS = [
  { label: '30 seconds', ms: 30_000 },
  { label: '1 minute',   ms: 60_000 },
  { label: '2 minutes',  ms: 120_000 },
  { label: '5 minutes',  ms: 300_000 },
];

function toBase64(buf: ArrayBuffer | Uint8Array) {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...arr));
}
function fromBase64(s: string) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }

export default function TimeCapsule() {
  const logger = useMemo(() => new Logger(), []);
  const [message, setMessage] = useState('');
  const [delayMs, setDelayMs] = useState(30_000);
  const [phase, setPhase] = useState<CapsuleState>('idle');
  const [revealedMessage, setRevealedMessage] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [revealAt, setRevealAt] = useState(0);
  const [connected, setConnected] = useState(false);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => { if (countdownRef.current) clearInterval(countdownRef.current); }, []);

  const deriveKey = async (ts: number) => {
    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(ts)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new TextEncoder().encode('webrtc-time-capsule'), iterations: 50000, hash: 'SHA-256' },
      km,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  };

  const startCountdown = (revealTs: number) => {
    setRevealAt(revealTs);
    setPhase('locked');
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      const left = Math.max(0, revealTs - Date.now());
      setCountdown(left);
      if (left === 0) clearInterval(countdownRef.current!);
    }, 100);
  };

  const connect = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = ev => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = ev => ev.candidate && pcA.addIceCandidate(ev.candidate);
    const dc = pcA.createDataChannel('capsule', { ordered: true });
    dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Capsule channel open — write your message!'); };

    pcB.ondatachannel = ev => {
      ev.channel.onmessage = async e => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'capsule') {
          logger.info(`Capsule received! Sealed until ${new Date(msg.revealAt).toLocaleTimeString()}`);
          startCountdown(msg.revealAt);
          const msUntil = msg.revealAt - Date.now();
          setTimeout(async () => {
            try {
              const key = await deriveKey(msg.revealAt);
              const iv = fromBase64(msg.iv);
              const ct = fromBase64(msg.ct);
              const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
              const text = new TextDecoder().decode(plain);
              setRevealedMessage(text);
              setPhase('unlocked');
              logger.success(`🎉 Time capsule revealed: "${text.slice(0,60)}"`);
            } catch { logger.error('Decryption failed'); }
          }, Math.max(0, msUntil));
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

  const sendCapsule = async () => {
    if (!message.trim() || !dcRef.current || dcRef.current.readyState !== 'open') return;
    const ts = Date.now() + delayMs;
    logger.info(`Sealing capsule with ${DELAYS.find(d => d.ms === delayMs)?.label} timer...`);
    const key = await deriveKey(ts);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(message);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    dcRef.current.send(JSON.stringify({ type: 'capsule', revealAt: ts, iv: toBase64(iv), ct: toBase64(ct) }));
    setPhase('sent');
    logger.success(`Capsule sent! Opens at ${new Date(ts).toLocaleTimeString()}`);
  };

  const reset = () => {
    setPhase('idle'); setMessage(''); setRevealedMessage(''); setCountdown(0);
    if (countdownRef.current) clearInterval(countdownRef.current);
  };

  const secs = Math.ceil(countdown / 1000);
  const progress = revealAt ? Math.max(0, 1 - countdown / delayMs) : 0;

  return (
    <DemoLayout
      title="P2P Time Capsule"
      difficulty="advanced"
      description="Write a secret message, seal it with a timed AES-256-GCM lock, and send it — it only decrypts when the timer expires."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            The reveal time is the encryption key — literally. Both sender and receiver
            independently derive the same <strong>AES-256-GCM key</strong> from the Unix
            timestamp of the reveal time using PBKDF2. The encrypted payload is sent over
            DataChannel. The receiver's browser cannot decrypt it until the clock reaches
            the target time, at which point it derives the same key and unlocks the message.
          </p>
          <p>
            This technique is called <strong>time-lock encryption</strong>. It doesn't require
            a trusted third party — just synchronized clocks (NTP). The ciphertext could sit
            on any server or be broadcast publicly; without the right time, it's unreadable.
          </p>
          <p>
            ⚠ This is a conceptual demo — real time-lock encryption uses puzzle-based schemes
            that don't depend on clock agreement. But this version is a beautiful illustration
            of the concept using only the Web Crypto API.
          </p>
        </div>
      }
      hints={[
        'Connect, write a message, pick a delay, then send the capsule',
        'The right panel simulates the receiver — watch the countdown and auto-reveal!',
        'The same delay value becomes the decryption key — change it and decryption fails',
      ]}
      demo={
        <div className="space-y-5">
          {!connected && (
            <button onClick={connect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
              Connect Loopback
            </button>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Sender panel */}
            <div className="bg-surface-0 border border-zinc-800 rounded-2xl p-4 space-y-4">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">📤 Sender</p>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Write your secret message…"
                disabled={phase !== 'idle'}
                rows={4}
                className="w-full bg-surface-1 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200 resize-none focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
              <div className="grid grid-cols-2 gap-2">
                {DELAYS.map(d => (
                  <button key={d.ms} onClick={() => setDelayMs(d.ms)} disabled={phase !== 'idle'}
                    className={`py-2 text-xs rounded-xl border transition-colors disabled:opacity-40 ${delayMs === d.ms ? 'border-amber-500 bg-amber-950/40 text-amber-300' : 'border-zinc-800 text-zinc-500 hover:border-zinc-600'}`}>
                    ⏱ {d.label}
                  </button>
                ))}
              </div>
              {phase === 'idle' ? (
                <button onClick={sendCapsule} disabled={!connected || !message.trim()}
                  className="w-full py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold rounded-xl">
                  🔒 Seal & Send Capsule
                </button>
              ) : (
                <div className="text-center space-y-1">
                  <p className="text-emerald-400 text-sm font-bold">✓ Capsule sent!</p>
                  <button onClick={reset} className="text-xs text-zinc-500 hover:text-zinc-300">Send another</button>
                </div>
              )}
            </div>

            {/* Receiver panel */}
            <div className="bg-surface-0 border border-zinc-800 rounded-2xl p-4 space-y-4">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">📥 Receiver</p>
              {phase === 'idle' || phase === 'sent' ? (
                <div className="flex-1 flex items-center justify-center h-32 text-zinc-700 text-sm">
                  Waiting for capsule…
                </div>
              ) : phase === 'locked' ? (
                <div className="space-y-4">
                  <div className="bg-zinc-950 border-2 border-amber-900/60 rounded-2xl p-6 text-center">
                    <div className="text-5xl mb-3">🔒</div>
                    <p className="text-amber-400 font-bold text-2xl font-mono">{secs}s</p>
                    <p className="text-zinc-500 text-xs mt-1">until reveal</p>
                  </div>
                  <div className="h-2 bg-zinc-900 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full transition-all duration-100" style={{ width: `${progress * 100}%` }} />
                  </div>
                  <p className="text-xs text-zinc-600 text-center">
                    Encrypted • Opens at {new Date(revealAt).toLocaleTimeString()}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="bg-emerald-950/40 border-2 border-emerald-700 rounded-2xl p-4 text-center">
                    <div className="text-4xl mb-2">🎉</div>
                    <p className="text-emerald-400 font-bold text-sm mb-2">Capsule Unlocked!</p>
                    <p className="text-zinc-200 text-sm break-words">{revealedMessage}</p>
                  </div>
                  <button onClick={reset} className="w-full py-2 text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-800 rounded-xl">
                    Reset
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Time-lock encryption via PBKDF2 + AES-GCM + DataChannel' }}
      mdnLinks={[
        { label: 'SubtleCrypto.deriveKey()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey' },
        { label: 'SubtleCrypto.encrypt()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt' },
      ]}
    />
  );
}
