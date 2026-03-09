import Meyda from 'meyda';
import { useMemo, useRef, useState } from 'react';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';

type Waveform = OscillatorType;

interface AudioFeatures {
  rms: number;
  zcr: number;
  spectralCentroid: number;
  spectralFlatness: number;
}

const CODE = `const destination = audioContext.createMediaStreamDestination();
oscillator.connect(filter).connect(gain).connect(destination);

pcA.addTrack(destination.stream.getAudioTracks()[0], destination.stream);

const analyzer = Meyda.createMeydaAnalyzer({
  audioContext,
  source: audioContext.createMediaStreamSource(remoteStream),
  featureExtractors: ['rms', 'zcr', 'spectralCentroid', 'spectralFlatness'],
});`;

export default function AudioFeatureMirror() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [waveform, setWaveform] = useState<Waveform>('sine');
  const [frequency, setFrequency] = useState(220);
  const [filterCutoff, setFilterCutoff] = useState(900);
  const [gainValue, setGainValue] = useState(0.18);
  const [features, setFeatures] = useState<AudioFeatures>({
    rms: 0,
    zcr: 0,
    spectralCentroid: 0,
    spectralFlatness: 0,
  });

  const ctxRef = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);
  const filterRef = useRef<BiquadFilterNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const analyzerRef = useRef<{ start: () => void; stop: () => void } | null>(null);
  const pcARef = useRef<RTCPeerConnection | null>(null);
  const pcBRef = useRef<RTCPeerConnection | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  const cleanup = () => {
    analyzerRef.current?.stop();
    analyzerRef.current = null;
    oscillatorRef.current?.stop();
    oscillatorRef.current = null;
    filterRef.current = null;
    gainRef.current = null;
    pcARef.current?.close();
    pcBRef.current?.close();
    pcARef.current = null;
    pcBRef.current = null;
    void ctxRef.current?.close();
    ctxRef.current = null;
    setConnected(false);
  };

  const connect = async () => {
    cleanup();

    const audioContext = new AudioContext();
    await audioContext.resume();

    const oscillator = audioContext.createOscillator();
    oscillator.type = waveform;
    oscillator.frequency.value = frequency;

    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterCutoff;

    const gain = audioContext.createGain();
    gain.gain.value = gainValue;

    const destination = audioContext.createMediaStreamDestination();
    const monitor = audioContext.createGain();
    monitor.gain.value = 0.15;

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    gain.connect(monitor);
    monitor.connect(audioContext.destination);
    oscillator.start();

    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcARef.current = pcA;
    pcBRef.current = pcB;

    pcA.onicecandidate = (event) => {
      if (event.candidate) void pcB.addIceCandidate(event.candidate);
    };
    pcB.onicecandidate = (event) => {
      if (event.candidate) void pcA.addIceCandidate(event.candidate);
    };

    destination.stream.getTracks().forEach((track) => pcA.addTrack(track, destination.stream));

    pcB.ontrack = (event) => {
      const remoteStream = event.streams[0];
      if (!remoteStream) return;

      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
        void remoteAudioRef.current.play().catch(() => undefined);
      }

      const source = audioContext.createMediaStreamSource(remoteStream);
      const silent = audioContext.createGain();
      silent.gain.value = 0;
      source.connect(silent);
      silent.connect(audioContext.destination);

      analyzerRef.current?.stop();
      analyzerRef.current = Meyda.createMeydaAnalyzer({
        audioContext,
        source,
        bufferSize: 1024,
        featureExtractors: ['rms', 'zcr', 'spectralCentroid', 'spectralFlatness'],
        callback: (nextFeatures: Partial<AudioFeatures>) => {
          setFeatures({
            rms: nextFeatures.rms ?? 0,
            zcr: nextFeatures.zcr ?? 0,
            spectralCentroid: nextFeatures.spectralCentroid ?? 0,
            spectralFlatness: nextFeatures.spectralFlatness ?? 0,
          });
        },
      }) as { start: () => void; stop: () => void };
      analyzerRef.current.start();
      logger.success('Remote stream connected to Meyda analyzer');
    };

    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);

    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);

    ctxRef.current = audioContext;
    oscillatorRef.current = oscillator;
    filterRef.current = filter;
    gainRef.current = gain;
    setConnected(true);
    logger.success('Audio feature mirror connected');
  };

  const updateWaveform = (next: Waveform) => {
    setWaveform(next);
    if (oscillatorRef.current) {
      oscillatorRef.current.type = next;
    }
  };

  const updateFrequency = (next: number) => {
    setFrequency(next);
    oscillatorRef.current?.frequency.setTargetAtTime(next, ctxRef.current?.currentTime ?? 0, 0.02);
  };

  const updateFilter = (next: number) => {
    setFilterCutoff(next);
    filterRef.current?.frequency.setTargetAtTime(next, ctxRef.current?.currentTime ?? 0, 0.02);
  };

  const updateGain = (next: number) => {
    setGainValue(next);
    gainRef.current?.gain.setTargetAtTime(next, ctxRef.current?.currentTime ?? 0, 0.02);
  };

  return (
    <DemoLayout
      title="Audio Feature Mirror"
      difficulty="advanced"
      description="Generate synthetic audio, loop it through WebRTC, and inspect the remote stream with Meyda feature extraction."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This playground skips microphone permissions and synthesizes its own tone graph. The audio
            crosses a loopback WebRTC connection, then the far side analyzes the received stream with
            <strong> Meyda</strong>.
          </p>
          <p>
            The result is a compact lab for understanding how timbre and filtering change measurable features
            like RMS, zero-crossing rate, spectral centroid, and spectral flatness.
          </p>
        </div>
      }
      hints={[
        'Square waves push the zero-crossing and brightness metrics much harder than sine waves.',
        'Dragging the low-pass filter down should drop spectral centroid immediately.',
        'The analyzer reads the remote WebRTC stream, not the local oscillator node directly.',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <button
                onClick={connect}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Start audio mirror
              </button>
            ) : (
              <button
                onClick={cleanup}
                className="rounded-xl bg-surface-2 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-surface-3"
              >
                Stop mirror
              </button>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <section className="space-y-4 rounded-3xl border border-zinc-800 bg-surface-0 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Synthesis desk</p>
              <label className="space-y-1 text-xs text-zinc-400">
                Waveform
                <select
                  value={waveform}
                  onChange={(event) => updateWaveform(event.target.value as Waveform)}
                  className="w-full rounded-xl border border-zinc-800 bg-surface-1 px-3 py-2 text-sm text-zinc-200 outline-none"
                >
                  <option value="sine">sine</option>
                  <option value="square">square</option>
                  <option value="sawtooth">sawtooth</option>
                  <option value="triangle">triangle</option>
                </select>
              </label>

              <label className="space-y-1 text-xs text-zinc-400">
                Frequency {frequency.toFixed(0)} Hz
                <input
                  type="range"
                  min={80}
                  max={1200}
                  value={frequency}
                  onChange={(event) => updateFrequency(Number(event.target.value))}
                  className="w-full accent-blue-400"
                />
              </label>

              <label className="space-y-1 text-xs text-zinc-400">
                Filter cutoff {filterCutoff.toFixed(0)} Hz
                <input
                  type="range"
                  min={120}
                  max={4000}
                  value={filterCutoff}
                  onChange={(event) => updateFilter(Number(event.target.value))}
                  className="w-full accent-blue-400"
                />
              </label>

              <label className="space-y-1 text-xs text-zinc-400">
                Gain {(gainValue * 100).toFixed(0)}%
                <input
                  type="range"
                  min={0.05}
                  max={0.35}
                  step={0.01}
                  value={gainValue}
                  onChange={(event) => updateGain(Number(event.target.value))}
                  className="w-full accent-blue-400"
                />
              </label>
            </section>

            <section className="space-y-4 rounded-3xl border border-zinc-800 bg-surface-0 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">Remote analyzer</p>
              <audio ref={remoteAudioRef} autoPlay className="hidden" />
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-surface-1 p-4">
                  <p className="text-xs text-zinc-500">RMS</p>
                  <p className="mt-1 text-2xl font-semibold text-zinc-100">{features.rms.toFixed(3)}</p>
                </div>
                <div className="rounded-2xl bg-surface-1 p-4">
                  <p className="text-xs text-zinc-500">Zero-crossing</p>
                  <p className="mt-1 text-2xl font-semibold text-zinc-100">{features.zcr.toFixed(3)}</p>
                </div>
                <div className="rounded-2xl bg-surface-1 p-4">
                  <p className="text-xs text-zinc-500">Centroid</p>
                  <p className="mt-1 text-2xl font-semibold text-zinc-100">{features.spectralCentroid.toFixed(0)}</p>
                </div>
                <div className="rounded-2xl bg-surface-1 p-4">
                  <p className="text-xs text-zinc-500">Flatness</p>
                  <p className="mt-1 text-2xl font-semibold text-zinc-100">{features.spectralFlatness.toFixed(3)}</p>
                </div>
              </div>
              <div className="rounded-2xl border border-zinc-800 bg-black/20 p-4 text-xs text-zinc-400">
                Meyda is listening to the received WebRTC audio track. Shape the source signal on the left and
                watch the extracted features respond in real time.
              </div>
            </section>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Remote audio feature extraction with Meyda' }}
      mdnLinks={[
        { label: 'RTCPeerConnection.addTrack()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addTrack' },
        { label: 'MediaStreamAudioDestinationNode', href: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamAudioDestinationNode' },
      ]}
    />
  );
}
