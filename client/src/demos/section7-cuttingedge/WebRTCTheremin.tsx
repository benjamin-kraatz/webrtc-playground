import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const MIN_FREQ = 65.41;  // C2
const MAX_FREQ = 2093.0; // C7

function freqToNote(freq: number): string {
  const midi = 12 * Math.log2(freq / 440) + 69;
  const semitone = Math.round(midi) % 12;
  const octave = Math.floor(Math.round(midi) / 12) - 1;
  return `${NOTE_NAMES[(semitone + 12) % 12]}${octave}`;
}

const CODE = `// WebRTC Theremin: mouse position → Tone.js oscillator → MediaStream → peer
import * as Tone from 'tone';

const osc = new Tone.Oscillator(440, 'sine');
const vol = new Tone.Volume(-20);
const dest = Tone.context.createMediaStreamDestination();

osc.chain(vol, dest);
osc.start();

// Also route to speakers for local monitoring
vol.toDestination();

// Mouse X → frequency (C2 to C7, exponential scale)
canvas.addEventListener('mousemove', (e) => {
  const xRatio = e.offsetX / canvas.width;
  const freq = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, xRatio);
  osc.frequency.rampTo(freq, 0.05);

  // Mouse Y → volume (full → silent)
  const yRatio = e.offsetY / canvas.height;
  const db = -60 + (1 - yRatio) * 54; // -60 dB to -6 dB
  vol.volume.rampTo(db, 0.05);
});

// Stream to WebRTC peer
dest.stream.getTracks().forEach(t => pc.addTrack(t, dest.stream));`;

