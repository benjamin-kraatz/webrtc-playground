import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Logger } from '@/lib/logger';

/** Capture and processing resolution (width × height) for the camera feed.
 *  Used for getUserMedia constraints, video/canvas dimensions, and segmentation.
 *  Lower values improve performance; higher values improve detail. 640×480 is a
 *  good balance for real-time ML in the browser. */
const FRAME_WIDTH = 640;
const FRAME_HEIGHT = 480;

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

const MODES = [
  { id: 'blur', label: '🌫 Blur' },
  { id: 'solid', label: '🎨 Solid' },
  { id: 'gradient', label: '🌈 Gradient' },
  { id: 'none', label: '🔲 Remove' },
  { id: 'pixelate', label: '🧱 Pixelate' },
  { id: 'greyscale', label: '⚪ Greyscale' },
  { id: 'invert', label: '🔄 Invert' },
  { id: 'posterize', label: '🎭 Posterize' },
  { id: 'vignette', label: '⭕ Vignette' },
] as const;

type BgMode = (typeof MODES)[number]['id'];

const DEFAULT_PARAMS = {
  blurAmount: 15,
  bgColor: '#1e1b4b',
  bgColor2: '#4c1d95',
  gradientAngle: 135,
  pixelSize: 12,
  posterizeLevel: 4,
  vignetteStrength: 0.8,
  maskThreshold: 0.5,
};

