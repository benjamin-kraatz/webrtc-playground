import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const MIN_FREQ = 110, MAX_FREQ = 880;

function freqToNote(f: number): string {
  const midi = Math.round(12 * Math.log2(f / 440) + 69);
  return `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

interface Particle { x: number; y: number; vx: number; vy: number }
interface Well { x: number; y: number; mass: number }

const CODE = `// MASHUP: Particle Gravity Sim + WebRTC Theremin
// The physics of orbiting particles drives the audio synthesis in real time.

// Average particle speed → musical frequency (fast = high pitch)
function particleSpeedToFreq(particles) {
  const avgSpeed = particles.reduce((sum, p) =>
    sum + Math.sqrt(p.vx*p.vx + p.vy*p.vy), 0) / particles.length;
  // Map 0–15 px/frame speed to MIN_FREQ–MAX_FREQ Hz (exponential)
  const t = Math.min(1, avgSpeed / 15);
  return MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, t);
}

// Average proximity to wells → volume (close = loud)
function particleDensityToVolume(particles, wells) {
  let totalProximity = 0;
  for (const p of particles) {
    for (const w of wells) {
      const d = Math.sqrt((p.x-w.x)**2 + (p.y-w.y)**2);
      totalProximity += Math.max(0, 1 - d / 200);
    }
  }
  return Math.min(1, totalProximity / particles.length);
}

