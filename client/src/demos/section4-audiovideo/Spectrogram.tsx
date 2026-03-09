import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';

const FFT_SIZE = 2048;
const BINS = FFT_SIZE / 2;  // 1024 frequency bins
const DISPLAY_BINS = 256;   // show lower 256 (0–11 kHz)
const CODE = `// Audio Spectrogram — waterfall frequency display
const ctx = new AudioContext();
const src = ctx.createMediaStreamSource(micStream);
const analyser = ctx.createAnalyser();
analyser.fftSize = 2048;       // 1024 frequency bins
analyser.smoothingTimeConstant = 0.2;
src.connect(analyser);

const freqData = new Uint8Array(analyser.frequencyBinCount);

function drawColumn() {
  analyser.getByteFrequencyData(freqData);

  // Shift canvas left by 1 px (scroll effect)
  const img = canvasCtx.getImageData(1, 0, W - 1, H);
  canvasCtx.putImageData(img, 0, 0);

  // Draw new rightmost column
  for (let bin = 0; bin < DISPLAY_BINS; bin++) {
    const amplitude = freqData[bin] / 255;
    const y = H - 1 - Math.floor((bin / DISPLAY_BINS) * H);
    // Map amplitude to hue (blue → cyan → green → yellow → red)
    const hue = (1 - amplitude) * 240;
    canvasCtx.fillStyle = amplitude > 0.02
      ? \`hsl(\${hue}, 100%, \${30 + amplitude * 50}%)\`
      : '#000';
    canvasCtx.fillRect(W - 1, y, 1, Math.ceil(H / DISPLAY_BINS));
  }
  requestAnimationFrame(drawColumn);
}`;

