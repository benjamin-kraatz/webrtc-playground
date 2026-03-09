import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';

const CODE = `// Frame differencing motion detection
function detectMotion(prevData, currData, threshold = 30) {
  let changedPixels = 0;
  const total = currData.length / 4;

  for (let i = 0; i < currData.length; i += 4) {
    const dr = Math.abs(currData[i]   - prevData[i]);
    const dg = Math.abs(currData[i+1] - prevData[i+1]);
    const db = Math.abs(currData[i+2] - prevData[i+2]);
    if (dr + dg + db > threshold) {
      changedPixels++;
      // Tint the changed pixel red in the overlay
      overlay[i]   = 255; // R
      overlay[i+1] = 0;   // G
      overlay[i+2] = 0;   // B
      overlay[i+3] = 160; // A
    }
  }
  return changedPixels / total; // 0.0 → 1.0
}`;

export default function MotionDetector() {
  const logger = useMemo(() => new Logger(), []);
  const [running, setRunning] = useState(false);
  const [motionLevel, setMotionLevel] = useState(0);
  const [threshold, setThreshold] = useState(30);
  const [alarmCount, setAlarmCount] = useState(0);
  const [alarmActive, setAlarmActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const prevFrameRef = useRef<ImageData | null>(null);
  const alarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const W = 320, H = 240;

  const processFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    if (!video || !canvas || !overlay || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(processFrame);
      return;
    }

    const ctx = canvas.getContext('2d')!;
    const ovCtx = overlay.getContext('2d')!;
    ctx.drawImage(video, 0, 0, W, H);
    const currFrame = ctx.getImageData(0, 0, W, H);

    if (prevFrameRef.current) {
      const prev = prevFrameRef.current.data;
      const curr = currFrame.data;
      const overlayData = ovCtx.createImageData(W, H);
      const od = overlayData.data;

      let changed = 0;
      for (let i = 0; i < curr.length; i += 4) {
        const diff = Math.abs(curr[i] - prev[i]) + Math.abs(curr[i + 1] - prev[i + 1]) + Math.abs(curr[i + 2] - prev[i + 2]);
        if (diff > threshold) {
          changed++;
          od[i] = 255; od[i + 1] = 50; od[i + 2] = 50; od[i + 3] = 180;
        }
      }

      ovCtx.putImageData(overlayData, 0, 0);
      const level = changed / (W * H);
      setMotionLevel(level);

      if (level > 0.05) {
        setAlarmActive(true);
        setAlarmCount((c) => c + 1);
        if (alarmTimerRef.current) clearTimeout(alarmTimerRef.current);
        alarmTimerRef.current = setTimeout(() => setAlarmActive(false), 800);
        logger.warn(`Motion detected! ${(level * 100).toFixed(1)}% pixels changed`);
      }
    }

    prevFrameRef.current = currFrame;
    rafRef.current = requestAnimationFrame(processFrame);
  };

  const start = async () => {
    try {
      logger.info('Requesting camera...');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: W, height: H }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setRunning(true);
      prevFrameRef.current = null;
      rafRef.current = requestAnimationFrame(processFrame);
      logger.success('Motion detector active — move in front of the camera!');
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
    setMotionLevel(0);
    setAlarmActive(false);
    if (overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')!;
      ctx.clearRect(0, 0, W, H);
    }
    logger.info('Stopped');
  };

  useEffect(() => () => { stop(); }, []);

  const barColor = motionLevel > 0.15 ? 'bg-rose-500' : motionLevel > 0.05 ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <DemoLayout
      title="Motion Detector"
      difficulty="intermediate"
      description="Detect movement in your webcam feed by comparing frames with canvas pixel differencing."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>Frame differencing</strong> is the simplest form of motion detection: compare
            each pixel in the current frame to the same pixel in the previous frame. If the
            combined RGB difference exceeds a <em>threshold</em>, the pixel is flagged as
            "changed" and highlighted in the overlay.
          </p>
          <p>
            The <em>motion level</em> is the fraction of changed pixels (0 – 100%). Values above
            5% trigger an alarm. Adjust the <strong>sensitivity</strong> slider: lower values catch
            subtle motion; higher values only trigger on large movements.
          </p>
          <p>
            This technique is used in security cameras and video compression (only encode changed
            regions). In a WebRTC context, you could use it to pause sending video when nothing
            is moving, saving bandwidth.
          </p>
        </div>
      }
      hints={[
        'Wave your hand or walk past the camera to trigger the alarm',
        'Lower the threshold slider for maximum sensitivity',
        'The red overlay marks every changed pixel since the previous frame',
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
            <label className="flex items-center gap-2 text-xs text-zinc-400 select-none">
              <span>Sensitivity:</span>
              <input type="range" min={5} max={100} value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-28 accent-blue-500" />
              <span className="font-mono w-6">{threshold}</span>
            </label>
          </div>

          {/* Motion level bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-zinc-500">
              <span>Motion Level</span>
              <span className={alarmActive ? 'text-rose-400 font-bold animate-pulse' : 'text-zinc-400'}>
                {alarmActive ? '🚨 MOTION!' : `${(motionLevel * 100).toFixed(1)}%`}
              </span>
            </div>
            <div className="h-3 bg-surface-0 border border-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-100 ${barColor}`}
                style={{ width: `${Math.min(100, motionLevel * 400)}%` }}
              />
            </div>
          </div>

          {/* Video + overlay */}
          <div className="relative inline-block rounded-xl overflow-hidden border border-zinc-800" style={{ width: W, maxWidth: '100%' }}>
            <video ref={videoRef} muted playsInline width={W} height={H} className="block" />
            <canvas ref={overlayRef} width={W} height={H} className="absolute inset-0 pointer-events-none" />
            <canvas ref={canvasRef} width={W} height={H} className="hidden" />
          </div>

          <div className="text-xs text-zinc-500">
            Alarm count: <span className="text-zinc-300 font-mono">{alarmCount}</span>
            <span className="ml-4">Threshold: pixel Δ &gt; {threshold}</span>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Frame differencing motion detection' }}
      mdnLinks={[
        { label: 'CanvasRenderingContext2D.getImageData()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData' },
        { label: 'getUserMedia()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia' },
      ]}
    />
  );
}
