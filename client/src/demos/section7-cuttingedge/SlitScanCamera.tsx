import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';

const CODE = `// Slit-scan: accumulate one column (or row) from each video frame

function slitScanLoop(video, canvas, slitX) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  // Scroll existing canvas content left by 1 px
  const img = ctx.getImageData(1, 0, W - 1, H);
  ctx.putImageData(img, 0, 0);

  // Draw the current video frame to an offscreen canvas
  offCtx.drawImage(video, 0, 0, W, H);

  // Extract the slit column from the video
  const slitData = offCtx.getImageData(slitX, 0, 1, H);

  // Paste it as the rightmost column of our output
  ctx.putImageData(slitData, W - 1, 0);
}

requestAnimationFrame(slitScanLoop);`;

type SlitMode = 'vertical' | 'horizontal' | 'diagonal';

export default function SlitScanCamera() {
  const logger = useMemo(() => new Logger(), []);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<SlitMode>('vertical');
  const [slitPos, setSlitPos] = useState(50);  // percent
  const [speed, setSpeed] = useState(1);
  const videoRef = useRef<HTMLVideoElement>(null);
  const srcCanvasRef = useRef<HTMLCanvasElement>(null);
  const outCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const frameCountRef = useRef(0);
  const modeRef = useRef(mode);
  const slitRef = useRef(slitPos);
  modeRef.current = mode;
  slitRef.current = slitPos;

  const W = 480, H = 320;

  const loop = useCallback(() => {
    const video = videoRef.current;
    const src = srcCanvasRef.current;
    const out = outCanvasRef.current;
    if (!video || !src || !out || video.readyState < 2) { rafRef.current = requestAnimationFrame(loop); return; }

    frameCountRef.current++;
    const srcCtx = src.getContext('2d')!;
    const outCtx = out.getContext('2d')!;

    srcCtx.save();
    srcCtx.scale(-1, 1);
    srcCtx.drawImage(video, -W, 0, W, H);
    srcCtx.restore();

    const sp = modeRef.current === 'diagonal' ? (frameCountRef.current % W) : Math.floor(slitRef.current / 100 * (modeRef.current === 'vertical' ? W : H));

    if (modeRef.current === 'vertical') {
      // Shift canvas left
      const img = outCtx.getImageData(1, 0, W - 1, H);
      outCtx.putImageData(img, 0, 0);
      // Paste new column
      const col = srcCtx.getImageData(sp, 0, 1, H);
      outCtx.putImageData(col, W - 1, 0);
    } else if (modeRef.current === 'horizontal') {
      // Shift canvas up
      const img = outCtx.getImageData(0, 1, W, H - 1);
      outCtx.putImageData(img, 0, 0);
      // Paste new row
      const row = srcCtx.getImageData(0, sp, W, 1);
      outCtx.putImageData(row, 0, H - 1);
    } else {
      // Diagonal: shift diagonally and paste column
      const img = outCtx.getImageData(1, 1, W - 1, H - 1);
      outCtx.putImageData(img, 0, 0);
      const col = srcCtx.getImageData(sp, 0, 1, H);
      outCtx.putImageData(col, W - 1, 0);
    }

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const start = async () => {
    try {
      logger.info('Requesting camera...');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: W, height: H, facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      const outCtx = outCanvasRef.current!.getContext('2d')!;
      outCtx.fillStyle = '#000';
      outCtx.fillRect(0, 0, W, H);
      setRunning(true);
      rafRef.current = requestAnimationFrame(loop);
      logger.success('Slit-scan active — move slowly for best results!');
    } catch (e) { logger.error(`Camera error: ${e}`); }
  };

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setRunning(false);
    logger.info('Stopped');
  };

  useEffect(() => () => stop(), []);

  return (
    <DemoLayout
      title="Slit-Scan Camera"
      difficulty="intermediate"
      description="A psychedelic slit-scan effect — each video frame contributes one column of pixels, creating temporal distortions."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>Slit-scan photography</strong> was famously used for the stargate sequence in
            2001: A Space Odyssey. Instead of capturing the full frame at once, only a thin
            slice (one column or row of pixels) is sampled from each frame. As frames accumulate,
            motion creates surreal smear and distortion effects.
          </p>
          <p>
            The implementation uses <strong>Canvas 2D's ImageData API</strong>: each animation
            frame scrolls the output canvas by one pixel (<code className="text-xs bg-surface-2 px-1 py-0.5 rounded">getImageData → putImageData</code>)
            and pastes the new column from the live video frame. Moving fast creates wild patterns;
            holding still produces smooth gradients.
          </p>
          <p>
            The same canvas output could be captured via{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">captureStream()</code> and
            streamed over WebRTC — giving your peer a live slit-scan video feed!
          </p>
        </div>
      }
      hints={[
        'Move your face slowly from left to right for a classic time-stretch',
        'Raise your hand and move it — watch it smear across the canvas',
        'Try Horizontal mode and tilt your head for vertical stretching',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!running ? (
              <button onClick={start} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Start Camera
              </button>
            ) : (
              <button onClick={stop} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg">Stop</button>
            )}
            <div className="flex gap-1">
              {(['vertical','horizontal','diagonal'] as const).map(m => (
                <button key={m} onClick={() => setMode(m)}
                  className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${mode === m ? 'border-blue-500 bg-blue-950/40 text-blue-300' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}>
                  {m}
                </button>
              ))}
            </div>
            {mode !== 'diagonal' && (
              <label className="flex items-center gap-2 text-xs text-zinc-400">
                Slit pos:
                <input type="range" min={5} max={95} value={slitPos} onChange={e => setSlitPos(Number(e.target.value))} className="w-24 accent-blue-500" />
                <span className="font-mono w-8">{slitPos}%</span>
              </label>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Live Camera {mode !== 'diagonal' && `(slit at ${slitPos}%)`}</p>
              <div className="relative">
                <video ref={videoRef} muted playsInline width={W} height={H} className="rounded-xl border border-zinc-800 w-full block" style={{transform:'scaleX(-1)'}} />
                <canvas ref={srcCanvasRef} width={W} height={H} className="hidden" />
                {/* Slit indicator */}
                {running && mode === 'vertical' && (
                  <div className="absolute top-0 bottom-0 w-0.5 bg-red-500/70 pointer-events-none" style={{ left: `${slitPos}%` }} />
                )}
                {running && mode === 'horizontal' && (
                  <div className="absolute left-0 right-0 h-0.5 bg-red-500/70 pointer-events-none" style={{ top: `${slitPos}%` }} />
                )}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Slit-Scan Output</p>
              <canvas ref={outCanvasRef} width={W} height={H}
                className="rounded-xl border border-zinc-800 w-full block"
                style={{ background: '#000' }} />
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Slit-scan temporal distortion via ImageData' }}
      mdnLinks={[
        { label: 'CanvasRenderingContext2D.getImageData()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData' },
        { label: 'HTMLCanvasElement.captureStream()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream' },
      ]}
    />
  );
}
