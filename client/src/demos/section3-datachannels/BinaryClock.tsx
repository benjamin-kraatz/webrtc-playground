import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

// BCD binary clock: hours tens (0-2), hours ones (0-9), minutes tens (0-5), minutes ones (0-9), seconds tens (0-5), seconds ones (0-9)
const COLUMN_BITS = [2, 4, 3, 4, 3, 4]; // bits per column
const LABELS = ['H₁','H₀','M₁','M₀','S₁','S₀'];

function toBCD(h: number, m: number, s: number): number[][] {
  const vals = [Math.floor(h/10), h%10, Math.floor(m/10), m%10, Math.floor(s/10), s%10];
  return vals.map((v, i) => Array.from({length: COLUMN_BITS[i]}, (_, b) => (v >> (COLUMN_BITS[i]-1-b)) & 1));
}

const CODE = `// Binary clock — time synced and skew measured via DataChannel

// Send current UTC time
dc.send(JSON.stringify({ type: 'time', ts: Date.now() }));

// Measure clock skew
dc.onmessage = ({ data }) => {
  const { ts } = JSON.parse(data);
  const remoteNow = ts + roundTripTime / 2; // correct for one-way delay
  const skew = Date.now() - remoteNow;      // how far off are our clocks?
  console.log(\`Clock skew: \${skew} ms\`);
};

// BCD encoding: each decimal digit → binary bits
function toBCD(hours, minutes, seconds) {
  return [
    hours   >> 4 & 1, hours   & 0xf, // H₁ H₀
    minutes >> 4 & 1, minutes & 0xf, // M₁ M₀
    seconds >> 4 & 1, seconds & 0xf, // S₁ S₀
  ].map(v => v.toString(2).padStart(4, '0'));
}`;

export default function BinaryClock() {
  const logger = useMemo(() => new Logger(), []);
  const [time, setTime] = useState(() => new Date());
  const [connected, setConnected] = useState(false);
  const [skewMs, setSkewMs] = useState<number | null>(null);
  const [peerTime, setPeerTime] = useState<Date | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTsRef = useRef(0);

  // Local clock tick
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Sync loop
  useEffect(() => {
    if (!connected) return;
    const loop = setInterval(() => {
      if (dcRef.current?.readyState === 'open') {
        pingTsRef.current = Date.now();
        dcRef.current.send(JSON.stringify({ type: 'time', ts: Date.now() }));
      }
    }, 2000);
    return () => clearInterval(loop);
  }, [connected]);

  const connect = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);
    const dc = pcA.createDataChannel('clock', { ordered: true });
    dcRef.current = dc;
    dc.onopen = () => {
      setConnected(true);
      dc.send(JSON.stringify({ type: 'time', ts: Date.now() }));
      logger.success('Clock channel open — measuring skew…');
    };
    pcB.ondatachannel = (ev) => {
      ev.channel.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'time') {
          const rtt = Date.now() - pingTsRef.current;
          const estimatedPeerNow = msg.ts + rtt / 2;
          const skew = Date.now() - estimatedPeerNow;
          setSkewMs(Math.round(skew));
          setPeerTime(new Date(estimatedPeerNow));
          logger.info(`RTT: ${rtt} ms · Clock skew: ${Math.round(skew)} ms`);
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

  const h = time.getHours(), m = time.getMinutes(), s = time.getSeconds();
  const columns = toBCD(h, m, s);

  const Dot = ({ on }: { on: boolean }) => (
    <div className={`w-7 h-7 rounded-full border-2 transition-all duration-300 ${on ? 'bg-blue-500 border-blue-400 shadow-lg shadow-blue-500/50' : 'bg-zinc-900 border-zinc-700'}`} />
  );

  return (
    <DemoLayout
      title="Binary Clock Sync"
      difficulty="beginner"
      description="A BCD binary clock that measures clock skew between peers via RTCDataChannel ping/pong."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            A <strong>BCD (Binary Coded Decimal)</strong> clock shows each decimal digit of the time
            in binary. The columns represent H₁H₀ : M₁M₀ : S₁S₀ — read each column from top
            (MSB) to bottom (LSB). Glowing blue = 1, dark = 0.
          </p>
          <p>
            The fun WebRTC part: every 2 seconds, Peer A sends its current timestamp. Peer B
            receives it and subtracts half the RTT to estimate the one-way delay, then calculates
            the <em>clock skew</em> between the two browser clocks. On the same machine,
            skew should be ≈ 0 ms; across the internet, drift between system clocks can be
            tens of milliseconds.
          </p>
        </div>
      }
      hints={[
        'Read each column from top to bottom as binary bits',
        'Connect to see clock skew measured between Peer A and Peer B',
        'On the same machine the skew is nearly 0 — try it across devices!',
      ]}
      demo={
        <div className="space-y-6">
          {/* Binary clock display */}
          <div className="flex gap-6 justify-center items-end p-6 bg-zinc-950 rounded-2xl border border-zinc-800">
            {columns.map((col, ci) => (
              <div key={ci} className="flex flex-col items-center gap-2">
                <div className="flex flex-col gap-2">
                  {/* spacer dots for shorter columns */}
                  {Array.from({length: 4 - col.length}).map((_, i) => (
                    <div key={i} className="w-7 h-7 rounded-full border-2 border-zinc-800/30 opacity-20" />
                  ))}
                  {col.map((bit, bi) => <Dot key={bi} on={bit === 1} />)}
                </div>
                <span className="text-xs text-zinc-500 font-mono">{LABELS[ci]}</span>
                {(ci === 1 || ci === 3) && <span className="absolute text-zinc-500 text-lg font-bold" style={{transform:'translateX(28px)'}}>:</span>}
              </div>
            ))}
          </div>

          {/* Human-readable time */}
          <div className="text-center">
            <p className="text-3xl font-mono font-bold text-zinc-300">
              {String(h).padStart(2,'0')}:{String(m).padStart(2,'0')}:{String(s).padStart(2,'0')}
            </p>
            <p className="text-xs text-zinc-600 mt-1">{time.toLocaleDateString()} UTC+{-(time.getTimezoneOffset()/60)}</p>
          </div>

          {/* Sync panel */}
          {!connected ? (
            <div className="flex justify-center">
              <button onClick={connect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Connect & Measure Skew
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-surface-0 border border-zinc-800 rounded-xl p-4 text-center">
                <p className="text-xs text-zinc-500 mb-1">Clock Skew</p>
                <p className={`text-2xl font-bold font-mono ${Math.abs(skewMs ?? 0) < 5 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {skewMs !== null ? `${skewMs > 0 ? '+' : ''}${skewMs} ms` : '—'}
                </p>
              </div>
              <div className="bg-surface-0 border border-zinc-800 rounded-xl p-4 text-center">
                <p className="text-xs text-zinc-500 mb-1">Peer B Clock</p>
                <p className="text-2xl font-bold font-mono text-blue-400">
                  {peerTime ? `${String(peerTime.getHours()).padStart(2,'0')}:${String(peerTime.getMinutes()).padStart(2,'0')}:${String(peerTime.getSeconds()).padStart(2,'0')}` : '—'}
                </p>
              </div>
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'BCD binary clock + DataChannel skew measurement' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
        { label: 'performance.now()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Performance/now' },
      ]}
    />
  );
}
