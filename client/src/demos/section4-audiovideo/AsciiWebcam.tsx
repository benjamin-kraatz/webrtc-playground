import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';

const ASCII_CHARS = ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';

const CODE = `// Convert a video frame to ASCII art
function frameToAscii(video, cols, rows) {
  // Draw the video frame at low resolution to an offscreen canvas
  const ctx = offscreenCanvas.getContext('2d');
  ctx.drawImage(video, 0, 0, cols, rows);
  const { data } = ctx.getImageData(0, 0, cols, rows);

  let ascii = '';
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const idx = (i * cols + j) * 4;
      // Perceived luminance (ITU-R BT.601)
      const luma = 0.299 * data[idx] + 0.587 * data[idx+1] + 0.114 * data[idx+2];
      const charIdx = Math.floor((luma / 255) * (ASCII_CHARS.length - 1));
      ascii += ASCII_CHARS[charIdx];
    }
    ascii += '\\n';
  }
  return ascii;
}

// Run on every animation frame
function loop() {
  output.textContent = frameToAscii(video, 80, 40);
  requestAnimationFrame(loop);
}`;

export default function AsciiWebcam() {
  const logger = useMemo(() => new Logger(), []);
  const [running, setRunning] = useState(false);
  const [cols, setCols] = useState(80);
  const [inverted, setInverted] = useState(false);
  const [colored, setColored] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const outputRef = useRef<HTMLPreElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);

  const rows = Math.floor(cols * 0.45);

  const renderFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const output = outputRef.current;
    if (!video || !canvas || !output || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(renderFrame);
      return;
    }
    const ctx = canvas.getContext('2d')!;
    canvas.width = cols;
    canvas.height = rows;
    ctx.drawImage(video, 0, 0, cols, rows);
    const imageData = ctx.getImageData(0, 0, cols, rows);
    const { data } = imageData;

    const chars = inverted ? [...ASCII_CHARS].reverse().join('') : ASCII_CHARS;

    if (!colored) {
      let ascii = '';
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const idx = (i * cols + j) * 4;
          const luma = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          ascii += chars[Math.floor((luma / 255) * (chars.length - 1))];
        }
        ascii += '\n';
      }
      output.style.color = '';
      output.innerHTML = '';
      output.textContent = ascii;
    } else {
      let html = '';
      for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
          const idx = (i * cols + j) * 4;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          const luma = 0.299 * r + 0.587 * g + 0.114 * b;
          const ch = chars[Math.floor((luma / 255) * (chars.length - 1))];
          html += `<span style="color:rgb(${r},${g},${b})">${ch}</span>`;
        }
        html += '\n';
      }
      output.innerHTML = html;
    }

    rafRef.current = requestAnimationFrame(renderFrame);
  }, [cols, rows, inverted, colored]);

  const start = async () => {
    try {
      logger.info('Requesting camera access...');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setRunning(true);
      logger.success('Camera active — rendering ASCII art');
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
    if (outputRef.current) outputRef.current.textContent = '';
    logger.info('Camera stopped');
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
      title="ASCII Webcam Art"
      difficulty="intermediate"
      description="Convert your live webcam feed into real-time ASCII art using the Canvas API."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This demo bridges two browser APIs: <strong>getUserMedia</strong> to capture your
            camera as a <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">MediaStream</code> and the{' '}
            <strong>Canvas 2D API</strong> to sample pixel data on every animation frame.
          </p>
          <p>
            Each frame is drawn to a tiny off-screen canvas (e.g., 80 × 36 px). We read the RGBA
            pixel buffer, compute <em>perceived luminance</em> using the BT.601 formula, and map
            it to a character in a 70-character ASCII ramp from dark (<code className="text-xs bg-surface-2 px-1 py-0.5 rounded">' '</code>) to
            bright (<code className="text-xs bg-surface-2 px-1 py-0.5 rounded">'@'</code>). The colored mode preserves each pixel's RGB value as inline CSS.
          </p>
          <p>
            While this demo is purely local, the exact same canvas→stream pipeline powers the{' '}
            <strong>Video Effects</strong> demo — you could capture the ASCII canvas as a
            MediaStream and stream it over WebRTC!
          </p>
        </div>
      }
      hints={[
        'Try the Colored mode for psychedelic results',
        'Increase columns for sharper detail — costs more CPU',
        'Invert flips the character ramp (dark ↔ light)',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {!running ? (
              <button onClick={start} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Start Camera
              </button>
            ) : (
              <button onClick={stop} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg">
                Stop
              </button>
            )}

            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
              <span>Columns:</span>
              <input type="range" min={40} max={120} step={10} value={cols}
                onChange={(e) => setCols(Number(e.target.value))}
                className="w-24 accent-blue-500" />
              <span className="font-mono w-8">{cols}</span>
            </label>

            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
              <input type="checkbox" checked={inverted} onChange={(e) => setInverted(e.target.checked)} className="accent-blue-500" />
              Invert
            </label>

            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
              <input type="checkbox" checked={colored} onChange={(e) => setColored(e.target.checked)} className="accent-blue-500" />
              Colored
            </label>
          </div>

          {/* Hidden video element */}
          <video ref={videoRef} muted playsInline className="hidden" />
          {/* Hidden canvas for pixel sampling */}
          <canvas ref={canvasRef} className="hidden" />

          {/* ASCII output */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 overflow-auto" style={{ maxHeight: 400 }}>
            <pre
              ref={outputRef}
              className="text-emerald-400 font-mono leading-none select-none"
              style={{ fontSize: `${Math.max(4, Math.floor(500 / cols))}px`, whiteSpace: 'pre' }}
            >
              {!running && 'Click "Start Camera" to begin\n\nYour webcam will be converted\nto ASCII art in real time ✨'}
            </pre>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Video frame → ASCII art conversion' }}
      mdnLinks={[
        { label: 'getUserMedia()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia' },
        { label: 'CanvasRenderingContext2D.getImageData()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData' },
      ]}
    />
  );
}
