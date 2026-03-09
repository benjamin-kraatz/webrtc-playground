import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Sample {
  t: number;
  mbps: number;
}

const CHUNK_SIZE = 64 * 1024; // 64 KB
const TOTAL_MB = 20;
const TOTAL_BYTES = TOTAL_MB * 1024 * 1024;

const CODE = `// Sender: flood a DataChannel with 64 KB chunks
const chunk = new ArrayBuffer(64 * 1024); // 64 KB
const startTime = performance.now();
let bytesSent = 0;

function sendNext() {
  // Respect backpressure — wait if the buffer is full
  while (dc.bufferedAmount < 4 * 1024 * 1024 && bytesSent < TOTAL_BYTES) {
    dc.send(chunk);
    bytesSent += chunk.byteLength;
  }
  if (bytesSent < TOTAL_BYTES) {
    dc.onbufferedamountlow = sendNext;
    dc.bufferedAmountLowThreshold = 512 * 1024;
  }
}

// Receiver: count bytes and calculate throughput
let bytesReceived = 0;
dc.onmessage = ({ data }) => {
  bytesReceived += data.byteLength;
  const elapsed = (performance.now() - startTime) / 1000;
  const mbps = (bytesReceived * 8) / elapsed / 1_000_000;
  console.log(\`Throughput: \${mbps.toFixed(1)} Mbps\`);
};`;

