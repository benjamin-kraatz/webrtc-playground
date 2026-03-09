import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

interface Particle { x: number; y: number; vx: number; vy: number; mass: number; color: string }
interface Well { id: number; x: number; y: number; mass: number; color: string }

const W = 560, H = 380;
const G = 0.5;
const COLORS = ['#60a5fa','#f87171','#34d399','#fbbf24','#a78bfa','#fb7185','#38bdf8'];
let wellId = 0;

const CODE = `// N-body gravity simulation — wells sync over DataChannel
function updateParticles(particles, wells) {
  for (const p of particles) {
    let ax = 0, ay = 0;
    for (const well of wells) {
      const dx = well.x - p.x, dy = well.y - p.y;
      const dist = Math.max(20, Math.sqrt(dx*dx + dy*dy));
      const force = (G * p.mass * well.mass) / (dist * dist);
      ax += force * dx / dist;
      ay += force * dy / dist;
    }
    p.vx += ax / p.mass;
    p.vy += ay / p.mass;
    // Velocity damping
    p.vx *= 0.999; p.vy *= 0.999;
    p.x += p.vx; p.y += p.vy;
    // Bounce off walls
    if (p.x < 0 || p.x > W) p.vx *= -0.8;
    if (p.y < 0 || p.y > H) p.vy *= -0.8;
  }
}

// Sync gravity well placement over DataChannel
canvas.addEventListener('click', (e) => {
  const well = { id, x: e.offsetX, y: e.offsetY, mass: 500 };
  wells.push(well);
  dc.send(JSON.stringify({ type: 'well', well }));
});`;

function makeParticles(n: number): Particle[] {
  return Array.from({ length: n }, (_, i) => ({
    x: Math.random() * W, y: Math.random() * H,
    vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
    mass: 1 + Math.random() * 2,
    color: COLORS[i % COLORS.length],
  }));
}

