import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { useRtcStats } from '@/hooks/useRtcStats';
import { StatsPanel } from '@/components/ui/StatsPanel';

const CODE = `// Limit bitrate via RTCRtpSender.setParameters()
const sender = pc.getSenders().find(s => s.track?.kind === 'video');
const params = sender.getParameters();

// Set max bitrate on all encodings
params.encodings[0].maxBitrate = 250_000; // 250kbps
await sender.setParameters(params);

// ⚠ Firefox has limited setParameters() support
// Feature-detect before use:
if (typeof sender.setParameters === 'function') { ... }`;

const PRESETS = [
  { label: 'Uncapped', bps: 0 },
  { label: '2 Mbps', bps: 2_000_000 },
  { label: '500 kbps', bps: 500_000 },
  { label: '128 kbps', bps: 128_000 },
  { label: '64 kbps', bps: 64_000 },
];

export default function BandwidthQuality() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [bitrateCap, setBitrateCap] = useState(0);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const senderRef = useRef<RTCRtpSender | null>(null);
  const pcA = useRef<RTCPeerConnection | null>(null);
  const pcB = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const { stats, start: startStats, stop: stopStats } = useRtcStats(1000);

  const handleConnect = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: false });
      streamRef.current = stream;
      if (localRef.current) localRef.current.srcObject = stream;

      const a = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      const b = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      pcA.current = a;
      pcB.current = b;

      a.onicecandidate = (ev) => ev.candidate && b.addIceCandidate(ev.candidate);
      b.onicecandidate = (ev) => ev.candidate && a.addIceCandidate(ev.candidate);

      stream.getTracks().forEach((t) => {
        const sender = a.addTrack(t, stream);
        if (t.kind === 'video') senderRef.current = sender;
      });

      b.ontrack = (ev) => {
        const s = ev.streams[0] ?? new MediaStream([ev.track]);
        if (remoteRef.current) remoteRef.current.srcObject = s;
        setConnected(true);
        startStats(b);
        logger.success('Connected — try different bitrate presets');
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

  const applyBitrate = async (bps: number) => {
    const sender = senderRef.current;
    if (!sender) return;
    setBitrateCap(bps);
    const params = sender.getParameters();
    if (!params.encodings.length) params.encodings = [{}];
    params.encodings[0].maxBitrate = bps > 0 ? bps : undefined;
    try {
      await sender.setParameters(params);
      logger.success(bps > 0 ? `Bitrate capped at ${bps / 1000}kbps` : 'Bitrate uncapped');
    } catch (e) {
      logger.error(`setParameters failed: ${e}`);
    }
  };

  const handleDisconnect = () => {
    stopStats();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcA.current?.close();
    pcB.current?.close();
    setConnected(false);
    if (localRef.current) localRef.current.srcObject = null;
    if (remoteRef.current) remoteRef.current.srcObject = null;
  };

  return (
    <DemoLayout
      title="Bandwidth & Quality"
      difficulty="intermediate"
      description="Control bitrate constraints and see quality impact in a loopback call."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">RTCRtpSender.setParameters()</code> lets
            you impose a maximum bitrate on a video track mid-call — no renegotiation needed.
          </p>
          <p>
            Lower bitrate = lower quality + smaller file sizes. The encoder adapts resolution,
            framerate, and quantization to fit within the budget. Try the presets to see the
            visible quality difference.
          </p>
          <p className="text-amber-400/80">⚡ Firefox has limited setParameters() support. Feature-detect before use in production.</p>
        </div>
      }
      demo={
        <div className="space-y-5">
          <div className="flex gap-2">
            {!connected ? (
              <button onClick={handleConnect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Start
              </button>
            ) : (
              <button onClick={handleDisconnect} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                Stop
              </button>
            )}
          </div>

          {connected && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-2">BITRATE PRESETS</p>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => applyBitrate(p.bps)}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                      bitrateCap === p.bps ? 'bg-blue-600 text-white' : 'bg-surface-2 text-zinc-300 hover:bg-surface-3'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Local (camera)</p>
              <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
                <video ref={localRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Remote (bitrate limited)</p>
              <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
                <video ref={remoteRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              </div>
            </div>
          </div>

          {stats && <StatsPanel stats={stats} />}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'RTCRtpSender.setParameters()' }}
      mdnLinks={[
        { label: 'setParameters()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpSender/setParameters' },
      ]}
    />
  );
}
