import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const CODE = `// Connect audio through WebRTC, then analyze on the other side
const audioCtx = new AudioContext();
const source = audioCtx.createMediaStreamSource(remoteStream);
const analyser = audioCtx.createAnalyser();
analyser.fftSize = 2048;
source.connect(analyser);
// NOTE: do NOT connect to destination (would create echo)

// Draw waveform
const draw = () => {
  const data = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(data); // waveform
  // or: analyser.getByteFrequencyData(data); // spectrum
  requestAnimationFrame(draw);
};
draw();`;

export default function AudioVisualizer() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<'waveform' | 'spectrum'>('waveform');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const pcA = useRef<RTCPeerConnection | null>(null);
  const pcB = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const draw = () => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;

    if (mode === 'waveform') {
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(data);
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const step = W / data.length;
      data.forEach((v, i) => {
        const x = i * step;
        const y = (v / 255) * H;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
    } else {
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, W, H);
      const barW = W / data.length;
      data.forEach((v, i) => {
        const h = (v / 255) * H;
        const hue = (i / data.length) * 240;
        ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
        ctx.fillRect(i * barW, H - h, barW - 1, h);
      });
    }

    animRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    if (connected) {
      cancelAnimationFrame(animRef.current);
      animRef.current = requestAnimationFrame(draw);
    }
    return () => cancelAnimationFrame(animRef.current);
  }, [connected, mode]);

  const handleConnect = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      logger.success('Mic acquired');

      const a = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      const b = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      pcA.current = a;
      pcB.current = b;

      a.onicecandidate = (ev) => ev.candidate && b.addIceCandidate(ev.candidate);
      b.onicecandidate = (ev) => ev.candidate && a.addIceCandidate(ev.candidate);

      stream.getAudioTracks().forEach((t) => a.addTrack(t, stream));

      b.ontrack = (ev) => {
        const audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(ev.streams[0] ?? new MediaStream([ev.track]));
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        // Do NOT connect to destination — would create echo!
        analyserRef.current = analyser;
        setConnected(true);
        logger.success('Analyser connected — speak into your mic!');
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
    cancelAnimationFrame(animRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcA.current?.close();
    pcB.current?.close();
    setConnected(false);
    analyserRef.current = null;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    logger.info('Disconnected');
  };

  return (
    <DemoLayout
      title="Audio Visualizer"
      difficulty="intermediate"
      description="Visualize audio waveforms and frequency spectra through a WebRTC loopback."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            The <strong>Web Audio API</strong>'s <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">AnalyserNode</code> lets
            you extract real-time frequency and waveform data from any audio stream — including the
            remote audio track from a WebRTC peer connection.
          </p>
          <p>
            The key is to connect the audio to the analyser but <em>not</em> to the audio destination —
            otherwise you'd create a feedback loop.
          </p>
        </div>
      }
      demo={
        <div className="space-y-4">
          <div className="flex gap-2">
            {!connected ? (
              <button onClick={handleConnect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Connect Mic
              </button>
            ) : (
              <button onClick={handleDisconnect} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                Disconnect
              </button>
            )}
            <button onClick={() => setMode('waveform')} className={`px-3 py-2 text-sm rounded-lg ${mode === 'waveform' ? 'bg-surface-2 text-zinc-100' : 'text-zinc-500'}`}>
              Waveform
            </button>
            <button onClick={() => setMode('spectrum')} className={`px-3 py-2 text-sm rounded-lg ${mode === 'spectrum' ? 'bg-surface-2 text-zinc-100' : 'text-zinc-500'}`}>
              Spectrum
            </button>
          </div>

          <canvas ref={canvasRef} width={800} height={200}
            className="w-full rounded-xl border border-zinc-800 bg-surface-0" />

          {connected && (
            <p className="text-xs text-zinc-500">Speak into your microphone to see the visualization</p>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Web Audio API with WebRTC' }}
      mdnLinks={[
        { label: 'AnalyserNode', href: 'https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode' },
        { label: 'Web Audio API', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API' },
      ]}
    />
  );
}
