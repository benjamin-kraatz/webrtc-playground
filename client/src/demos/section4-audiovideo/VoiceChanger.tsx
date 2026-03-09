import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

type EffectId = 'dry' | 'echo' | 'telephone' | 'tremolo' | 'distortion' | 'robot';

interface Effect {
  id: EffectId;
  label: string;
  emoji: string;
  description: string;
}

const EFFECTS: Effect[] = [
  { id: 'dry',        label: 'Dry',        emoji: '🎙️', description: 'No effect — raw microphone' },
  { id: 'echo',       label: 'Echo',       emoji: '🏔️', description: 'Delay + feedback loop (300 ms, 40%)' },
  { id: 'telephone',  label: 'Telephone',  emoji: '📞', description: 'Bandpass filter (400–3400 Hz)' },
  { id: 'tremolo',    label: 'Tremolo',    emoji: '〰️', description: 'LFO amplitude modulation at 8 Hz' },
  { id: 'distortion', label: 'Distortion', emoji: '🔥', description: 'WaveShaper overdrive (soft clip)' },
  { id: 'robot',      label: 'Robot',      emoji: '🤖', description: 'Ring modulation at 80 Hz' },
];

const CODE = `// Build a Web Audio effect chain on a live mic stream
const ctx = new AudioContext();
const source = ctx.createMediaStreamSource(micStream);
const dest   = ctx.createMediaStreamDestination(); // → WebRTC

// Echo: delay node with feedback
const delay = ctx.createDelay(1.0);
const feedback = ctx.createGain();
delay.delayTime.value = 0.3;
feedback.gain.value = 0.4;
source.connect(delay);
delay.connect(feedback);
feedback.connect(delay); // feedback loop
delay.connect(dest);

// Telephone: bandpass filter
const bpf = ctx.createBiquadFilter();
bpf.type = 'bandpass';
bpf.frequency.value = 1700;
bpf.Q.value = 0.5;

// Tremolo: LFO → gain
const tremoloGain = ctx.createGain();
const lfo = ctx.createOscillator();
lfo.frequency.value = 8;
const lfoGain = ctx.createGain();
lfoGain.gain.value = 0.5;
lfo.connect(lfoGain);
lfoGain.connect(tremoloGain.gain);
tremoloGain.gain.value = 0.5;
lfo.start();

// Robot: ring modulation
const ringOsc = ctx.createOscillator();
ringOsc.frequency.value = 80;
const ringGain = ctx.createGain();
ringOsc.connect(ringGain.gain); // modulate the gain param!
source.connect(ringGain);
ringGain.connect(dest);`;

