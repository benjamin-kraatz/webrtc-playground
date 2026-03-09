import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface PingPoint {
  seq: number;
  rtt: number;
}

const MAX_POINTS = 60;

const CODE = `// Peer A sends a ping with a timestamp
function sendPing() {
  dc.send(JSON.stringify({ type: 'ping', seq, t: performance.now() }));
}

// Peer B replies with a pong
dc.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === 'ping') dc.send(JSON.stringify({ type: 'pong', seq: msg.seq, t: msg.t }));
};

// Peer A measures round-trip time
dc.onmessage = ({ data }) => {
  const { type, seq, t } = JSON.parse(data);
  if (type === 'pong') {
    const rtt = performance.now() - t; // milliseconds
    console.log(\`RTT #\${seq}: \${rtt.toFixed(2)} ms\`);
  }
};`;

export default function LatencyPing() {
  const logger = useMemo(() => new Logger(), []);
  const [running, setRunning] = useState(false);
  const [pingData, setPingData] = useState<PingPoint[]>([]);
  const [stats, setStats] = useState({ min: 0, max: 0, avg: 0, last: 0 });
  const dcARef = useRef<RTCDataChannel | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const seqRef = useRef(0);
  const pcARef = useRef<RTCPeerConnection | null>(null);
  const pcBRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => () => { stopPing(); }, []);

  const startPing = async () => {
    logger.info('Creating loopback connection...');
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcARef.current = pcA;
    pcBRef.current = pcB;

    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);

    const dcA = pcA.createDataChannel('ping', { ordered: true });
    dcARef.current = dcA;

    pcB.ondatachannel = (ev) => {
      const dcB = ev.channel;
      dcB.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'ping') {
          dcB.send(JSON.stringify({ type: 'pong', seq: msg.seq, t: msg.t }));
        }
      };
    };

    const rtts: number[] = [];
    dcA.onmessage = (e) => {
      const msg = JSON.parse(e.data as string);
      if (msg.type === 'pong') {
        const rtt = performance.now() - msg.t;
        rtts.push(rtt);
        setPingData((prev) => {
          const next = [...prev, { seq: msg.seq, rtt: parseFloat(rtt.toFixed(2)) }];
          return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
        });
        setStats({
          last: parseFloat(rtt.toFixed(2)),
          min: parseFloat(Math.min(...rtts).toFixed(2)),
          max: parseFloat(Math.max(...rtts).toFixed(2)),
          avg: parseFloat((rtts.reduce((a, b) => a + b, 0) / rtts.length).toFixed(2)),
        });
      }
    };

    dcA.onopen = () => {
      logger.success('Channel open — starting ping loop');
      setRunning(true);
      seqRef.current = 0;
      intervalRef.current = setInterval(() => {
        if (dcA.readyState === 'open') {
          seqRef.current++;
          dcA.send(JSON.stringify({ type: 'ping', seq: seqRef.current, t: performance.now() }));
        }
      }, 200);
    };

    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  const stopPing = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    dcARef.current?.close();
    pcARef.current?.close();
    pcBRef.current?.close();
    dcARef.current = null;
    pcARef.current = null;
    pcBRef.current = null;
    setRunning(false);
    logger.info('Ping stopped');
  };

  const reset = () => {
    stopPing();
    setPingData([]);
    setStats({ min: 0, max: 0, avg: 0, last: 0 });
  };

  const statCard = (label: string, value: number, color: string) => (
    <div className="bg-surface-0 border border-zinc-800 rounded-lg p-3 text-center flex-1">
      <div className={`text-xl font-bold font-mono ${color}`}>{value > 0 ? `${value}` : '—'}</div>
      <div className="text-xs text-zinc-500 mt-0.5">{label} ms</div>
    </div>
  );

  return (
    <DemoLayout
      title="Latency Ping Monitor"
      difficulty="intermediate"
      description="Measure RTCDataChannel round-trip time with a continuous ping/pong loop — graphed live."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>Round-trip time (RTT)</strong> is one of the most important metrics in any real-time
            communication app. This demo sends a <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">ping</code> JSON
            message 5× per second over a loopback DataChannel. The receiver immediately echoes
            a <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">pong</code>, and we compute
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded mx-1">RTT = performance.now() - sentAt</code>.
          </p>
          <p>
            Loopback RTT should be under 2 ms — almost all of it is JavaScript overhead
            (serialization, event loop). Over a real network, you'd see 10–300 ms depending on
            distance and network quality.
          </p>
        </div>
      }
      hints={[
        'Loopback RTT is typically 0.2–1.5 ms (pure JS overhead)',
        'Spikes appear when the browser tab is throttled or doing heavy GC',
        'The ping interval is 200 ms — adjust the code to sample faster or slower',
      ]}
      demo={
        <div className="space-y-5">
          {/* Stat cards */}
          <div className="flex gap-3">
            {statCard('Last', stats.last, 'text-blue-400')}
            {statCard('Min', stats.min, 'text-emerald-400')}
            {statCard('Avg', stats.avg, 'text-amber-400')}
            {statCard('Max', stats.max, 'text-rose-400')}
          </div>

          {/* Chart */}
          <div className="bg-surface-0 border border-zinc-800 rounded-xl p-3" style={{ height: 220 }}>
            {pingData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-zinc-600">
                Start the ping to see live RTT data
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={pingData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="seq" tick={{ fontSize: 10, fill: '#71717a' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#71717a' }} unit=" ms" />
                  <Tooltip
                    contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: number) => [`${v} ms`, 'RTT']}
                  />
                  <Line type="monotone" dataKey="rtt" stroke="#60a5fa" dot={false} strokeWidth={2} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Controls */}
          <div className="flex gap-3">
            {!running ? (
              <button
                onClick={startPing}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Start Ping
              </button>
            ) : (
              <button
                onClick={stopPing}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Stop
              </button>
            )}
            <button
              onClick={reset}
              className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg transition-colors"
            >
              Reset
            </button>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Ping / Pong RTT measurement' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
        { label: 'performance.now()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Performance/now' },
      ]}
    />
  );
}
