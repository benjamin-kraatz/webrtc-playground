import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';

interface ColorSwatch {
  hex: string;
  rgb: [number, number, number];
  pct: number;
}

const CODE = `// Extract dominant colors from a video frame
function extractPalette(canvas, numColors = 8) {
  const ctx = canvas.getContext('2d');
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Quantize each pixel to a coarse color bucket (32 levels per channel)
  const buckets = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]   & 0xe0; // round to nearest 32
    const g = data[i+1] & 0xe0;
    const b = data[i+2] & 0xe0;
    const key = (r << 16) | (g << 8) | b;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  // Sort by frequency and take the top N
  return [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, numColors)
    .map(([key, count]) => ({
      r: (key >> 16) & 0xff,
      g: (key >> 8) & 0xff,
      b: key & 0xff,
      pct: count / (data.length / 4),
    }));
}`;

function toHex(r: number, g: number, b: number) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function luminance(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

export default function ColorPalette() {
  const logger = useMemo(() => new Logger(), []);
  const [running, setRunning] = useState(false);
  const [palette, setPalette] = useState<ColorSwatch[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const frameCountRef = useRef(0);

  const SAMPLE_W = 160;
  const SAMPLE_H = 120;

  const extractPalette = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H);
    const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);

    const buckets = new Map<number, number>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i] & 0xe0;
      const g = data[i + 1] & 0xe0;
      const b = data[i + 2] & 0xe0;
      const key = (r << 16) | (g << 8) | b;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }

    const total = SAMPLE_W * SAMPLE_H;
    const sorted = [...buckets.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => {
        const r = (key >> 16) & 0xff;
        const g = (key >> 8) & 0xff;
        const b = key & 0xff;
        return { hex: toHex(r, g, b), rgb: [r, g, b] as [number, number, number], pct: count / total };
      });

    setPalette(sorted);
  }, []);

  const loop = useCallback(() => {
    frameCountRef.current++;
    if (frameCountRef.current % 15 === 0) extractPalette();
    rafRef.current = requestAnimationFrame(loop);
  }, [extractPalette]);

  const start = async () => {
    try {
      logger.info('Requesting camera...');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setRunning(true);
      rafRef.current = requestAnimationFrame(loop);
      logger.success('Camera active — palette updates every ~0.5 s');
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

  useEffect(() => () => stop(), []);

  const copyHex = (hex: string) => {
    navigator.clipboard.writeText(hex).then(() => {
      setCopied(hex);
      setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <DemoLayout
      title="Live Color Palette"
      difficulty="intermediate"
      description="Extract the dominant color palette from your live webcam feed in real time."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Color quantization reduces the millions of possible pixel colors down to a small
            representative <em>palette</em>. This demo uses <strong>frequency-based bucketing</strong>:
            each pixel's RGB value is rounded to the nearest multiple of 32 (giving 8 levels
            per channel, or 512 possible colors). The most frequently occurring buckets become
            the dominant palette.
          </p>
          <p>
            The frame is sampled at 160 × 120 px to keep CPU usage low — only every 15th frame
            (~2 fps at 30 fps input) triggers a palette extraction. Click any swatch to copy its
            hex value.
          </p>
          <p>
            A real-world use: adaptive UI theming based on the shared video background,
            content-aware video thumbnails, or brand color analysis.
          </p>
        </div>
      }
      hints={[
        'Point your camera at colorful objects, artwork, or clothing',
        'Click any color swatch to copy its hex code',
        'Swatches are sorted by frequency — the leftmost is the most dominant',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex gap-3 items-center">
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

          <video ref={videoRef} muted playsInline width={320} height={240} className="rounded-xl border border-zinc-800 w-full max-w-sm" />
          <canvas ref={canvasRef} width={SAMPLE_W} height={SAMPLE_H} className="hidden" />

          {palette.length > 0 && (
            <div className="space-y-3">
              {/* Big color bar */}
              <div className="flex h-12 rounded-xl overflow-hidden border border-zinc-800">
                {palette.map((c) => (
                  <div
                    key={c.hex}
                    style={{ backgroundColor: c.hex, flex: c.pct }}
                    className="cursor-pointer hover:brightness-110 transition-all"
                    onClick={() => copyHex(c.hex)}
                    title={`${c.hex} — ${(c.pct * 100).toFixed(1)}%`}
                  />
                ))}
              </div>

              {/* Swatches grid */}
              <div className="grid grid-cols-5 gap-2">
                {palette.map((c) => (
                  <button
                    key={c.hex}
                    onClick={() => copyHex(c.hex)}
                    className="group flex flex-col items-center gap-1.5 p-2 rounded-lg bg-surface-0 border border-zinc-800 hover:border-zinc-600 transition-colors cursor-pointer"
                  >
                    <div className="w-full h-10 rounded-md border border-zinc-700" style={{ backgroundColor: c.hex }} />
                    <span
                      className="text-xs font-mono"
                      style={{ color: luminance(...c.rgb) > 128 ? '#18181b' : '#f4f4f5', textShadow: '0 0 4px rgba(0,0,0,0.5)' }}
                    >
                      {copied === c.hex ? '✓ copied' : c.hex}
                    </span>
                    <span className="text-xs text-zinc-600">{(c.pct * 100).toFixed(1)}%</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Dominant color extraction via bucket quantization' }}
      mdnLinks={[
        { label: 'CanvasRenderingContext2D.getImageData()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData' },
        { label: 'HTMLCanvasElement.captureStream()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream' },
      ]}
    />
  );
}