export default function SpeedTest() {
  const logger = useMemo(() => new Logger(), []);
  const [phase, setPhase] = useState<'idle' | 'connecting' | 'running' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [currentMbps, setCurrentMbps] = useState(0);
  const [peakMbps, setPeakMbps] = useState(0);
  const [samples, setSamples] = useState<Sample[]>([]);
  const pcARef = useRef<RTCPeerConnection | null>(null);
  const pcBRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const sampleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const reset = () => {
    if (sampleTimerRef.current) clearInterval(sampleTimerRef.current);
    dcRef.current?.close();
    pcARef.current?.close();
    pcBRef.current?.close();
    dcRef.current = null; pcARef.current = null; pcBRef.current = null;
    setPhase('idle');
    setProgress(0);
    setCurrentMbps(0);
    setSamples([]);
  };

  const runTest = async () => {
    reset();
    setPhase('connecting');
    logger.info('Creating loopback peers...');

    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcARef.current = pcA; pcBRef.current = pcB;

    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);

    const dc = pcA.createDataChannel('speedtest', { ordered: false, maxRetransmits: 0 });
    dcRef.current = dc;
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      logger.success(`Channel open (${TOTAL_MB} MB, unordered) — sending...`);
      setPhase('running');

      const chunk = new ArrayBuffer(CHUNK_SIZE);
      const view = new Uint8Array(chunk);
      for (let i = 0; i < view.length; i++) view[i] = i & 0xff;

      let bytesSent = 0;
      const startTime = performance.now();
      let sampleT = 0;

      const sendChunks = () => {
        while (dc.bufferedAmount < 8 * 1024 * 1024 && bytesSent < TOTAL_BYTES) {
          dc.send(chunk);
          bytesSent += CHUNK_SIZE;
        }
        const pct = bytesSent / TOTAL_BYTES;
        setProgress(pct);
        if (bytesSent < TOTAL_BYTES) {
          dc.bufferedAmountLowThreshold = 1 * 1024 * 1024;
          dc.onbufferedamountlow = sendChunks;
        } else {
          logger.success(`Sent ${TOTAL_MB} MB in ${((performance.now() - startTime) / 1000).toFixed(2)} s`);
        }
      };
      sendChunks();

      sampleTimerRef.current = setInterval(() => {
        sampleT++;
      }, 200);
    };

    let bytesReceived = 0;
    const recvStart = { t: 0 };

    pcB.ondatachannel = (ev) => {
      const rcvDc = ev.channel;
      rcvDc.binaryType = 'arraybuffer';
      rcvDc.onmessage = (e) => {
        if (bytesReceived === 0) recvStart.t = performance.now();
        bytesReceived += (e.data as ArrayBuffer).byteLength;
        const elapsed = (performance.now() - recvStart.t) / 1000;
        const mbps = elapsed > 0 ? (bytesReceived * 8) / elapsed / 1_000_000 : 0;
        setCurrentMbps(parseFloat(mbps.toFixed(1)));
        setPeakMbps((p) => Math.max(p, parseFloat(mbps.toFixed(1))));
        setSamples((prev) => {
          const next = [...prev, { t: parseFloat(elapsed.toFixed(1)), mbps: parseFloat(mbps.toFixed(1)) }];
          return next.length > 80 ? next.slice(-80) : next;
        });
        const pct = bytesReceived / TOTAL_BYTES;
        setProgress(pct);
        if (bytesReceived >= TOTAL_BYTES) {
          if (sampleTimerRef.current) clearInterval(sampleTimerRef.current);
          setPhase('done');
          logger.success(`Done! Peak ${mbps.toFixed(1)} Mbps, ${(bytesReceived / 1024 / 1024).toFixed(1)} MB received`);
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

  return (
    <DemoLayout
      title="DataChannel Speed Test"
      difficulty="intermediate"
      description="Saturate an RTCDataChannel with binary data and measure peak throughput in real time."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>RTCDataChannel</strong> in unordered, unreliable mode (<code className="text-xs bg-surface-2 px-1 py-0.5 rounded">maxRetransmits: 0</code>) behaves
            like UDP — it won't retransmit lost packets, which maximizes raw throughput.
            This test fires 64 KB chunks as fast as the channel allows, measuring bytes
            received per second on the remote side.
          </p>
          <p>
            A loopback connection (both peers in the same page) typically peaks at{' '}
            <strong>500 – 3000+ Mbps</strong> because data never leaves the browser process.
            Over a real LAN you'd see 50–200 Mbps; over the internet, 1–30 Mbps is typical.
          </p>
          <p>
            <strong>Back-pressure</strong> is handled by watching{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">dc.bufferedAmount</code> and pausing when the
            send buffer is full, resuming via{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">onbufferedamountlow</code>.
          </p>
        </div>
      }
      hints={[
        'Loopback speed is limited by your CPU — close other tabs for a higher peak',
        'Unordered mode skips retransmissions, maximizing raw throughput like UDP',
        'Real network speeds depend on network path, NAT type, and congestion',
      ]}
      demo={
        <div className="space-y-5">
          {/* Big speed display */}
          <div className="flex items-end gap-4">
            <div>
              <div className="text-5xl font-bold font-mono text-blue-400">{currentMbps.toFixed(1)}</div>
              <div className="text-sm text-zinc-500 mt-1">Mbps current</div>
            </div>
            <div className="pb-1">
              <div className="text-2xl font-bold font-mono text-emerald-400">{peakMbps.toFixed(1)}</div>
              <div className="text-xs text-zinc-500">peak</div>
            </div>
          </div>

          {/* Progress bar */}
          {phase !== 'idle' && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-zinc-500">
                <span>{phase === 'done' ? 'Complete' : 'Progress'}</span>
                <span>{(progress * TOTAL_MB).toFixed(1)} / {TOTAL_MB} MB</span>
              </div>
              <div className="h-2 bg-surface-0 border border-zinc-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-100 ${phase === 'done' ? 'bg-emerald-500' : 'bg-blue-500'}`}
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Throughput chart */}
          <div className="bg-surface-0 border border-zinc-800 rounded-xl p-3" style={{ height: 180 }}>
            {samples.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-zinc-600">
                Run a test to see throughput over time
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={samples} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="mbpsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#60a5fa" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="t" tick={{ fontSize: 10, fill: '#71717a' }} unit="s" />
                  <YAxis tick={{ fontSize: 10, fill: '#71717a' }} unit=" Mbps" />
                  <Tooltip
                    contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [`${v} Mbps`, 'Throughput']}
                  />
                  <Area type="monotone" dataKey="mbps" stroke="#60a5fa" fill="url(#mbpsGrad)" dot={false} strokeWidth={2} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={runTest}
              disabled={phase === 'connecting' || phase === 'running'}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
            >
              {phase === 'running' ? 'Testing…' : phase === 'connecting' ? 'Connecting…' : 'Run Test'}
            </button>
            {phase !== 'idle' && (
              <button onClick={reset} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                Reset
              </button>
            )}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'DataChannel throughput test with backpressure' }}
      mdnLinks={[
        { label: 'RTCDataChannel.bufferedAmount', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmount' },
        { label: 'RTCDataChannel.bufferedAmountLowThreshold', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmountLowThreshold' },
      ]}
    />
  );
}
