import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { StatsPanel } from '@/components/ui/StatsPanel';
import { StatChart } from '@/components/ui/StatChart';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { useRtcStats } from '@/hooks/useRtcStats';
import type { DerivedStats } from '@/types/stats';

const CODE = `// Pull RTCStatsReport and parse it
const report = await pc.getStats();

report.forEach(stat => {
  switch (stat.type) {
    case 'inbound-rtp':
      // bytesReceived, packetsLost, jitter, frameWidth, framesPerSecond
      break;
    case 'outbound-rtp':
      // bytesSent, packetsSent, retransmittedBytes
      break;
    case 'candidate-pair':
      // state === 'succeeded' → currentRoundTripTime
      break;
    case 'codec':
      // mimeType, clockRate, channels
      break;
  }
});`;

export default function StatsDashboard() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const pcA = useRef<RTCPeerConnection | null>(null);
  const pcB = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { stats, history, start: startStats, stop: stopStats } = useRtcStats(1000);

  const handleConnect = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      if (localRef.current) localRef.current.srcObject = stream;

      const a = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      const b = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      pcA.current = a;
      pcB.current = b;

      a.onicecandidate = (ev) => ev.candidate && b.addIceCandidate(ev.candidate);
      b.onicecandidate = (ev) => ev.candidate && a.addIceCandidate(ev.candidate);

      stream.getTracks().forEach((t) => a.addTrack(t, stream));

      b.ontrack = (ev) => {
        const s = ev.streams[0] ?? new MediaStream([ev.track]);
        if (remoteRef.current) remoteRef.current.srcObject = s;
        setConnected(true);
        startStats(b);
        logger.success('Connected — stats polling started');
      };

      const offer = await a.createOffer();
      await a.setLocalDescription(offer);
      await b.setRemoteDescription(offer);
      const answer = await b.createAnswer();
      await b.setLocalDescription(answer);
      await a.setRemoteDescription(answer);
    } catch (e) {
      logger.error(`Failed: ${e}`);
    }
  };

  const handleDisconnect = () => {
    stopStats();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcA.current?.close();
    pcB.current?.close();
    setConnected(false);
  };

  const chartData = history.map((s) => ({
    timestamp: s.timestamp,
    bitrateIn: s.bitrateInKbps,
    bitrateOut: s.bitrateOutKbps,
    fps: s.framesPerSecond ?? 0,
    loss: s.packetLossPercent,
    rtt: s.currentRoundTripTime ? s.currentRoundTripTime * 1000 : 0,
  }));

  return (
    <DemoLayout
      title="Stats Dashboard"
      difficulty="intermediate"
      description="Live RTCStatsReport charts — bitrate, packet loss, jitter, RTT over time."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">pc.getStats()</code> returns
            a <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">RTCStatsReport</code> — a
            map of typed stat objects. Polling it every second gives you a timeline of connection
            health metrics.
          </p>
          <p>
            Key stat types: <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">inbound-rtp</code> (receive stats),
            <code className="mx-1 text-xs bg-surface-2 px-1 py-0.5 rounded">outbound-rtp</code> (send stats),
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">candidate-pair</code> (RTT), and
            <code className="ml-1 text-xs bg-surface-2 px-1 py-0.5 rounded">codec</code>.
          </p>
        </div>
      }
      demo={
        <div className="space-y-5">
          <div className="flex gap-2">
            {!connected ? (
              <button onClick={handleConnect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Start (loopback)
              </button>
            ) : (
              <button onClick={handleDisconnect} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                Stop
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
              <video ref={localRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
            </div>
            <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
              <video ref={remoteRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            </div>
          </div>

          <StatsPanel stats={stats} />

          {history.length > 2 && (
            <div className="space-y-3">
              <StatChart
                title="Bitrate (kbps)"
                data={chartData}
                series={[
                  { key: 'bitrateIn', label: 'In', color: '#34d399' },
                  { key: 'bitrateOut', label: 'Out', color: '#60a5fa' },
                ]}
                unit="k"
              />
              <div className="grid grid-cols-2 gap-3">
                <StatChart
                  title="FPS"
                  data={chartData}
                  series={[{ key: 'fps', label: 'FPS', color: '#a78bfa' }]}
                />
                <StatChart
                  title="RTT (ms)"
                  data={chartData}
                  series={[{ key: 'rtt', label: 'RTT', color: '#f472b6' }]}
                  unit="ms"
                />
              </div>
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Parsing RTCStatsReport' }}
      mdnLinks={[
        { label: 'getStats()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/getStats' },
        { label: 'RTCStatsReport', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCStatsReport' },
      ]}
    />
  );
}
