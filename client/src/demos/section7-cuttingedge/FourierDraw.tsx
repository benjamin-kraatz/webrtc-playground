import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

interface Point { x: number; y: number }
interface Epicycle { freq: number; amp: number; phase: number }

const W = 560, H = 380;

function dft(path: Point[]): Epicycle[] {
  const N = path.length;
  return Array.from({ length: N }, (_, k) => {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const phi = (2 * Math.PI * k * n) / N;
      re += path[n].x * Math.cos(phi) + path[n].y * Math.sin(phi);
      im += -path[n].x * Math.sin(phi) + path[n].y * Math.cos(phi);
    }
    return { freq: k, amp: Math.sqrt(re*re + im*im) / N, phase: Math.atan2(im, re) };
  }).sort((a, b) => b.amp - a.amp);
}

const CODE = `// Discrete Fourier Transform of a drawn path
function dft(path) {
  const N = path.length;
  return Array.from({ length: N }, (_, k) => {
    let re = 0, im = 0;
    for (let n = 0; n < N; n++) {
      const phi = (2 * Math.PI * k * n) / N;
      re += path[n].x * Math.cos(phi) + path[n].y * Math.sin(phi);
      im += -path[n].x * Math.sin(phi) + path[n].y * Math.cos(phi);
    }
    return { freq: k, amp: Math.sqrt(re*re+im*im)/N, phase: Math.atan2(im,re) };
  }).sort((a, b) => b.amp - a.amp); // sort by amplitude
}

// Animate the epicycles — each circle spins at frequency k
function animate(epicycles, time) {
  let x = cx, y = cy;
  for (const { freq, amp, phase } of epicycles) {
    const angle = freq * time + phase;
    x += amp * Math.cos(angle);
    y += amp * Math.sin(angle);
    // draw circle + spoke...
  }
  tracedPath.push({ x, y });
  time += (2 * Math.PI) / epicycles.length;
}

// Share the drawn path via DataChannel
dc.send(JSON.stringify({ type: 'path', points: drawnPath }));`;

