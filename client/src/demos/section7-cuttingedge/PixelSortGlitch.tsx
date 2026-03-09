import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

type SortAxis = 'rows' | 'cols' | 'both';
type SortBy = 'luma' | 'hue' | 'saturation';

const CODE = `// Pixel Sorting glitch art on live webcam
// Sort pixels in each row by luminance — above a threshold

function pixelSort(imageData, threshold, sortBy, axis) {
  const { data, width, height } = imageData;

  if (axis === 'rows' || axis === 'both') {
    for (let y = 0; y < height; y++) {
      // Extract pixels above threshold into a "run"
      let runStart = -1;
      for (let x = 0; x <= width; x++) {
        const i = (y * width + x) * 4;
        const luma = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
        const inRun = luma > threshold && x < width;
        if (inRun && runStart === -1) runStart = x;
        if (!inRun && runStart !== -1) {
          // Sort the run [runStart..x) by luma
          sortRun(data, y, runStart, x, width, sortBy);
          runStart = -1;
        }
      }
    }
  }
  // same for columns if axis === 'cols' or 'both'
}

// Capture and stream sorted canvas
const stream = sortedCanvas.captureStream(20);
stream.getTracks().forEach(t => pc.addTrack(t, stream));`;

function getLuma(r: number, g: number, b: number) { return 0.299*r + 0.587*g + 0.114*b; }

function getHue(r: number, g: number, b: number) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h = max === r ? (g-b)/d + (g<b?6:0) : max === g ? (b-r)/d+2 : (r-g)/d+4;
  return h/6;
}

function getSat(r: number, g: number, b: number) {
  const max = Math.max(r,g,b)/255, min = Math.min(r,g,b)/255;
  return max === 0 ? 0 : (max-min)/max;
}

function sortKey(data: Uint8ClampedArray, i: number, sortBy: SortBy): number {
  return sortBy === 'luma' ? getLuma(data[i], data[i+1], data[i+2])
       : sortBy === 'hue' ? getHue(data[i], data[i+1], data[i+2]) * 255
       : getSat(data[i], data[i+1], data[i+2]) * 255;
}

function sortPixelRun(data: Uint8ClampedArray, y: number, x0: number, x1: number, W: number, sortBy: SortBy) {
  const pixels: number[][] = [];
  for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    pixels.push([data[i], data[i+1], data[i+2], data[i+3]]);
  }
  pixels.sort((a, b) => getLuma(a[0],a[1],a[2]) - getLuma(b[0],b[1],b[2]));
  for (let x = x0; x < x1; x++) {
    const i = (y * W + x) * 4;
    [data[i], data[i+1], data[i+2], data[i+3]] = pixels[x-x0];
  }
}

function sortColRun(data: Uint8ClampedArray, x: number, y0: number, y1: number, W: number, sortBy: SortBy) {
  const pixels: number[][] = [];
  for (let y = y0; y < y1; y++) {
    const i = (y * W + x) * 4;
    pixels.push([data[i], data[i+1], data[i+2], data[i+3]]);
  }
  pixels.sort((a, b) => sortKey(a as unknown as Uint8ClampedArray, 0, sortBy) - sortKey(b as unknown as Uint8ClampedArray, 0, sortBy));
  for (let y = y0; y < y1; y++) {
    const i = (y * W + x) * 4;
    [data[i], data[i+1], data[i+2], data[i+3]] = pixels[y-y0];
  }
}

function applyPixelSort(imageData: ImageData, threshold: number, sortBy: SortBy, axis: SortAxis) {
  const { data, width: W, height: H } = imageData;

  if (axis === 'rows' || axis === 'both') {
    for (let y = 0; y < H; y++) {
      let runStart = -1;
      for (let x = 0; x <= W; x++) {
        const i = (y * W + (x < W ? x : W-1)) * 4;
        const inRun = x < W && sortKey(data, i, sortBy) > threshold;
        if (inRun && runStart === -1) runStart = x;
        if (!inRun && runStart !== -1) { sortPixelRun(data, y, runStart, x, W, sortBy); runStart = -1; }
      }
    }
  }
  if (axis === 'cols' || axis === 'both') {
    for (let x = 0; x < W; x++) {
      let runStart = -1;
      for (let y = 0; y <= H; y++) {
        const i = ((y < H ? y : H-1) * W + x) * 4;
        const inRun = y < H && sortKey(data, i, sortBy) > threshold;
        if (inRun && runStart === -1) runStart = y;
        if (!inRun && runStart !== -1) { sortColRun(data, x, runStart, y, W, sortBy); runStart = -1; }
      }
    }
  }
}