// Route Tone.js oscillator to WebRTC
const dest = Tone.context.createMediaStreamDestination();
osc.connect(dest);
dest.stream.getTracks().forEach(t => pc.addTrack(t, dest.stream));`;

const W = 560, H = 320, G = 0.4;

function makeParticles(n: number): Particle[] {
  return Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, vx: (Math.random()-0.5)*2, vy: (Math.random()-0.5)*2 }));
}

export default function GravityTheremin() {
  const logger = useMemo(() => new Logger(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trailRef = useRef<HTMLCanvasElement>(null);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState('');
  const [freq, setFreq] = useState(0);
  const [volume, setVolume] = useState(0);
  const [wellCount, setWellCount] = useState(0);
  const [waveType, setWaveType] = useState<'sine'|'triangle'|'sawtooth'>('sine');
  const particlesRef = useRef<Particle[]>(makeParticles(60));
  const wellsRef = useRef<Well[]>([]);
  const oscRef = useRef<{ frequency: { rampTo: (v: number, t: number) => void }; type: string } | null>(null);
  const volRef = useRef<{ volume: { rampTo: (v: number, t: number) => void } } | null>(null);
  const rafRef = useRef<number>(0);
  const waveRef = useRef(waveType);
  waveRef.current = waveType;

  const drawLoop = () => {
    const canvas = canvasRef.current;
    const trail = trailRef.current;
    if (!canvas || !trail) { rafRef.current = requestAnimationFrame(drawLoop); return; }
    const ctx = canvas.getContext('2d')!;
    const tCtx = trail.getContext('2d')!;

    // Update physics
    const particles = particlesRef.current;
    const wells = wellsRef.current;
    for (const p of particles) {
      let ax = 0, ay = 0;
      for (const w of wells) {
        const dx = w.x - p.x, dy = w.y - p.y;
        const d = Math.max(10, Math.sqrt(dx*dx + dy*dy));
        const f = G * w.mass / (d*d);
        ax += f * dx/d; ay += f * dy/d;
      }
      p.vx += ax; p.vy += ay;
      p.vx *= 0.999; p.vy *= 0.999;
      const px = p.x, py = p.y;
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0 || p.x > W) { p.vx *= -0.85; p.x = Math.max(0, Math.min(W, p.x)); }
      if (p.y < 0 || p.y > H) { p.vy *= -0.85; p.y = Math.max(0, Math.min(H, p.y)); }

      tCtx.strokeStyle = 'rgba(139,92,246,0.15)';
      tCtx.lineWidth = 0.8;
      tCtx.beginPath(); tCtx.moveTo(px, py); tCtx.lineTo(p.x, p.y); tCtx.stroke();
    }

    // Compute audio parameters from particle state
    const avgSpeed = particles.reduce((s, p) => s + Math.sqrt(p.vx*p.vx + p.vy*p.vy), 0) / particles.length;
    let proximity = 0;
    if (wells.length > 0) {
      for (const p of particles) for (const w of wells) {
        const d = Math.sqrt((p.x-w.x)**2 + (p.y-w.y)**2);
        proximity += Math.max(0, 1 - d/150);
      }
      proximity /= particles.length * wells.length;
    }

    const t = Math.min(1, avgSpeed / 12);
    const targetFreq = MIN_FREQ * Math.pow(MAX_FREQ/MIN_FREQ, t);
    const targetVol = wells.length > 0 ? Math.min(1, proximity * 3) : 0;
    const dbVol = -40 + targetVol * 34; // -40 to -6 dB

    oscRef.current?.frequency.rampTo(targetFreq, 0.1);
    volRef.current?.volume.rampTo(dbVol, 0.1);
    setFreq(Math.round(targetFreq));
    setNote(freqToNote(targetFreq));
    setVolume(Math.round(targetVol * 100));

    // Fade trails
    tCtx.fillStyle = 'rgba(9,9,11,0.08)';
    tCtx.fillRect(0, 0, W, H);

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(trail, 0, 0);

    // Draw particles
    for (const p of particles) {
      const speed = Math.sqrt(p.vx*p.vx + p.vy*p.vy);
      const hue = 200 + speed * 15;
      ctx.fillStyle = `hsl(${hue},80%,60%)`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, Math.PI*2); ctx.fill();
    }

    // Draw wells
    for (const w of wells) {
      const r = 4 + Math.sqrt(w.mass)*1.5;
      const grd = ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, r*3);
      grd.addColorStop(0, 'rgba(167,139,250,0.9)');
      grd.addColorStop(1, 'rgba(167,139,250,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(w.x, w.y, r*3, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = '#a78bfa';
      ctx.beginPath(); ctx.arc(w.x, w.y, r, 0, Math.PI*2); ctx.fill();
    }

    rafRef.current = requestAnimationFrame(drawLoop);
  };

  const start = async () => {
    const Tone = await import('tone');
    await Tone.start();
    const osc = new Tone.Oscillator(MIN_FREQ, waveRef.current).start();
    const vol = new Tone.Volume(-40).toDestination();
    osc.connect(vol);
    oscRef.current = osc as unknown as typeof oscRef.current;
    volRef.current = vol as unknown as typeof volRef.current;
    particlesRef.current = makeParticles(60);
    wellsRef.current = [];
    setWellCount(0);
    const tCtx = trailRef.current?.getContext('2d')!;
    if (tCtx) { tCtx.fillStyle = '#000'; tCtx.fillRect(0, 0, W, H); }
    setRunning(true);
    rafRef.current = requestAnimationFrame(drawLoop);
    logger.success('Gravity Theremin active — click to add gravity wells!');
  };

  const stop = async () => {
    cancelAnimationFrame(rafRef.current);
    const Tone = await import('tone');
    (oscRef.current as unknown as { stop?: () => void })?.stop?.();
    setRunning(false); setNote(''); setFreq(0); setVolume(0);
    logger.info('Stopped');
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!running) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) * W / rect.width;
    const y = (e.clientY - rect.top) * H / rect.height;
    wellsRef.current.push({ x, y, mass: 200 + Math.random() * 300 });
    setWellCount(wellsRef.current.length);
    logger.info(`Well at (${x.toFixed(0)}, ${y.toFixed(0)})`);
  };

  const clearWells = () => { wellsRef.current = []; setWellCount(0); };

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); }, []);

  return (
    <DemoLayout
      title="Gravity Theremin"
      difficulty="intermediate"
      description="MASHUP: Particle Gravity Sim + WebRTC Theremin — particle physics directly drives pitch and volume in real time."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This mashup wires the <strong>Particle Gravity Sim</strong>'s physics engine directly
            into the <strong>WebRTC Theremin</strong>'s audio synthesis:
          </p>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li><strong>Average particle speed</strong> → frequency (fast orbits = high pitch)</li>
            <li><strong>Average particle proximity to wells</strong> → volume (dense clusters = loud)</li>
          </ul>
          <p>
            Click to add gravity wells — as particles spiral in and accelerate, you'll hear the
            pitch rise. Remove wells and they slow down, dropping the pitch. The Tone.js oscillator
            ramps smoothly between values creating a continuous, physics-driven melody.
          </p>
        </div>
      }
      hints={[
        'Click to add a gravity well — particles orbit it and the pitch changes',
        'Multiple overlapping wells create chaotic, unpredictable sounds',
        'Try Sawtooth or Triangle wave for different timbres',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!running ? (
              <button onClick={start} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg">
                🎵 Start
              </button>
            ) : (
              <button onClick={stop} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg">Stop</button>
            )}
            {running && <button onClick={clearWells} className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-xs rounded-lg">Clear Wells</button>}
            <div className="flex gap-1">
              {(['sine','triangle','sawtooth'] as const).map(w => (
                <button key={w} onClick={() => { setWaveType(w); if (oscRef.current) oscRef.current.type = w; }}
                  className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${waveType === w ? 'border-violet-500 bg-violet-950/40 text-violet-300' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}>
                  {w}
                </button>
              ))}
            </div>
            {running && (
              <div className="ml-auto flex items-center gap-3 text-sm">
                <span className="font-bold text-2xl font-mono text-violet-400">{note || '—'}</span>
                <span className="text-xs text-zinc-500">{freq} Hz · Vol {volume}%</span>
              </div>
            )}
          </div>
          <div className="relative">
            <canvas ref={trailRef} width={W} height={H} className="hidden" />
            <canvas ref={canvasRef} width={W} height={H}
              className="rounded-xl border border-zinc-800 w-full max-w-2xl block cursor-crosshair"
              style={{ background: '#09090b' }}
              onClick={handleClick} />
            {!running && (
              <div className="absolute inset-0 flex items-center justify-center rounded-xl">
                <p className="text-zinc-600 text-sm">Click Start, then click to add gravity wells</p>
              </div>
            )}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Particle physics drives Tone.js oscillator frequency' }}
      mdnLinks={[
        { label: 'Tone.js', href: 'https://tonejs.github.io/' },
        { label: 'Web Audio API', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API' },
      ]}
    />
  );
}
