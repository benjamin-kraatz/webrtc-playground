import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

interface Viewport { re: number; im: number; scale: number }

const W = 560, H = 400, MAX_ITER = 120;

const PALETTES = [
  { id: 'blue',  name: 'Deep Blue',    fn: (t: number) => `hsl(${200 + t * 60},80%,${20 + t * 60}%)` },
  { id: 'fire',  name: 'Fire',         fn: (t: number) => `hsl(${t * 60},100%,${10 + t * 60}%)` },
  { id: 'neon',  name: 'Neon',         fn: (t: number) => `hsl(${t * 360},100%,${50 + t * 20}%)` },
  { id: 'gold',  name: 'Gold',         fn: (t: number) => `hsl(${40 + t * 20},${80 + t * 20}%,${20 + t * 50}%)` },
];

const CODE = `// Mandelbrot set — iterate z = z² + c until |z| > 2
function mandelbrot(re, im, maxIter) {
  let zr = 0, zi = 0, iter = 0;
  while (zr*zr + zi*zi <= 4 && iter < maxIter) {
    const nr = zr*zr - zi*zi + re;
    zi = 2*zr*zi + im;
    zr = nr;
    iter++;
  }
  // Smooth coloring: use log of escape radius
  if (iter === maxIter) return 0; // inside the set
  return iter + 1 - Math.log(Math.log(zr*zr + zi*zi)) / Math.log(2);
}

// Sync viewport over DataChannel
dc.send(JSON.stringify({ type: 'viewport', re, im, scale }));
dc.onmessage = ({ data }) => {
  const vp = JSON.parse(data);
  renderMandelbrot(vp); // both peers see the same view
};`;