export default function FourierDraw() {
  const logger = useMemo(() => new Logger(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<'draw' | 'animating'>('draw');
  const [showCircles, setShowCircles] = useState(true);
  const [connected, setConnected] = useState(false);
  const [numCycles, setNumCycles] = useState(40);
  const rawPathRef = useRef<Point[]>([]);
  const epicyclesRef = useRef<Epicycle[]>([]);
  const tracedRef = useRef<Point[]>([]);
  const timeRef = useRef(0);
  const rafRef = useRef<number>(0);
  const isDrawing = useRef(false);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const showRef = useRef(showCircles);
  showRef.current = showCircles;
  const cyclesRef = useRef(numCycles);
  cyclesRef.current = numCycles;

  const drawFrame = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const epicycles = epicyclesRef.current;
    if (!epicycles.length) return;

    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, W, H);

    const cx = W / 2, cy = H / 2;
    let x = cx, y = cy;
    const N = cyclesRef.current;

    for (let i = 0; i < Math.min(N, epicycles.length); i++) {
      const { freq, amp, phase } = epicycles[i];
      const angle = freq * timeRef.current + phase;
      const nx = x + amp * Math.cos(angle);
      const ny = y + amp * Math.sin(angle);

      if (showRef.current) {
        ctx.strokeStyle = `rgba(99,102,241,${Math.max(0.05, 0.4 - i * 0.005)})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.arc(x, y, amp, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = `rgba(139,92,246,${Math.max(0.1, 0.6 - i * 0.008)})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
      }
      x = nx; y = ny;
    }

    tracedRef.current.push({ x, y });
    if (tracedRef.current.length > epicycles.length * 1.1) tracedRef.current.shift();

    // Draw traced path
    if (tracedRef.current.length > 1) {
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(tracedRef.current[0].x, tracedRef.current[0].y);
      for (const p of tracedRef.current) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    // Draw endpoint dot
    ctx.fillStyle = '#f87171';
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();

    timeRef.current += (2 * Math.PI) / epicycles.length;
    rafRef.current = requestAnimationFrame(drawFrame);
  };

  const startAnimation = (path: Point[]) => {
    const centered = path.map(p => ({ x: p.x - W/2, y: p.y - H/2 }));
    epicyclesRef.current = dft(centered);
    tracedRef.current = [];
    timeRef.current = 0;
    setPhase('animating');
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(drawFrame);
    logger.success(`DFT computed: ${epicyclesRef.current.length} frequencies, showing ${numCycles}`);
  };

  const clearCanvas = () => {
    cancelAnimationFrame(rafRef.current);
    rawPathRef.current = [];
    epicyclesRef.current = [];
    tracedRef.current = [];
    timeRef.current = 0;
    setPhase('draw');
    const ctx = canvasRef.current?.getContext('2d')!;
    if (ctx) { ctx.fillStyle = '#09090b'; ctx.fillRect(0, 0, W, H); drawHint(ctx); }
    logger.info('Cleared');
  };

  const drawHint = (ctx: CanvasRenderingContext2D) => {
    ctx.strokeStyle = 'rgba(99,102,241,0.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(W/2, H/2, 80, 0, Math.PI*2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#52525b';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Draw a closed shape here', W/2, H/2 + 110);
    ctx.fillText('then release to animate', W/2, H/2 + 128);
  };

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')!;
    if (ctx) { ctx.fillStyle = '#09090b'; ctx.fillRect(0, 0, W, H); drawHint(ctx); }
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const connect = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = ev => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = ev => ev.candidate && pcA.addIceCandidate(ev.candidate);
    const dc = pcA.createDataChannel('fourier');
    dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Fourier sync connected — share a drawing!'); };
    pcB.ondatachannel = ev => {
      ev.channel.onmessage = e => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'path') { startAnimation(msg.points); logger.info(`Received path: ${msg.points.length} points`); }
      };
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  const getPos = (e: React.MouseEvent | React.TouchEvent): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    if ('touches' in e) {
      return { x: (e.touches[0].clientX - rect.left) * (W / rect.width), y: (e.touches[0].clientY - rect.top) * (H / rect.height) };
    }
    return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) };
  };

  const onStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (phase !== 'draw') return;
    isDrawing.current = true;
    rawPathRef.current = [getPos(e)];
    const ctx = canvasRef.current?.getContext('2d')!;
    ctx.fillStyle = '#09090b'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(rawPathRef.current[0].x, rawPathRef.current[0].y);
  };

  const onMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing.current || phase !== 'draw') return;
    const p = getPos(e);
    rawPathRef.current.push(p);
    const ctx = canvasRef.current?.getContext('2d')!;
    ctx.lineTo(p.x, p.y); ctx.stroke();
  };

  const onEnd = () => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    const path = rawPathRef.current;
    if (path.length < 20) { logger.warn('Draw a larger shape!'); clearCanvas(); return; }
    // Sample path evenly
    const N = Math.min(256, path.length);
    const sampled: Point[] = Array.from({ length: N }, (_, i) => path[Math.floor(i * path.length / N)]);
    if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'path', points: sampled }));
    startAnimation(sampled);
  };

  return (
    <DemoLayout
      title="Fourier Drawing Machine"
      difficulty="advanced"
      description="Draw any shape and watch it reconstructed by spinning Fourier epicycles — share your drawing via DataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            The <strong>Discrete Fourier Transform</strong> decomposes any periodic signal into a
            sum of sine waves. Applied to a 2D drawing: each point <em>(x,y)</em> is treated as
            a complex number <em>x + iy</em>, and the DFT finds a set of rotating circles
            (<em>epicycles</em>) whose sum traces the original shape.
          </p>
          <p>
            Sorting epicycles by amplitude (largest first) and increasing the{' '}
            <em>Epicycles</em> count shows how Fourier series converges — even complex shapes
            can be approximated with surprisingly few circles. The blue traced path is the
            reconstructed drawing; each red/purple ring is one Fourier component.
          </p>
          <p>
            When connected, your drawn path (sampled to 256 points) is serialized as JSON and
            sent over a <strong>DataChannel</strong> — the peer sees the same animation.
          </p>
        </div>
      }
      hints={[
        'Draw slowly and try to close the shape (end near where you started)',
        'Reduce Epicycles to see how few circles can approximate your shape',
        'Try drawing the letters of your name!',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {phase === 'animating' && (
              <button onClick={clearCanvas} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                ← Draw Again
              </button>
            )}
            {!connected && (
              <button onClick={connect} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg">
                Sync Path (Loopback)
              </button>
            )}
            <label className="flex items-center gap-2 text-xs text-zinc-400 select-none">
              <input type="checkbox" checked={showCircles} onChange={e => setShowCircles(e.target.checked)} className="accent-violet-500" />
              Show Circles
            </label>
            <label className="flex items-center gap-2 text-xs text-zinc-400 select-none">
              Epicycles:
              <input type="range" min={4} max={256} value={numCycles} onChange={e => setNumCycles(Number(e.target.value))} className="w-24 accent-violet-500" />
              <span className="font-mono w-8">{numCycles}</span>
            </label>
          </div>

          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className="rounded-xl border border-zinc-800 w-full max-w-2xl block"
            style={{ background: '#09090b', cursor: phase === 'draw' ? 'crosshair' : 'default', touchAction: 'none' }}
            onMouseDown={onStart}
            onMouseMove={onMove}
            onMouseUp={onEnd}
            onTouchStart={onStart}
            onTouchMove={onMove}
            onTouchEnd={onEnd}
          />
          <p className="text-xs text-zinc-500">
            {phase === 'draw' ? 'Draw a shape — release to start Fourier animation' : `Animating with ${Math.min(numCycles, epicyclesRef.current.length)} epicycles`}
          </p>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'DFT epicycles + DataChannel path sharing' }}
      mdnLinks={[
        { label: 'Discrete Fourier Transform (MDN)', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Visualizations_with_Web_Audio_API' },
        { label: 'CanvasRenderingContext2D', href: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D' },
      ]}
    />
  );
}