export default function Spectrogram() {
  const logger = useMemo(() => new Logger(), []);
  const [running, setRunning] = useState(false);
  const [source, setSource] = useState<'mic' | 'tone'>('mic');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const W = 560, H = 200;

  const drawLoop = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;
    if (!canvas || !analyser) return;
    const canvasCtx = canvas.getContext('2d')!;
    const freqData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(freqData);

    // Scroll left by 1px
    const img = canvasCtx.getImageData(1, 0, W - 1, H);
    canvasCtx.putImageData(img, 0, 0);

    // Draw new rightmost column
    const binH = H / DISPLAY_BINS;
    for (let bin = 0; bin < DISPLAY_BINS; bin++) {
      const amp = freqData[bin] / 255;
      const y = H - 1 - Math.floor(bin * binH);
      if (amp > 0.01) {
        const hue = (1 - amp) * 240;
        canvasCtx.fillStyle = `hsl(${hue},100%,${25 + amp * 55}%)`;
      } else {
        canvasCtx.fillStyle = '#000';
      }
      canvasCtx.fillRect(W - 1, y, 1, Math.ceil(binH) + 1);
    }
    rafRef.current = requestAnimationFrame(drawLoop);
  }, []);

  const startMic = async () => {
    try {
      logger.info('Requesting microphone...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false }, video: false });
      streamRef.current = stream;
      const audioCtx = new AudioContext();
      ctxRef.current = audioCtx;
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      analyser.smoothingTimeConstant = 0.15;
      analyserRef.current = analyser;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      setRunning(true);
      rafRef.current = requestAnimationFrame(drawLoop);
      logger.success('Spectrogram running — speak, whistle, or sing!');
    } catch (e) { logger.error(`Microphone error: ${e}`); }
  };

  const startTone = async () => {
    logger.info('Loading Tone.js oscillator for demo...');
    const Tone = await import('tone');
    await Tone.start();
    const audioCtx = Tone.context.rawContext as AudioContext;
    ctxRef.current = audioCtx;
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.15;
    analyserRef.current = analyser;

    // Connect Tone.js master output to our analyser
    (Tone.getDestination() as unknown as { connect: (n: unknown) => void }).connect(analyser);

    // Play a sweeping sine
    const synth = new Tone.Synth({ oscillator: { type: 'sawtooth' }, envelope: { attack: 0.01, release: 0.5 } }).toDestination();
    const NOTES = ['C2','G2','C3','E3','G3','C4','E4','G4','C5'];
    let i = 0;
    const seq = new Tone.Sequence((time, note) => synth.triggerAttackRelease(note as string, '8n', time), NOTES, '4n').start(0);
    Tone.Transport.start();

    setRunning(true);
    rafRef.current = requestAnimationFrame(drawLoop);
    logger.success('Tone.js sawtooth sweep — watch the harmonics!');
  };

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setRunning(false);
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext('2d')!.clearRect(0, 0, W, H);
    logger.info('Stopped');
  };

  // Draw frequency axis labels
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, W, H);
  }, []);

  useEffect(() => () => stop(), []);

  const sampleRate = ctxRef.current?.sampleRate ?? 44100;
  const nyquist = sampleRate / 2;
  const freqLabels = [0, 1, 2, 4, 6, 8, 11].map(khz => ({
    khz,
    y: H - 1 - Math.floor((khz * 1000 / nyquist) * (DISPLAY_BINS / BINS) * H),
  }));

  return (
    <DemoLayout
      title="Audio Spectrogram"
      difficulty="intermediate"
      description="A real-time waterfall spectrogram of your microphone — frequency on the Y axis, time scrolling left, amplitude as color."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            A <strong>spectrogram</strong> plots frequency (Y axis) versus time (X axis). Each
            vertical column is one frame's FFT: the{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">AnalyserNode.getByteFrequencyData()</code>{' '}
            returns an array of 1024 amplitude values (0–255) for frequencies 0 Hz to Nyquist
            (≈22 kHz). We display the lower 256 bins (0–11 kHz) where most voice content lives.
          </p>
          <p>
            <strong>Color mapping:</strong> low amplitude → black, medium → blue/cyan, high →
            yellow/red. The canvas is scrolled left each frame by copying{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">getImageData(1, 0, W-1, H)</code>
            and drawing one new pixel column on the right edge.
          </p>
          <p>
            Whistling a pure tone creates a single bright horizontal line.
            Vowel sounds show harmonic series (multiple parallel lines). Try the Tone.js mode
            to see a sawtooth wave's rich harmonic series.
          </p>
        </div>
      }
      hints={[
        'Whistle a steady note — you\'ll see a single bright line',
        'Try saying "aaah" vs "eeee" — vowels show distinct harmonic patterns',
        'Tone.js mode shows a sawtooth wave\'s rich harmonic series without needing a mic',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!running ? (
              <>
                <button onClick={startMic}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                  🎤 Microphone
                </button>
                <button onClick={startTone}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg">
                  🎵 Tone.js Demo
                </button>
              </>
            ) : (
              <button onClick={stop} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg">Stop</button>
            )}
          </div>

          <div className="relative">
            <canvas
              ref={canvasRef}
              width={W}
              height={H}
              className="rounded-xl border border-zinc-800 w-full block"
              style={{ background: '#000', imageRendering: 'pixelated' }}
            />
            {/* Frequency labels */}
            <div className="absolute left-0 top-0 h-full flex flex-col justify-between pointer-events-none px-1 py-0.5">
              {['11kHz','8kHz','4kHz','2kHz','0Hz'].map((f) => (
                <span key={f} className="text-xs text-zinc-500 font-mono leading-none">{f}</span>
              ))}
            </div>
            {!running && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-zinc-600 text-sm">Choose a source above</p>
              </div>
            )}
          </div>

          {/* Color scale legend */}
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span>Low</span>
            <div className="flex-1 h-2 rounded-full" style={{ background: 'linear-gradient(to right, #000, #00f, #0ff, #0f0, #ff0, #f00)' }} />
            <span>High</span>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'FFT waterfall spectrogram via AnalyserNode' }}
      mdnLinks={[
        { label: 'AnalyserNode', href: 'https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode' },
        { label: 'getByteFrequencyData()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/getByteFrequencyData' },
      ]}
    />
  );
}