export default function VoiceChanger() {
  const logger = useMemo(() => new Logger(), []);
  const [running, setRunning] = useState(false);
  const [activeEffect, setActiveEffect] = useState<EffectId>('dry');
  const [meterLevel, setMeterLevel] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const localAudioRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const meterRafRef = useRef<number>(0);
  const pcARef = useRef<RTCPeerConnection | null>(null);
  const pcBRef = useRef<RTCPeerConnection | null>(null);
  const connectedRef = useRef(false);
  // Track currently connected effect nodes to disconnect
  const effectNodesRef = useRef<AudioNode[]>([]);
  const lfoRef = useRef<OscillatorNode | null>(null);
  const ringOscRef = useRef<OscillatorNode | null>(null);

  const applyEffect = (id: EffectId) => {
    const ctx = audioCtxRef.current;
    const src = sourceRef.current;
    const dest = destRef.current;
    if (!ctx || !src || !dest) return;

    // Disconnect all previous effect nodes
    effectNodesRef.current.forEach((n) => { try { n.disconnect(); } catch {} });
    effectNodesRef.current = [];
    lfoRef.current?.stop(); lfoRef.current?.disconnect(); lfoRef.current = null;
    ringOscRef.current?.stop(); ringOscRef.current?.disconnect(); ringOscRef.current = null;

    try { src.disconnect(); } catch {}

    const analyser = analyserRef.current!;

    switch (id) {
      case 'dry': {
        src.connect(analyser); analyser.connect(dest.stream ? dest : dest);
        src.connect(dest);
        break;
      }
      case 'echo': {
        const delay = ctx.createDelay(2.0);
        const feedback = ctx.createGain();
        const mix = ctx.createGain();
        delay.delayTime.value = 0.3;
        feedback.gain.value = 0.4;
        mix.gain.value = 0.7;
        src.connect(analyser);
        src.connect(mix);
        src.connect(delay);
        delay.connect(feedback);
        feedback.connect(delay);
        delay.connect(mix);
        mix.connect(dest);
        effectNodesRef.current = [delay, feedback, mix];
        break;
      }
      case 'telephone': {
        const lo = ctx.createBiquadFilter();
        const hi = ctx.createBiquadFilter();
        lo.type = 'highpass'; lo.frequency.value = 400;
        hi.type = 'lowpass'; hi.frequency.value = 3400;
        src.connect(analyser);
        src.connect(lo); lo.connect(hi); hi.connect(dest);
        effectNodesRef.current = [lo, hi];
        break;
      }
      case 'tremolo': {
        const trGain = ctx.createGain();
        const lfo = ctx.createOscillator();
        const lfoGain = ctx.createGain();
        trGain.gain.value = 0.5;
        lfo.frequency.value = 8;
        lfoGain.gain.value = 0.5;
        lfo.connect(lfoGain);
        lfoGain.connect(trGain.gain);
        lfo.start();
        lfoRef.current = lfo;
        src.connect(analyser);
        src.connect(trGain); trGain.connect(dest);
        effectNodesRef.current = [trGain, lfoGain];
        break;
      }
      case 'distortion': {
        const ws = ctx.createWaveShaper();
        const n = 256;
        const curve = new Float32Array(n);
        for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; curve[i] = (Math.PI + 200) * x / (Math.PI + 200 * Math.abs(x)); }
        ws.curve = curve;
        ws.oversample = '4x';
        src.connect(analyser);
        src.connect(ws); ws.connect(dest);
        effectNodesRef.current = [ws];
        break;
      }
      case 'robot': {
        const ringGain = ctx.createGain();
        const ringOsc = ctx.createOscillator();
        ringGain.gain.value = 0;
        ringOsc.frequency.value = 80;
        ringOsc.connect(ringGain.gain);
        ringOsc.start();
        ringOscRef.current = ringOsc;
        src.connect(analyser);
        src.connect(ringGain); ringGain.connect(dest);
        effectNodesRef.current = [ringGain];
        break;
      }
    }
    logger.info(`Effect: ${id}`);
  };

  const selectEffect = (id: EffectId) => {
    setActiveEffect(id);
    if (running) applyEffect(id);
  };

  const meterLoop = () => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(buf);
    const avg = buf.reduce((a, b) => a + b, 0) / buf.length / 255;
    setMeterLevel(avg);
    meterRafRef.current = requestAnimationFrame(meterLoop);
  };

  const start = async () => {
    try {
      logger.info('Requesting microphone...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      sourceRef.current = src;
      const dest = ctx.createMediaStreamDestination();
      destRef.current = dest;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      // Set up WebRTC loopback to hear processed audio
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
        localAudioRef.current = audio;
        logger.success('Loopback active — you can hear your processed voice!');
      };
      const offer = await pcA.createOffer();
      await pcA.setLocalDescription(offer);
      await pcB.setRemoteDescription(offer);
      const answer = await pcB.createAnswer();
      await pcB.setLocalDescription(answer);
      await pcA.setRemoteDescription(answer);
      connectedRef.current = true;

      applyEffect(activeEffect);
      setRunning(true);
      meterRafRef.current = requestAnimationFrame(meterLoop);
      logger.success('Voice changer active!');
    } catch (e) { logger.error(`Microphone error: ${e}`); }
  };

  const stop = () => {
    cancelAnimationFrame(meterRafRef.current);
    lfoRef.current?.stop();
    ringOscRef.current?.stop();
    audioCtxRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    localAudioRef.current?.pause();
    pcARef.current?.close(); pcBRef.current?.close();
    audioCtxRef.current = null; streamRef.current = null;
    setRunning(false); setMeterLevel(0);
    logger.info('Stopped');
  };

  useEffect(() => () => stop(), []);

  return (
    <DemoLayout
      title="Voice Changer"
      difficulty="intermediate"
      description="Apply real-time Web Audio effects to your microphone stream, then hear the result through a WebRTC loopback."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            The <strong>Web Audio API</strong> lets you build a custom signal processing graph
            between a microphone and a speaker. This demo pipes your mic through different
            effect chains — all using built-in browser audio nodes — and streams the result
            through a WebRTC loopback so you hear the processed output.
          </p>
          <ul className="list-disc list-inside space-y-0.5 pl-2">
            <li><strong>Echo</strong> — <code className="text-xs bg-surface-2 px-1 rounded">DelayNode</code> + feedback loop</li>
            <li><strong>Telephone</strong> — highpass (400 Hz) + lowpass (3400 Hz) bandpass simulation</li>
            <li><strong>Tremolo</strong> — LFO-modulated <code className="text-xs bg-surface-2 px-1 rounded">GainNode</code> at 8 Hz</li>
            <li><strong>Distortion</strong> — <code className="text-xs bg-surface-2 px-1 rounded">WaveShaper</code> soft-clip curve</li>
            <li><strong>Robot</strong> — ring modulation (80 Hz oscillator → gain parameter)</li>
          </ul>
          <p className="text-amber-400/80">⚡ Use headphones to avoid mic feedback! The processed audio plays back through the loopback.</p>
        </div>
      }
      hints={[
        'Wear headphones — or the loopback will cause feedback!',
        'Switch effects while speaking to hear the change instantly',
        'Robot mode is ring modulation — a classic AM synthesis technique',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex gap-3">
            {!running ? (
              <button onClick={start} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                🎤 Start Voice Changer
              </button>
            ) : (
              <button onClick={stop} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg">
                Stop
              </button>
            )}
          </div>

          {/* Level meter */}
          {running && (
            <div className="space-y-1">
              <span className="text-xs text-zinc-500">Input Level</span>
              <div className="h-2 bg-surface-0 border border-zinc-800 rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all duration-75 rounded-full" style={{ width: `${meterLevel * 100}%` }} />
              </div>
            </div>
          )}

          {/* Effect picker */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {EFFECTS.map((e) => (
              <button
                key={e.id}
                onClick={() => selectEffect(e.id)}
                className={`p-3 rounded-xl border text-left transition-all ${activeEffect === e.id ? 'border-blue-500 bg-blue-950/40' : 'border-zinc-800 bg-surface-0 hover:border-zinc-600'}`}
              >
                <div className="text-2xl mb-1">{e.emoji}</div>
                <div className="text-sm font-semibold text-zinc-200">{e.label}</div>
                <div className="text-xs text-zinc-500 mt-0.5">{e.description}</div>
              </button>
            ))}
          </div>

          {running && (
            <p className="text-xs text-zinc-500">Active effect: <span className="text-blue-400 font-medium">{EFFECTS.find((e) => e.id === activeEffect)?.label}</span></p>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Web Audio effect chain on live microphone' }}
      mdnLinks={[
        { label: 'Web Audio API', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API' },
        { label: 'WaveShaper', href: 'https://developer.mozilla.org/en-US/docs/Web/API/WaveShaperNode' },
        { label: 'DelayNode', href: 'https://developer.mozilla.org/en-US/docs/Web/API/DelayNode' },
      ]}
    />
  );
}
