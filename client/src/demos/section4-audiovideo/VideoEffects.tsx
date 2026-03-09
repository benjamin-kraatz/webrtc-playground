import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const CODE = `// Canvas pipeline: camera → effect → WebRTC
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');

// Apply effect in requestAnimationFrame loop
function drawFrame() {
  ctx.drawImage(videoElement, 0, 0);

  // Get pixel data, modify it
  const imageData = ctx.getImageData(0, 0, W, H);
  applyGrayscale(imageData); // or blur, edge, etc.
  ctx.putImageData(imageData, 0, 0);

  requestAnimationFrame(drawFrame);
}

// Capture canvas as a MediaStream
const canvasStream = canvas.captureStream(30); // 30fps
pc.addTrack(canvasStream.getVideoTracks()[0], canvasStream);`;

type Effect = 'none' | 'grayscale' | 'blur' | 'edge' | 'invert' | 'sepia';

const EFFECTS: { id: Effect; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'grayscale', label: 'Grayscale' },
  { id: 'blur', label: 'Blur' },
  { id: 'edge', label: 'Edge Detect' },
  { id: 'invert', label: 'Invert' },
  { id: 'sepia', label: 'Sepia' },
];

function applyEffect(ctx: CanvasRenderingContext2D, effect: Effect, W: number, H: number) {
  if (effect === 'none') return;
  if (effect === 'blur') { ctx.filter = 'blur(4px)'; return; }
  if (effect === 'sepia') { ctx.filter = 'sepia(1)'; return; }

  const imgData = ctx.getImageData(0, 0, W, H);
  const d = imgData.data;

  if (effect === 'grayscale') {
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      d[i] = d[i + 1] = d[i + 2] = g;
    }
  } else if (effect === 'invert') {
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2];
    }
  } else if (effect === 'edge') {
    const src = new Uint8ClampedArray(d);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = (y * W + x) * 4;
        const il = (y * W + (x - 1)) * 4;
        const ir = (y * W + (x + 1)) * 4;
        const iu = ((y - 1) * W + x) * 4;
        const id2 = ((y + 1) * W + x) * 4;
        const gx = -src[il] + src[ir];
        const gy = -src[iu] + src[id2];
        const mag = Math.min(255, Math.sqrt(gx * gx + gy * gy));
        d[i] = d[i + 1] = d[i + 2] = mag;
      }
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

export default function VideoEffects() {
  const logger = useMemo(() => new Logger(), []);
  const [effect, setEffect] = useState<Effect>('none');
  const [connected, setConnected] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const effectRef = useRef<Effect>('none');
  const pcA = useRef<RTCPeerConnection | null>(null);
  const pcB = useRef<RTCPeerConnection | null>(null);

  useEffect(() => { effectRef.current = effect; }, [effect]);

  const handleConnect = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      streamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const canvas = canvasRef.current!;
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d')!;
      const srcVideo = localVideoRef.current!;

      const drawLoop = () => {
        if (srcVideo.readyState >= 2) {
          ctx.filter = 'none';
          ctx.drawImage(srcVideo, 0, 0, 640, 480);
          applyEffect(ctx, effectRef.current, 640, 480);
        }
        animRef.current = requestAnimationFrame(drawLoop);
      };
      drawLoop();

      const canvasStream = canvas.captureStream(30);

      const a = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      const b = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      pcA.current = a;
      pcB.current = b;

      a.onicecandidate = (ev) => ev.candidate && b.addIceCandidate(ev.candidate);
      b.onicecandidate = (ev) => ev.candidate && a.addIceCandidate(ev.candidate);

      canvasStream.getVideoTracks().forEach((t) => a.addTrack(t, canvasStream));

      b.ontrack = (ev) => {
        const s = ev.streams[0] ?? new MediaStream([ev.track]);
        if (remoteVideoRef.current) remoteVideoRef.current.srcObject = s;
        setConnected(true);
        logger.success('Remote track received — effects applied!');
      };

      const offer = await a.createOffer();
      await a.setLocalDescription(offer);
      await b.setRemoteDescription(offer);
      const answer = await b.createAnswer();
      await b.setLocalDescription(answer);
      await a.setRemoteDescription(answer);
      logger.success('Loopback connected');
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
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  };

  return (
    <DemoLayout
      title="Video Effects"
      difficulty="intermediate"
      description="Apply grayscale, blur, and edge detection to video via Canvas pipeline."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            The trick: instead of sending the raw camera stream, we draw each frame onto a
            <code className="mx-1 text-xs bg-surface-2 px-1 py-0.5 rounded">{'<canvas>'}</code>,
            apply pixel-level effects, then use
            <code className="ml-1 text-xs bg-surface-2 px-1 py-0.5 rounded">canvas.captureStream()</code>
            to get a <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">MediaStream</code> from the canvas.
          </p>
          <p>
            That processed stream is sent over WebRTC. The remote peer receives an already-processed
            video — the CPU work happens before encoding.
          </p>
        </div>
      }
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {EFFECTS.map((e) => (
              <button
                key={e.id}
                onClick={() => setEffect(e.id)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  effect === e.id ? 'bg-blue-600 text-white' : 'bg-surface-2 text-zinc-300 hover:bg-surface-3'
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            {!connected ? (
              <button onClick={handleConnect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Start Camera
              </button>
            ) : (
              <button onClick={handleDisconnect} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                Stop
              </button>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Camera (raw)</p>
              <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
                <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Canvas (effect applied)</p>
              <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
                <canvas ref={canvasRef} className="w-full h-full object-cover scale-x-[-1]" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Via WebRTC (received)</p>
              <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
                <video ref={remoteVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              </div>
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Canvas → captureStream → WebRTC pipeline' }}
      mdnLinks={[
        { label: 'captureStream()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream' },
      ]}
    />
  );
}