export default function PixelSortGlitch() {
  const logger = useMemo(() => new Logger(), []);
  const [running, setRunning] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [threshold, setThreshold] = useState(80);
  const [sortAxis, setSortAxis] = useState<SortAxis>('rows');
  const [sortBy, setSortBy] = useState<SortBy>('luma');
  const [inverted, setInverted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const srcCanvasRef = useRef<HTMLCanvasElement>(null);
  const outCanvasRef = useRef<HTMLCanvasElement>(null);
  const rcvVideoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const paramsRef = useRef({ threshold, sortAxis, sortBy, inverted });
  paramsRef.current = { threshold, sortAxis, sortBy, inverted };
  const W = 480, H = 360;

  const processFrame = useCallback(() => {
    const video = videoRef.current;
    const src = srcCanvasRef.current;
    const out = outCanvasRef.current;
    if (!video || !src || !out || video.readyState < 2) { rafRef.current = requestAnimationFrame(processFrame); return; }

    const sCtx = src.getContext('2d')!;
    sCtx.save(); sCtx.scale(-1, 1); sCtx.drawImage(video, -W, 0, W, H); sCtx.restore();
    const imgData = sCtx.getImageData(0, 0, W, H);
    const { p } = { p: paramsRef.current };
    applyPixelSort(imgData, p.threshold, p.sortBy, p.sortAxis);
    const oCtx = out.getContext('2d')!;
    if (p.inverted) {
      const inv = oCtx.createImageData(W, H);
      for (let i = 0; i < imgData.data.length; i += 4) {
        inv.data[i] = 255 - imgData.data[i];
        inv.data[i+1] = 255 - imgData.data[i+1];
        inv.data[i+2] = 255 - imgData.data[i+2];
        inv.data[i+3] = 255;
      }
      oCtx.putImageData(inv, 0, 0);
    } else {
      oCtx.putImageData(imgData, 0, 0);
    }
    rafRef.current = requestAnimationFrame(processFrame);
  }, []);

  const start = async () => {
    try {
      logger.info('Requesting camera...');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: W, height: H, facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setRunning(true);
      rafRef.current = requestAnimationFrame(processFrame);
      logger.success('Pixel sort active! Adjust threshold for different intensities 🎨');
    } catch (e) { logger.error(`Camera error: ${e}`); }
  };

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setRunning(false); setStreaming(false);
    logger.info('Stopped');
  };

  const connectStream = async () => {
    const out = outCanvasRef.current!;
    const captureStream = (out as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(20);
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = ev => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = ev => ev.candidate && pcA.addIceCandidate(ev.candidate);
    captureStream.getTracks().forEach(t => pcA.addTrack(t, captureStream));
    pcB.ontrack = ev => {
      if (rcvVideoRef.current) { rcvVideoRef.current.srcObject = ev.streams[0]; rcvVideoRef.current.play(); }
      setStreaming(true); logger.success('Glitch stream flowing over WebRTC loopback!');
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  useEffect(() => () => stop(), []);

  return (
    <DemoLayout
      title="Pixel Sort Glitch Cam"
      difficulty="intermediate"
      description="Apply the iconic pixel-sorting glitch art effect to your live webcam — then stream the distortion over WebRTC."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>Pixel sorting</strong> is a glitch art technique popularized by Kim Asendorf.
            For each row of the image, contiguous pixels whose brightness exceeds a{' '}
            <em>threshold</em> are sorted by luminance — creating those iconic horizontal
            "melt" streaks. Sorting by hue or saturation produces wildly different results.
          </p>
          <p>
            Every frame runs the sort algorithm on the full canvas ImageData in JavaScript.
            The sorted canvas is captured with{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">captureStream()</code> and
            streamed over a WebRTC loopback. The received video is shown on the right —
            meaning your peer sees your glitched, distorted, melting face in real time.
          </p>
        </div>
      }
      hints={[
        'Low threshold (20–40) sorts almost everything — maximum chaos',
        'High threshold (150+) only sorts bright highlights — subtle streaks',
        'Try "Both" axis with Hue sorting for maximum psychedelia',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!running ? (
              <button onClick={start} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">Start Camera</button>
            ) : (
              <button onClick={stop} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg">Stop</button>
            )}
            {running && !streaming && (
              <button onClick={connectStream} className="px-3 py-1.5 bg-violet-700 hover:bg-violet-600 text-white text-xs rounded-lg">Stream WebRTC (Loopback)</button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <label className="col-span-2 flex items-center gap-2 text-xs text-zinc-400">
              Threshold:
              <input type="range" min={0} max={240} value={threshold} onChange={e => setThreshold(Number(e.target.value))} className="flex-1 accent-blue-500" />
              <span className="font-mono w-8">{threshold}</span>
            </label>
            <div className="flex gap-1">
              {(['rows','cols','both'] as const).map(a => (
                <button key={a} onClick={() => setSortAxis(a)}
                  className={`flex-1 py-1 text-xs rounded-lg border ${sortAxis === a ? 'border-blue-500 bg-blue-950/40 text-blue-300' : 'border-zinc-800 text-zinc-500'}`}>{a}</button>
              ))}
            </div>
            <div className="flex gap-1">
              {(['luma','hue','saturation'] as const).map(s => (
                <button key={s} onClick={() => setSortBy(s)}
                  className={`flex-1 py-1 text-xs rounded-lg border ${sortBy === s ? 'border-violet-500 bg-violet-950/40 text-violet-300' : 'border-zinc-800 text-zinc-500'}`}>{s}</button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
            <input type="checkbox" checked={inverted} onChange={e => setInverted(e.target.checked)} className="accent-violet-500" />
            Invert colors
          </label>

          <video ref={videoRef} muted playsInline className="hidden" />
          <canvas ref={srcCanvasRef} width={W} height={H} className="hidden" />

          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-xs text-zinc-500 mb-1">Sorted Output</p>
              <canvas ref={outCanvasRef} width={W} height={H} className="rounded-xl border border-zinc-800 w-full block" style={{ background: '#000' }} /></div>
            <div><p className="text-xs text-zinc-500 mb-1">WebRTC Received {streaming ? '🔴' : ''}</p>
              <video ref={rcvVideoRef} muted playsInline className="rounded-xl border border-zinc-800 w-full block" style={{ background: '#000', aspectRatio: `${W}/${H}` }} /></div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Row-based pixel sorting via ImageData + captureStream' }}
      mdnLinks={[
        { label: 'CanvasRenderingContext2D.getImageData()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData' },
        { label: 'HTMLCanvasElement.captureStream()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream' },
      ]}
    />
  );
}