export default function WebRTCTheremin() {
  const logger = useMemo(() => new Logger(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [active, setActive] = useState(false);
  const [note, setNote] = useState('');
  const [freq, setFreq] = useState(0);
  const [volume, setVolume] = useState(0);
  const [waveType, setWaveType] = useState<'sine' | 'sawtooth' | 'square' | 'triangle'>('sine');
  const oscRef = useRef<{ frequency: { rampTo: (v: number, t: number) => void; value: number }; type: string; start(): void } | null>(null);
  const volRef = useRef<{ volume: { rampTo: (v: number, t: number) => void } } | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const pcARef = useRef<RTCPeerConnection | null>(null);
  const pcBRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number>(0);
  const mouseRef = useRef({ x: 0.5, y: 0.5, inside: false });
  const W = 560, H = 300;

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);

    if (!active) {
      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#52525b';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Click "Play Theremin" to start', W / 2, H / 2);
      return;
    }

    // Background gradient
    const bgGrad = ctx.createLinearGradient(0, 0, W, 0);
    bgGrad.addColorStop(0, '#1e1b4b');
    bgGrad.addColorStop(1, '#1f2937');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Frequency grid lines (octave marks)
    const octaves = ['C2','C3','C4','C5','C6','C7'];
    const freqs = [65.41, 130.81, 261.63, 523.25, 1046.5, 2093.0];
    for (let i = 0; i < octaves.length; i++) {
      const x = (Math.log2(freqs[i] / MIN_FREQ) / Math.log2(MAX_FREQ / MIN_FREQ)) * W;
      ctx.strokeStyle = 'rgba(99,102,241,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(99,102,241,0.6)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(octaves[i], x, H - 8);
    }

    // Volume gradient overlay
    for (let y = 0; y < H; y += 4) {
      const alpha = 0.08 + (y / H) * 0.06;
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.fillRect(0, y, W, 4);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('Loud', 8, 20);
    ctx.textAlign = 'left';
    ctx.fillText('Silent', 8, H - 20);

    if (mouseRef.current.inside) {
      const mx = mouseRef.current.x * W;
      const my = mouseRef.current.y * H;
      // Cursor glow
      const glow = ctx.createRadialGradient(mx, my, 0, mx, my, 80);
      glow.addColorStop(0, 'rgba(139,92,246,0.5)');
      glow.addColorStop(1, 'rgba(139,92,246,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(mx, my, 80, 0, Math.PI * 2); ctx.fill();

      // Crosshair
      ctx.strokeStyle = 'rgba(167,139,250,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(mx, 0); ctx.lineTo(mx, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(W, my); ctx.stroke();

      // Note label
      ctx.fillStyle = 'white';
      ctx.font = 'bold 28px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(note, mx, my - 20);

      ctx.font = '12px monospace';
      ctx.fillStyle = 'rgba(167,139,250,0.8)';
      ctx.fillText(`${freq.toFixed(1)} Hz`, mx, my - 2);
    }
  };

  const start = async () => {
    logger.info('Loading Tone.js...');
    const Tone = await import('tone');
    await Tone.start();
    const osc = new Tone.Oscillator(440, waveType);
    const vol = new Tone.Volume(-20);
    const dest = Tone.context.createMediaStreamDestination();
    osc.chain(vol, dest);
    vol.toDestination();
    osc.start();
    oscRef.current = osc as unknown as typeof oscRef.current;
    volRef.current = vol;
    destRef.current = dest;

    // WebRTC loopback to stream audio
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcARef.current = pcA; pcBRef.current = pcB;
    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);
    dest.stream.getTracks().forEach((t) => pcA.addTrack(t, dest.stream));
    pcB.ontrack = (ev) => {
      const audio = new Audio();
      audio.srcObject = ev.streams[0];
      audio.play().catch(() => {});
      remoteAudioRef.current = audio;
      logger.success('Audio stream connected over WebRTC loopback!');
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);

    setActive(true);
    rafRef.current = requestAnimationFrame(function draw() { drawCanvas(); rafRef.current = requestAnimationFrame(draw); });
    logger.success('Theremin active! Move mouse over the canvas to play.');
  };

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    (oscRef.current as unknown as { stop?: () => void })?.stop?.();
    remoteAudioRef.current?.pause();
    pcARef.current?.close(); pcBRef.current?.close();
    oscRef.current = null;
    volRef.current = null;
    setActive(false); setNote(''); setFreq(0); setVolume(0);
    const canvas = canvasRef.current;
    if (canvas) { const ctx = canvas.getContext('2d')!; ctx.clearRect(0, 0, W, H); }
    logger.info('Theremin stopped');
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!active || !oscRef.current || !volRef.current) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const xRatio = (e.clientX - rect.left) / rect.width;
    const yRatio = (e.clientY - rect.top) / rect.height;
    mouseRef.current = { x: xRatio, y: yRatio, inside: true };
    const f = MIN_FREQ * Math.pow(MAX_FREQ / MIN_FREQ, xRatio);
    const db = -60 + (1 - yRatio) * 54;
    oscRef.current.frequency.rampTo(f, 0.04);
    volRef.current.volume.rampTo(db, 0.04);
    setFreq(f);
    setNote(freqToNote(f));
    setVolume(Math.round((1 - yRatio) * 100));
  };

  const handleMouseLeave = () => { mouseRef.current.inside = false; };

  useEffect(() => { drawCanvas(); }, [active]);
  useEffect(() => () => stop(), []);

  return (
    <DemoLayout
      title="WebRTC Theremin"
      difficulty="intermediate"
      description="Play a virtual theremin with your mouse — pitch and volume controlled by position, audio streamed via WebRTC."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            The <strong>theremin</strong> is played without physical contact — pure hand position in
            space controls pitch and volume. This digital version maps your mouse X position to
            frequency (C2–C7, on an exponential scale matching real musical pitch) and Y position
            to volume (top = loud, bottom = silent).
          </p>
          <p>
            <strong>Tone.js</strong> generates the oscillator signal. The output is tapped from a
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded mx-1">MediaStreamDestination</code> node
            and streamed through a WebRTC loopback connection — showing how synthesized audio
            can flow over WebRTC just like a microphone stream. In a real app, remote peers
            would hear you play live.
          </p>
        </div>
      }
      hints={[
        'Move left ← for low notes, right → for high notes',
        'Move up ↑ for loud, down ↓ for silence',
        'Try "Square" or "Sawtooth" waveforms for harsher tones',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!active ? (
              <button onClick={start} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg">
                🎶 Play Theremin
              </button>
            ) : (
              <button onClick={stop} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg">Stop</button>
            )}
            <div className="flex gap-1">
              {(['sine','triangle','sawtooth','square'] as const).map((w) => (
                <button key={w} onClick={() => setWaveType(w)}
                  disabled={active}
                  className={`px-2.5 py-1.5 text-xs rounded-lg border disabled:opacity-40 transition-colors ${waveType === w ? 'border-violet-500 bg-violet-950/40 text-violet-300' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}>
                  {w}
                </button>
              ))}
            </div>
            {active && (
              <div className="ml-auto flex items-center gap-4 text-sm">
                <span className="text-2xl font-bold font-mono text-violet-400">{note || '—'}</span>
                <span className="text-zinc-500 text-xs font-mono">{freq > 0 ? `${freq.toFixed(1)} Hz` : ''}</span>
                <span className="text-xs text-zinc-500">{volume > 0 ? `Vol: ${volume}%` : 'silent'}</span>
              </div>
            )}
          </div>

          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className="rounded-xl border border-zinc-800 cursor-none w-full max-w-2xl block"
            style={{ background: '#18181b' }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Tone.js oscillator → MediaStreamDestination → WebRTC' }}
      mdnLinks={[
        { label: 'Tone.js', href: 'https://tonejs.github.io/' },
        { label: 'AudioContext.createMediaStreamDestination()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamDestination' },
      ]}
    />
  );
}
