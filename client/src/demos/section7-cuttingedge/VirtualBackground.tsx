import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Logger } from '@/lib/logger';

const CODE = `// TensorFlow.js body segmentation
import * as bodySegmentation from '@tensorflow-models/body-segmentation';

const model = await bodySegmentation.createSegmenter(
  bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,
  { runtime: 'tfjs', modelType: 'general' }
);

// Run segmentation on each frame
const segmentation = await model.segmentPeople(videoElement);
const mask = await bodySegmentation.toBinaryMask(segmentation);

// Draw person on canvas with blurred background
ctx.filter = 'blur(15px)';
ctx.drawImage(videoElement, 0, 0); // blurred background
ctx.filter = 'none';
ctx.putImageData(mask, 0, 0);     // person cutout`;

type BgMode = 'blur' | 'solid' | 'none';

export default function VirtualBackground() {
  const logger = useMemo(() => new Logger(), []);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [active, setActive] = useState(false);
  const [bgMode, setBgMode] = useState<BgMode>('blur');
  const [bgColor, setBgColor] = useState('#1e1b4b');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const animRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const modelRef = useRef<unknown>(null);
  const bgModeRef = useRef<BgMode>('blur');
  const bgColorRef = useRef('#1e1b4b');

  useEffect(() => { bgModeRef.current = bgMode; }, [bgMode]);
  useEffect(() => { bgColorRef.current = bgColor; }, [bgColor]);

  const handleStart = async () => {
    setLoading(true);
    setLoadProgress(10);
    try {
      logger.info('Loading TensorFlow.js body segmentation model (~15MB)...');
      const [bodySegmentation, tf] = await Promise.all([
        import('@tensorflow-models/body-segmentation'),
        import('@tensorflow/tfjs'),
      ]);
      setLoadProgress(60);
      await (tf as unknown as { ready: () => Promise<void> }).ready();
      setLoadProgress(80);

      const model = await (bodySegmentation as {
        createSegmenter: (model: string, opts: object) => Promise<unknown>;
        SupportedModels: { MediaPipeSelfieSegmentation: string };
      }).createSegmenter(
        bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation,
        { runtime: 'tfjs', modelType: 'general' }
      );
      modelRef.current = model;
      setLoadProgress(100);
      logger.success('Model loaded!');

      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      const canvas = canvasRef.current!;
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext('2d')!;

      const segModel = model as { segmentPeople: (el: HTMLVideoElement) => Promise<unknown[]> };
      const bsModule = bodySegmentation as { toBinaryMask: (segs: unknown[]) => Promise<ImageData> };

      const render = async () => {
        if (!modelRef.current) return;
        try {
          const segmentations = await segModel.segmentPeople(video);
          const mask = await bsModule.toBinaryMask(segmentations);

          // Draw background
          if (bgModeRef.current === 'blur') {
            ctx.filter = 'blur(15px)';
            ctx.drawImage(video, 0, 0, 640, 480);
            ctx.filter = 'none';
          } else if (bgModeRef.current === 'solid') {
            ctx.fillStyle = bgColorRef.current;
            ctx.fillRect(0, 0, 640, 480);
          } else {
            ctx.clearRect(0, 0, 640, 480);
          }

          // Apply person mask
          const temp = document.createElement('canvas');
          temp.width = 640;
          temp.height = 480;
          const tctx = temp.getContext('2d')!;
          tctx.putImageData(mask, 0, 0);
          tctx.globalCompositeOperation = 'source-in';
          tctx.drawImage(video, 0, 0, 640, 480);

          ctx.drawImage(temp, 0, 0);
        } catch {
          // might fail on first frame
        }
        animRef.current = requestAnimationFrame(() => { render().catch(console.error); });
      };

      render().catch(console.error);
      setActive(true);
      logger.success('Virtual background active!');
    } catch (e) {
      logger.error(`Failed: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = () => {
    cancelAnimationFrame(animRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    modelRef.current = null;
    setActive(false);
    setLoadProgress(0);
  };

  useEffect(() => () => { cancelAnimationFrame(animRef.current); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  return (
    <DemoLayout
      title="Virtual Background (ML)"
      difficulty="advanced"
      description="Replace or blur your background using TensorFlow.js body segmentation."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Uses <strong>MediaPipe Selfie Segmentation</strong> via TensorFlow.js to separate the person
            from the background in real time. The segmentation mask is applied on a canvas, which can
            then be streamed via WebRTC.
          </p>
          <p className="text-amber-400/80">
            ⚡ The model is ~15MB and requires a moment to download and initialize. Processing runs
            entirely in the browser — no data is sent to any server.
          </p>
        </div>
      }
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            {!active && !loading && (
              <button onClick={handleStart} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Load Model & Start
              </button>
            )}
            {active && (
              <button onClick={handleStop} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                Stop
              </button>
            )}
          </div>

          {loading && <ProgressBar value={loadProgress} label="Loading TensorFlow.js model..." />}

          {active && (
            <div className="flex gap-3 flex-wrap">
              {(['blur', 'solid', 'none'] as BgMode[]).map((m) => (
                <button key={m} onClick={() => setBgMode(m)}
                  className={`px-3 py-1.5 text-sm rounded-lg ${bgMode === m ? 'bg-blue-600 text-white' : 'bg-surface-2 text-zinc-300'}`}>
                  {m === 'blur' ? '🌫 Blur' : m === 'solid' ? '🎨 Color' : '🔲 Remove'}
                </button>
              ))}
              {bgMode === 'solid' && (
                <input type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)}
                  className="w-10 h-9 rounded cursor-pointer" />
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Original</p>
              <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">With virtual background</p>
              <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
                <canvas ref={canvasRef} className="w-full h-full object-cover scale-x-[-1]" />
              </div>
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Body segmentation + canvas compositing' }}
      mdnLinks={[
        { label: 'TensorFlow.js', href: 'https://www.tensorflow.org/js' },
        { label: 'MediaPipe Selfie Segmentation', href: 'https://github.com/tensorflow/tfjs-models/tree/master/body-segmentation' },
      ]}
    />
  );
}
