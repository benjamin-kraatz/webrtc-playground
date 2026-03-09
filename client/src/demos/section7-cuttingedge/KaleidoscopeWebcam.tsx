import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';

const CODE = `// Draw a kaleidoscope by mirroring/rotating wedges of a video frame
function drawKaleidoscope(video, canvas, slices) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;
  const radius = Math.min(cx, cy);
  const angle = (Math.PI * 2) / slices;

  // Offscreen canvas to grab one wedge
  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  src.getContext('2d').drawImage(video, 0, 0, W, H);

  ctx.clearRect(0, 0, W, H);

  for (let i = 0; i < slices; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle * i);

    // Clip to a pie wedge
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, -angle / 2, angle / 2);
    ctx.closePath();
    ctx.clip();

    // Mirror every other slice for symmetry
    if (i % 2 === 1) ctx.scale(-1, 1);

    ctx.rotate(-angle / 2);
    ctx.drawImage(src, -cx, -cy);
    ctx.restore();
  }
}`;

export default function KaleidoscopeWebcam() {
  const logger = useMemo(() => new Logger(), []);
  const [running, setRunning] = useState(false);
  const [slices, setSlices] = useState(8);
  const [spin, setSpin] = useState(false);
  const [hue, setHue] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const srcCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const spinAngleRef = useRef(0);

  const W = 512, H = 512;

  const renderFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const src = srcCanvasRef.current;
    if (!video || !canvas || !src || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(renderFrame);
      return;
    }

    const ctx = canvas.getContext('2d')!;
    const srcCtx = src.getContext('2d')!;
    srcCtx.drawImage(video, 0, 0, W, H);

    const cx = W / 2, cy = H / 2;
    const radius = Math.min(cx, cy);
    const sliceAngle = (Math.PI * 2) / slices;

    if (spin) spinAngleRef.current += 0.005;

    ctx.clearRect(0, 0, W, H);

    for (let i = 0; i < slices; i++) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(sliceAngle * i + spinAngleRef.current);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, -sliceAngle / 2, sliceAngle / 2);
      ctx.closePath();
      ctx.clip();

      if (i % 2 === 1) ctx.scale(-1, 1);
      ctx.rotate(-sliceAngle / 2);
      ctx.drawImage(src, -cx, -cy);
      ctx.restore();
    }

    if (hue !== 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'hue';
      ctx.fillStyle = `hsl(${hue}, 100%, 50%)`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    rafRef.current = requestAnimationFrame(renderFrame);
  }, [slices, spin, hue]);

  const start = async () => {
    try {
      logger.info('Requesting camera...');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: W, height: H, facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setRunning(true);
      rafRef.current = requestAnimationFrame(renderFrame);
      logger.success('Kaleidoscope active! ✨');
    } catch (e) {
      logger.error(`Camera error: ${e}`);
    }
  };

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setRunning(false);
    logger.info('Stopped');
  };

  useEffect(() => {
    if (running) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(renderFrame);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [running, renderFrame]);

  useEffect(() => () => stop(), []);

  return (
    <DemoLayout
      title="Kaleidoscope Webcam"
      difficulty="intermediate"
      description="Transform your live webcam into a mesmerizing kaleidoscope using Canvas 2D transforms."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            A kaleidoscope is created by taking a <em>wedge</em> of the source image and stamping it
            repeatedly around a center point, mirroring every other slice for bilateral symmetry.
            The Canvas 2D API makes this straightforward: <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">ctx.rotate()</code>,{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">ctx.clip()</code>, and{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">ctx.scale(-1, 1)</code> for the mirror.
          </p>
          <p>
            The output canvas can be captured as a MediaStream with{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">canvas.captureStream()</code> and streamed
            over WebRTC — so you could broadcast your kaleidoscope live to other peers!
          </p>
        </div>
      }
      hints={[
        'Try 6 slices for a classic snowflake pattern',
        'Enable Spin for a hypnotic rotating effect',
        'Move slowly in front of the camera for the best visual',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!running ? (
              <button onClick={start} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Start Camera
              </button>
            ) : (
              <button onClick={stop} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg">
                Stop
              </button>
            )}
          </div>

          {/* Controls */}
          <div className="flex flex-wrap gap-4 items-center text-xs text-zinc-400">
            <label className="flex items-center gap-2 select-none">
              Slices:
              <input type="range" min={2} max={24} step={2} value={slices}
                onChange={(e) => setSlices(Number(e.target.value))}
                className="w-24 accent-violet-500" />
              <span className="font-mono w-4">{slices}</span>
            </label>
            <label className="flex items-center gap-2 select-none cursor-pointer">
              <input type="checkbox" checked={spin} onChange={(e) => setSpin(e.target.checked)} className="accent-violet-500" />
              Spin
            </label>
            <label className="flex items-center gap-2 select-none">
              Hue:
              <input type="range" min={0} max={360} value={hue}
                onChange={(e) => setHue(Number(e.target.value))}
                className="w-20 accent-violet-500" />
            </label>
          </div>

          {/* Hidden elements */}
          <video ref={videoRef} muted playsInline className="hidden" />
          <canvas ref={srcCanvasRef} width={W} height={H} className="hidden" />

          {/* Output canvas */}
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className="rounded-2xl border border-zinc-800 w-full max-w-lg mx-auto block"
            style={{ background: '#09090b' }}
          />
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Kaleidoscope via Canvas 2D clip + rotate' }}
      mdnLinks={[
        { label: 'CanvasRenderingContext2D.clip()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/clip' },
        { label: 'HTMLCanvasElement.captureStream()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream' },
      ]}
    />
  );
}