export default function VirtualBackground() {
  const logger = useMemo(() => new Logger(), []);
  const [loading, setLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [active, setActive] = useState(false);
  const [bgMode, setBgMode] = useState<BgMode>('blur');
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const animRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const modelRef = useRef<unknown>(null);
  const bgModeRef = useRef<BgMode>('blur');
  const paramsRef = useRef(DEFAULT_PARAMS);

  useEffect(() => { bgModeRef.current = bgMode; }, [bgMode]);
  useEffect(() => { paramsRef.current = params; }, [params]);

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

      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: FRAME_WIDTH, height: FRAME_HEIGHT } });
      streamRef.current = stream;
      const video = videoRef.current!;
      video.width = FRAME_WIDTH;
      video.height = FRAME_HEIGHT;
      video.srcObject = stream;
      await video.play();

      // Wait for video to have decoded frames before running segmentation
      await new Promise<void>((resolve) => {
        if (video.readyState >= 2) {
          resolve();
          return;
        }
        video.addEventListener('loadeddata', () => resolve(), { once: true });
      });

      const canvas = canvasRef.current!;
      canvas.width = FRAME_WIDTH;
      canvas.height = FRAME_HEIGHT;
      const ctx = canvas.getContext('2d')!;

      const segModel = model as { segmentPeople: (el: HTMLVideoElement | HTMLCanvasElement) => Promise<unknown[]> };
      const bsModule = bodySegmentation as {
        toBinaryMask: (segs: unknown[], fg?: object, bg?: object, drawContour?: boolean, fgThreshold?: number) => Promise<ImageData | null>;
      };
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = FRAME_WIDTH;
      frameCanvas.height = FRAME_HEIGHT;
      const frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true })!;

      const bgCanvas = document.createElement('canvas');
      bgCanvas.width = FRAME_WIDTH;
      bgCanvas.height = FRAME_HEIGHT;
      const bgCtx = bgCanvas.getContext('2d', { willReadFrequently: true })!;

      const maskCanvas = document.createElement('canvas');
      const maskCtx = maskCanvas.getContext('2d')!;
      const scaledMaskCanvas = document.createElement('canvas');
      scaledMaskCanvas.width = FRAME_WIDTH;
      scaledMaskCanvas.height = FRAME_HEIGHT;
      const scaledMaskCtx = scaledMaskCanvas.getContext('2d', { willReadFrequently: true })!;
      const pixelateBuffer = document.createElement('canvas');
      const pixelateCtx = pixelateBuffer.getContext('2d')!;

      const render = async () => {
        if (!modelRef.current) return;
        try {
          const cw = FRAME_WIDTH;
          const ch = FRAME_HEIGHT;
          if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
            animRef.current = requestAnimationFrame(() => { render().catch(console.error); });
            return;
          }

          frameCtx.clearRect(0, 0, cw, ch);
          frameCtx.drawImage(video, 0, 0, cw, ch);
          const segmentations = await segModel.segmentPeople(frameCanvas);

          const p = paramsRef.current;
          const mode = bgModeRef.current;
          bgCtx.clearRect(0, 0, cw, ch);

          if (mode === 'blur') {
            bgCtx.save();
            bgCtx.filter = `blur(${p.blurAmount}px)`;
            bgCtx.drawImage(video, 0, 0, cw, ch);
            bgCtx.restore();
          } else if (mode === 'solid') {
            bgCtx.fillStyle = p.bgColor;
            bgCtx.fillRect(0, 0, cw, ch);
          } else if (mode === 'gradient') {
            const rad = (p.gradientAngle * Math.PI) / 180;
            const cos = Math.cos(rad);
            const sin = Math.sin(rad);
            const grad = bgCtx.createLinearGradient(
              cw / 2 - cos * cw,
              ch / 2 - sin * ch,
              cw / 2 + cos * cw,
              ch / 2 + sin * ch
            );
            grad.addColorStop(0, p.bgColor);
            grad.addColorStop(1, p.bgColor2);
            bgCtx.fillStyle = grad;
            bgCtx.fillRect(0, 0, cw, ch);
          } else if (mode === 'pixelate') {
            const size = Math.max(2, p.pixelSize);
            const smallW = Math.max(8, Math.floor(cw / size));
            const smallH = Math.max(8, Math.floor(ch / size));
            pixelateBuffer.width = smallW;
            pixelateBuffer.height = smallH;
            pixelateCtx.drawImage(video, 0, 0, smallW, smallH);
            bgCtx.imageSmoothingEnabled = false;
            bgCtx.drawImage(pixelateBuffer, 0, 0, smallW, smallH, 0, 0, cw, ch);
            bgCtx.imageSmoothingEnabled = true;
          } else if (mode === 'greyscale' || mode === 'invert' || mode === 'posterize' || mode === 'vignette') {
            bgCtx.drawImage(video, 0, 0, cw, ch);
          } else if (mode === 'none') {
            bgCtx.clearRect(0, 0, cw, ch);
          }

          const frameData = frameCtx.getImageData(0, 0, cw, ch);
          const output = bgCtx.getImageData(0, 0, cw, ch);

          const applyEffect = (data: ImageData, effect: 'greyscale' | 'invert' | 'posterize' | 'vignette') => {
            const d = data.data;
            const centerX = cw / 2, centerY = ch / 2;
            const maxDist = Math.sqrt(centerX * centerX + centerY * centerY);
            for (let i = 0; i < d.length; i += 4) {
              if (effect === 'vignette') {
                const px = (i / 4) % cw;
                const py = Math.floor((i / 4) / cw);
                const dist = Math.sqrt((px - centerX) ** 2 + (py - centerY) ** 2);
                const factor = 1 - (dist / maxDist) * p.vignetteStrength;
                d[i] *= factor;
                d[i + 1] *= factor;
                d[i + 2] *= factor;
              } else if (effect === 'greyscale') {
                const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
                d[i] = d[i + 1] = d[i + 2] = g;
              } else if (effect === 'invert') {
                d[i] = 255 - d[i];
                d[i + 1] = 255 - d[i + 1];
                d[i + 2] = 255 - d[i + 2];
              } else if (effect === 'posterize') {
                const levels = Math.max(2, p.posterizeLevel);
                const step = 255 / (levels - 1);
                d[i] = Math.round(d[i] / step) * step;
                d[i + 1] = Math.round(d[i + 1] / step) * step;
                d[i + 2] = Math.round(d[i + 2] / step) * step;
              }
            }
          };

          if (mode === 'greyscale') applyEffect(output, 'greyscale');
          else if (mode === 'invert') applyEffect(output, 'invert');
          else if (mode === 'posterize') applyEffect(output, 'posterize');
          else if (mode === 'vignette') applyEffect(output, 'vignette');

          if (segmentations.length === 0) {
            ctx.putImageData(mode === 'none' ? frameData : output, 0, 0);
          } else {
            const mask = await bsModule.toBinaryMask(
              segmentations,
              { r: 0, g: 0, b: 0, a: 255 },
              { r: 0, g: 0, b: 0, a: 0 },
              false,
              p.maskThreshold
            );

            if (!mask) {
              ctx.putImageData(frameData, 0, 0);
            } else {
              maskCanvas.width = mask.width;
              maskCanvas.height = mask.height;
              maskCtx.putImageData(mask, 0, 0);
              scaledMaskCtx.clearRect(0, 0, cw, ch);
              scaledMaskCtx.drawImage(maskCanvas, 0, 0, mask.width, mask.height, 0, 0, cw, ch);
              const scaledMask = scaledMaskCtx.getImageData(0, 0, cw, ch);

              for (let i = 0; i < scaledMask.data.length; i += 4) {
                if (scaledMask.data[i + 3] >= 128) {
                  output.data[i] = frameData.data[i];
                  output.data[i + 1] = frameData.data[i + 1];
                  output.data[i + 2] = frameData.data[i + 2];
                  output.data[i + 3] = frameData.data[i + 3];
                }
              }

              ctx.putImageData(output, 0, 0);
            }
          }
        } catch (error) {
          logger.error(`Render failed: ${error}`);
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
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {MODES.map(({ id, label }) => (
                  <button key={id} onClick={() => setBgMode(id)}
                    className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${bgMode === id ? 'bg-blue-600 text-white' : 'bg-surface-2 text-zinc-300 hover:bg-surface-3'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-4 items-center p-3 rounded-lg bg-surface-2/50 border border-surface-3">
                <span className="text-xs text-zinc-500 font-medium w-full">Live controls</span>
                {bgMode === 'blur' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400 w-24">Blur</span>
                    <input type="range" min={2} max={40} value={params.blurAmount}
                      onChange={(e) => setParams((p) => ({ ...p, blurAmount: +e.target.value }))}
                      className="w-32 accent-blue-500" />
                    <span className="text-zinc-500 tabular-nums w-8">{params.blurAmount}px</span>
                  </label>
                )}
                {(bgMode === 'solid' || bgMode === 'gradient') && (
                  <>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-zinc-400 w-16">Color 1</span>
                      <input type="color" value={params.bgColor}
                        onChange={(e) => setParams((p) => ({ ...p, bgColor: e.target.value }))}
                        className="w-9 h-8 rounded cursor-pointer" />
                    </label>
                    {bgMode === 'gradient' && (
                      <>
                        <label className="flex items-center gap-2 text-sm">
                          <span className="text-zinc-400 w-16">Color 2</span>
                          <input type="color" value={params.bgColor2}
                            onChange={(e) => setParams((p) => ({ ...p, bgColor2: e.target.value }))}
                            className="w-9 h-8 rounded cursor-pointer" />
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <span className="text-zinc-400 w-20">Angle</span>
                          <input type="range" min={0} max={360} value={params.gradientAngle}
                            onChange={(e) => setParams((p) => ({ ...p, gradientAngle: +e.target.value }))}
                            className="w-24 accent-blue-500" />
                          <span className="text-zinc-500 tabular-nums w-10">{params.gradientAngle}°</span>
                        </label>
                      </>
                    )}
                  </>
                )}
                {bgMode === 'pixelate' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400 w-24">Block size</span>
                    <input type="range" min={4} max={32} value={params.pixelSize}
                      onChange={(e) => setParams((p) => ({ ...p, pixelSize: +e.target.value }))}
                      className="w-32 accent-blue-500" />
                    <span className="text-zinc-500 tabular-nums w-8">{params.pixelSize}px</span>
                  </label>
                )}
                {bgMode === 'posterize' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400 w-24">Levels</span>
                    <input type="range" min={2} max={8} value={params.posterizeLevel}
                      onChange={(e) => setParams((p) => ({ ...p, posterizeLevel: +e.target.value }))}
                      className="w-32 accent-blue-500" />
                    <span className="text-zinc-500 tabular-nums w-8">{params.posterizeLevel}</span>
                  </label>
                )}
                {bgMode === 'vignette' && (
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-zinc-400 w-24">Strength</span>
                    <input type="range" min={0.2} max={1.2} step={0.1} value={params.vignetteStrength}
                      onChange={(e) => setParams((p) => ({ ...p, vignetteStrength: +e.target.value }))}
                      className="w-32 accent-blue-500" />
                    <span className="text-zinc-500 tabular-nums w-10">{params.vignetteStrength.toFixed(1)}</span>
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm ml-auto">
                  <span className="text-zinc-400 w-24">Mask sensitivity</span>
                  <input type="range" min={0.3} max={0.9} step={0.05} value={params.maskThreshold}
                    onChange={(e) => setParams((p) => ({ ...p, maskThreshold: +e.target.value }))}
                    className="w-28 accent-blue-500" />
                  <span className="text-zinc-500 tabular-nums w-10">{params.maskThreshold.toFixed(2)}</span>
                </label>
              </div>
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