function renderMandelbrot(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  colorFn: (t: number) => string
) {
  const imageData = ctx.createImageData(W, H);
  const data = imageData.data;
  for (let px = 0; px < W; px++) {
    for (let py = 0; py < H; py++) {
      const re = vp.re + (px - W / 2) * vp.scale;
      const im = vp.im + (py - H / 2) * vp.scale;
      let zr = 0, zi = 0, iter = 0;
      while (zr * zr + zi * zi <= 4 && iter < MAX_ITER) {
        const nr = zr * zr - zi * zi + re;
        zi = 2 * zr * zi + im;
        zr = nr;
        iter++;
      }
      const idx = (py * W + px) * 4;
      if (iter === MAX_ITER) {
        data[idx] = data[idx + 1] = data[idx + 2] = 0; data[idx + 3] = 255;
      } else {
        const smooth = iter + 1 - Math.log(Math.log(zr * zr + zi * zi)) / Math.log(2);
        const t = smooth / MAX_ITER;
        const dummy = document.createElement('canvas').getContext('2d')!;
        dummy.fillStyle = colorFn(Math.min(1, Math.max(0, t)));
        dummy.fillRect(0, 0, 1, 1);
        const [r, g, b] = dummy.getImageData(0, 0, 1, 1).data;
        data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

export default function FractalExplorer() {
  const logger = useMemo(() => new Logger(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ re: -0.5, im: 0, scale: 0.004 });
  const [palette, setPalette] = useState(0);
  const [connected, setConnected] = useState(false);
  const [rendering, setRendering] = useState(false);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const dragRef = useRef<{ x: number; y: number; re: number; im: number } | null>(null);
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const paletteColorFn = PALETTES[palette].fn;

  const render = useCallback((vp: Viewport) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setRendering(true);
    setTimeout(() => {
      const ctx = canvas.getContext('2d')!;
      renderMandelbrot(ctx, vp, PALETTES[palette].fn);
      setRendering(false);
    }, 10);
  }, [palette]);

  const broadcastViewport = useCallback((vp: Viewport) => {
    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'viewport', ...vp }));
    }
  }, []);

  const updateViewport = useCallback((vp: Viewport) => {
    setViewport(vp);
    render(vp);
    if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
    renderTimerRef.current = setTimeout(() => broadcastViewport(vp), 150);
  }, [render, broadcastViewport]);

  useEffect(() => { render(viewport); }, [palette]);

  useEffect(() => {
    render(viewport);
    logger.info('Mandelbrot rendered. Scroll to zoom, drag to pan.');
  }, []);

  const connect = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);
    const dc = pcA.createDataChannel('fractal', { ordered: false, maxRetransmits: 0 });
    dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Viewport sync connected — explore together!'); broadcastViewport(viewport); };
    pcB.ondatachannel = (ev) => {
      ev.channel.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'viewport') {
          const vp = { re: msg.re, im: msg.im, scale: msg.scale };
          setViewport(vp);
          render(vp);
          logger.info(`Received viewport: re=${msg.re.toFixed(4)}, scale=${msg.scale.toExponential(2)}`);
        }
      };
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.3 : 0.77;
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (W / rect.width);
    const py = (e.clientY - rect.top) * (H / rect.height);
    const re = viewport.re + (px - W / 2) * viewport.scale;
    const im = viewport.im + (py - H / 2) * viewport.scale;
    const newScale = viewport.scale * factor;
    const newRe = re - (px - W / 2) * newScale;
    const newIm = im - (py - H / 2) * newScale;
    updateViewport({ re: newRe, im: newIm, scale: newScale });
    logger.debug?.(`Zoom ${factor > 1 ? 'out' : 'in'}, scale=${newScale.toExponential(2)}`);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    dragRef.current = { x: e.clientX, y: e.clientY, re: viewport.re, im: viewport.im };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.x) * (W / canvasRef.current!.getBoundingClientRect().width);
    const dy = (e.clientY - dragRef.current.y) * (H / canvasRef.current!.getBoundingClientRect().height);
    const vp = { re: dragRef.current.re - dx * viewport.scale, im: dragRef.current.im - dy * viewport.scale, scale: viewport.scale };
    updateViewport(vp);
  };

  const handleMouseUp = () => { dragRef.current = null; };

  const PRESETS = [
    { label: 'Full View', vp: { re: -0.5, im: 0, scale: 0.004 } },
    { label: 'Seahorse Valley', vp: { re: -0.745, im: 0.1, scale: 0.0001 } },
    { label: 'Elephant Valley', vp: { re: 0.3, im: 0, scale: 0.0002 } },
    { label: 'Mini Brot', vp: { re: -1.75, im: 0, scale: 0.00005 } },
  ];

  return (
    <DemoLayout
      title="Fractal Explorer"
      difficulty="intermediate"
      description="Explore the Mandelbrot set — pan, zoom, and sync your viewport with peers over RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            The <strong>Mandelbrot set</strong> is computed by iterating <em>z → z² + c</em> for each pixel
            coordinate c. Points that never escape (|z| stays ≤ 2) are colored black; escaped points are
            colored by how quickly they escaped. Smooth coloring uses the log of the final escape radius
            to eliminate iteration banding.
          </p>
          <p>
            The rendering runs on the CPU using the Canvas{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">ImageData</code> API —
            no WebGL needed for this resolution. When you pan/zoom, the current viewport (center
            coordinates + scale) is sent over a <strong>RTCDataChannel</strong> so any connected peer
            instantly jumps to the same view. The loopback simulates a second peer receiving the sync.
          </p>
        </div>
      }
      hints={[
        'Scroll wheel to zoom, drag to pan',
        'Try the preset locations — Seahorse Valley and Elephant Valley are stunning',
        'Connect Loopback and then explore — the viewport syncs to the "remote" peer',
      ]}
      demo={
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap gap-2 items-center">
            {!connected && (
              <button onClick={connect} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg">
                Sync Viewport (Loopback)
              </button>
            )}
            <div className="flex gap-1">
              {PALETTES.map((p, i) => (
                <button key={p.id} onClick={() => setPalette(i)}
                  className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${palette === i ? 'border-blue-500 bg-blue-950/40 text-blue-300' : 'border-zinc-800 bg-surface-0 text-zinc-400 hover:border-zinc-600'}`}>
                  {p.name}
                </button>
              ))}
            </div>
            <div className="flex gap-1 ml-auto">
              {PRESETS.map((p) => (
                <button key={p.label} onClick={() => updateViewport(p.vp)}
                  className="px-2.5 py-1.5 text-xs rounded-lg bg-surface-2 hover:bg-surface-3 text-zinc-400">
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Canvas */}
          <div className="relative">
            {rendering && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl z-10">
                <span className="text-white text-sm">Rendering…</span>
              </div>
            )}
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              className="rounded-xl border border-zinc-800 cursor-crosshair w-full max-w-2xl block"
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              style={{ touchAction: 'none' }}
            />
          </div>

          <p className="text-xs text-zinc-500">
            center: {viewport.re.toFixed(6)} + {viewport.im.toFixed(6)}i · scale: {viewport.scale.toExponential(2)}
            {connected && ' · viewport syncing'}
          </p>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Mandelbrot iteration + smooth coloring + viewport sync' }}
      mdnLinks={[
        { label: 'ImageData', href: 'https://developer.mozilla.org/en-US/docs/Web/API/ImageData' },
        { label: 'Mandelbrot set (Wikipedia)', href: 'https://en.wikipedia.org/wiki/Mandelbrot_set' },
      ]}
    />
  );
}