export default function GravitySim() {
  const logger = useMemo(() => new Logger(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>(makeParticles(80));
  const wellsRef = useRef<Well[]>([]);
  const rafRef = useRef<number>(0);
  const [running, setRunning] = useState(false);
  const [wellCount, setWellCount] = useState(0);
  const [connected, setConnected] = useState(false);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const trailCanvasRef = useRef<HTMLCanvasElement>(null);

  const addWell = (x: number, y: number, mass: number, color: string, fromRemote = false) => {
    const well: Well = { id: ++wellId, x, y, mass, color };
    wellsRef.current = [...wellsRef.current, well];
    setWellCount((c) => c + 1);
    if (!fromRemote && dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'well', x, y, mass, color }));
    }
    logger.info(`${fromRemote ? 'Remote' : 'Local'} gravity well at (${x.toFixed(0)}, ${y.toFixed(0)}) mass=${mass}`);
  };

  const loop = () => {
    const canvas = canvasRef.current;
    const trail = trailCanvasRef.current;
    if (!canvas || !trail) { rafRef.current = requestAnimationFrame(loop); return; }
    const ctx = canvas.getContext('2d')!;
    const tCtx = trail.getContext('2d')!;

    // Fade trail
    tCtx.fillStyle = 'rgba(9,9,11,0.15)';
    tCtx.fillRect(0, 0, W, H);

    // Update physics
    const particles = particlesRef.current;
    const wells = wellsRef.current;
    for (const p of particles) {
      let ax = 0, ay = 0;
      for (const w of wells) {
        const dx = w.x - p.x, dy = w.y - p.y;
        const dist2 = dx * dx + dy * dy;
        const dist = Math.max(15, Math.sqrt(dist2));
        const force = (G * p.mass * w.mass) / dist2;
        ax += force * dx / dist;
        ay += force * dy / dist;
      }
      p.vx += ax / p.mass;
      p.vy += ay / p.mass;
      p.vx *= 0.999; p.vy *= 0.999;
      const prevX = p.x, prevY = p.y;
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) { p.vx *= -0.85; p.x = Math.max(0, Math.min(W, p.x)); }
      if (p.y < 0 || p.y > H) { p.vy *= -0.85; p.y = Math.max(0, Math.min(H, p.y)); }

      // Draw trail
      tCtx.strokeStyle = p.color + '80';
      tCtx.lineWidth = 1;
      tCtx.beginPath(); tCtx.moveTo(prevX, prevY); tCtx.lineTo(p.x, p.y); tCtx.stroke();
    }

    // Draw trail canvas
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(trail, 0, 0);

    // Draw particles
    for (const p of particles) {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2 + p.mass, 0, Math.PI * 2); ctx.fill();
    }

    // Draw wells
    for (const w of wells) {
      const r = 6 + Math.sqrt(w.mass) * 2;
      const grad = ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, r * 3);
      grad.addColorStop(0, w.color + 'ff');
      grad.addColorStop(1, w.color + '00');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(w.x, w.y, r * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = w.color;
      ctx.beginPath(); ctx.arc(w.x, w.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(w.x, w.y, r, 0, Math.PI * 2); ctx.stroke();
    }

    rafRef.current = requestAnimationFrame(loop);
  };

  const start = () => {
    // Clear trail canvas
    const trail = trailCanvasRef.current;
    if (trail) { const tc = trail.getContext('2d')!; tc.clearRect(0, 0, W, H); }
    particlesRef.current = makeParticles(80);
    wellsRef.current = [];
    setWellCount(0);
    setRunning(true);
    rafRef.current = requestAnimationFrame(loop);
    logger.success('Gravity sim started — click to add gravity wells!');
  };

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    setRunning(false);
    wellsRef.current = [];
    setWellCount(0);
  };

  const connect = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);
    const dc = pcA.createDataChannel('gravity', { ordered: false, maxRetransmits: 0 });
    dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Well sync connected!'); };
    pcB.ondatachannel = (ev) => {
      ev.channel.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'well') addWell(msg.x, msg.y, msg.mass, msg.color, true);
        if (msg.type === 'clear') { wellsRef.current = []; setWellCount(0); }
      };
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!running) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top) * (H / rect.height);
    const color = COLORS[wellsRef.current.length % COLORS.length];
    addWell(x, y, 300 + Math.random() * 400, color);
  };

  const clearWells = () => {
    wellsRef.current = [];
    setWellCount(0);
    if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'clear' }));
    logger.info('Cleared all gravity wells');
  };

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <DemoLayout
      title="Particle Gravity Sim"
      difficulty="intermediate"
      description="An N-body particle simulation where gravity wells are placed by click and synced over RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This is an <strong>N-body simulation</strong>: 80 particles each experience gravitational
            attraction from all placed <em>gravity wells</em>. The acceleration of each particle is
            the sum of forces from all wells: <em>F = G·m₁·m₂ / r²</em>, directed toward the well.
          </p>
          <p>
            Velocity is slightly damped (×0.999 per frame) to prevent runaway speeds.
            Particle <em>trails</em> are drawn on a separate fade canvas using{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">rgba(0,0,0,0.15)</code> fill
            to create the trailing comet effect.
          </p>
          <p>
            The <strong>DataChannel</strong> syncs only gravity well placements — lightweight
            JSON events (x, y, mass, color) — letting both peers see the same beautiful orbital
            patterns emerge.
          </p>
        </div>
      }
      hints={[
        'Click anywhere on the canvas to place a gravity well',
        'Add multiple wells close together for chaotic, butterfly orbits',
        'Connect Loopback then add wells — the remote peer\'s particles react too',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!running ? (
              <button onClick={start} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Start Simulation
              </button>
            ) : (
              <button onClick={stop} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg">Stop</button>
            )}
            {running && <button onClick={clearWells} className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-xs rounded-lg">Clear Wells</button>}
            {!connected && running && (
              <button onClick={connect} className="px-3 py-1.5 bg-violet-700 hover:bg-violet-600 text-white text-xs rounded-lg">Sync (Loopback)</button>
            )}
            {running && <span className="text-xs text-zinc-500">Wells: <span className="text-violet-400 font-mono">{wellCount}</span></span>}
          </div>

          <div className="relative">
            <canvas ref={trailCanvasRef} width={W} height={H} className="hidden" />
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              className="rounded-xl border border-zinc-800 cursor-crosshair w-full max-w-2xl block"
              style={{ background: '#09090b' }}
              onClick={handleClick}
            />
            {!running && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl">
                <p className="text-zinc-600 text-sm">Click Start Simulation</p>
              </div>
            )}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'N-body gravity physics + DataChannel well sync' }}
      mdnLinks={[
        { label: 'CanvasRenderingContext2D', href: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D' },
        { label: 'requestAnimationFrame()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/window/requestAnimationFrame' },
      ]}
    />
  );
}
