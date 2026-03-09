import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const CODE = `// Web MIDI API → RTCDataChannel → Tone.js synthesis
const access = await (navigator as any).requestMIDIAccess();
access.inputs.forEach(input => {
  input.onmidimessage = (msg) => {
    const [status, note, velocity] = msg.data;
    const isNoteOn = (status & 0xf0) === 0x90 && velocity > 0;
    const isNoteOff = (status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && velocity === 0);
    if (isNoteOn || isNoteOff) {
      dc.send(JSON.stringify({ type: isNoteOn ? 'note_on' : 'note_off', note, velocity }));
    }
  };
});

// Receiving peer synthesizes with Tone.js
const Tone = await import('tone');
const synth = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: 'triangle' },
  envelope: { attack: 0.02, decay: 0.1, sustain: 0.5, release: 0.8 },
}).toDestination();

dc.onmessage = (ev) => {
  const { type, note } = JSON.parse(ev.data);
  const noteName = Tone.Frequency(note, 'midi').toNote();
  if (type === 'note_on') synth.triggerAttack(noteName);
  if (type === 'note_off') synth.triggerRelease(noteName);
};`;

// MIDI note range: C3 (48) to F5 (77) = 30 keys
const FIRST_MIDI = 48;
const LAST_MIDI = 77;

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const isBlack = (midi: number) => [1,3,6,8,10].includes(midi % 12);
const midiToName = (midi: number) => {
  const oct = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[midi % 12] + oct;
};

type OscType = 'triangle' | 'square' | 'sawtooth' | 'sine';
const PRESETS: { label: string; type: OscType; reverb: boolean }[] = [
  { label: 'Piano', type: 'triangle', reverb: false },
  { label: 'Organ', type: 'square', reverb: false },
  { label: 'Lead', type: 'sawtooth', reverb: false },
  { label: 'Pad', type: 'sine', reverb: true },
];

interface PianoRollNote {
  note: number;
  startX: number;
  color: string;
}

const NOTE_COLORS = ['#f87171','#fb923c','#facc15','#4ade80','#34d399','#22d3ee','#60a5fa','#a78bfa','#f472b6'];

export default function MIDIJam() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [toneReady, setToneReady] = useState(false);
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [preset, setPreset] = useState(0);
  const [volume, setVolume] = useState(80);
  const [octaveShift, setOctaveShift] = useState(0);
  const [sustain, setSustain] = useState(false);
  const [midiInputs, setMidiInputs] = useState<string[]>([]);
  const [selectedInput, setSelectedInput] = useState('');
  const [midiAvailable, setMidiAvailable] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const synthRef = useRef<unknown>(null);
  const volNodeRef = useRef<unknown>(null);
  const reverbRef = useRef<unknown>(null);
  const midiAccessRef = useRef<unknown>(null);
  const rollCanvasRef = useRef<HTMLCanvasElement>(null);
  const rollNotesRef = useRef<PianoRollNote[]>([]);
  const rollRafRef = useRef<number>(0);
  const sustainedRef = useRef<Set<number>>(new Set());
  const sustainRef = useRef(false);

  // keep sustainRef in sync
  useEffect(() => { sustainRef.current = sustain; }, [sustain]);

  // Piano roll animation
  useEffect(() => {
    const canvas = rollCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const TOTAL_KEYS = LAST_MIDI - FIRST_MIDI + 1;
    const draw = () => {
      rollRafRef.current = requestAnimationFrame(draw);
      ctx.fillStyle = 'rgba(15,15,20,0.25)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Scroll notes left
      rollNotesRef.current = rollNotesRef.current.filter(n => n.startX > -30);
      rollNotesRef.current.forEach(n => {
        n.startX -= 1.5;
        const keyIdx = n.note - FIRST_MIDI;
        const y = canvas.height - ((keyIdx / TOTAL_KEYS) * canvas.height) - 8;
        ctx.fillStyle = n.color;
        ctx.shadowBlur = 6;
        ctx.shadowColor = n.color;
        ctx.fillRect(n.startX, y, 28, 6);
        ctx.shadowBlur = 0;
      });

      // Draw active notes from right
      activeNotes.forEach(n => {
        const keyIdx = n - FIRST_MIDI;
        if (keyIdx < 0 || keyIdx > TOTAL_KEYS) return;
        const y = canvas.height - ((keyIdx / TOTAL_KEYS) * canvas.height) - 8;
        const color = NOTE_COLORS[n % NOTE_COLORS.length];
        ctx.fillStyle = color;
        ctx.shadowBlur = 10;
        ctx.shadowColor = color;
        ctx.fillRect(canvas.width - 6, y, 6, 6);
        ctx.shadowBlur = 0;
      });
    };
    draw();
    return () => { cancelAnimationFrame(rollRafRef.current); };
  }, [activeNotes]);

  const loadTone = useCallback(async () => {
    if (toneReady) return;
    const Tone = await import('tone');
    await Tone.start();
    const vol = new Tone.Volume(volume - 80).toDestination();
    const reverb = new Tone.Reverb({ decay: 3, wet: 0 }).connect(vol);
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: PRESETS[preset].type },
      envelope: { attack: 0.02, decay: 0.1, sustain: 0.5, release: 0.8 },
    }).connect(reverb);
    synthRef.current = synth;
    volNodeRef.current = vol;
    reverbRef.current = reverb;
    setToneReady(true);
    logger.success('Tone.js loaded — synth ready');
  }, [toneReady, volume, preset, logger]);

  const updatePreset = useCallback(async (idx: number) => {
    if (!toneReady || !synthRef.current) return;
    setPreset(idx);
    const Tone = await import('tone');
    const p = PRESETS[idx];
    (synthRef.current as InstanceType<typeof Tone.PolySynth>).set({ oscillator: { type: p.type } });
    const rev = reverbRef.current as InstanceType<typeof Tone.Reverb>;
    rev.set({ wet: p.reverb ? 0.5 : 0 });
    logger.info(`Preset: ${p.label}`);
  }, [toneReady, logger]);

  const updateVolume = useCallback(async (val: number) => {
    setVolume(val);
    if (!volNodeRef.current) return;
    const Tone = await import('tone');
    (volNodeRef.current as InstanceType<typeof Tone.Volume>).volume.value = val - 80;
  }, []);

  const playNote = useCallback(async (midi: number, vel: number) => {
    if (!toneReady) await loadTone();
    const shifted = midi + octaveShift * 12;
    const Tone = await import('tone');
    const noteName = Tone.Frequency(shifted, 'midi').toNote();
    try {
      (synthRef.current as InstanceType<typeof Tone.PolySynth>).triggerAttack(noteName);
    } catch {/* ignore */}
    setActiveNotes(prev => new Set([...prev, midi]));
    const color = NOTE_COLORS[midi % NOTE_COLORS.length];
    rollNotesRef.current.push({ note: midi, startX: (rollCanvasRef.current?.width ?? 560) - 10, color });
    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'note_on', note: shifted, velocity: vel, timestamp: Date.now() }));
    }
  }, [toneReady, loadTone, octaveShift]);

  const releaseNote = useCallback(async (midi: number) => {
    if (sustainRef.current) { sustainedRef.current.add(midi); return; }
    const shifted = midi + octaveShift * 12;
    const Tone = await import('tone');
    const noteName = Tone.Frequency(shifted, 'midi').toNote();
    try {
      (synthRef.current as InstanceType<typeof Tone.PolySynth>).triggerRelease(noteName);
    } catch {/* ignore */}
    setActiveNotes(prev => { const s = new Set(prev); s.delete(midi); return s; });
    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'note_off', note: shifted, velocity: 0, timestamp: Date.now() }));
    }
  }, [octaveShift]);

  const toggleSustain = useCallback(async () => {
    const next = !sustain;
    setSustain(next);
    sustainRef.current = next;
    if (!next) {
      // Release all sustained notes
      const Tone = await import('tone');
      for (const midi of sustainedRef.current) {
        const shifted = midi + octaveShift * 12;
        const noteName = Tone.Frequency(shifted, 'midi').toNote();
        try { (synthRef.current as InstanceType<typeof Tone.PolySynth>).triggerRelease(noteName); } catch {/* ignore */}
        setActiveNotes(prev => { const s = new Set(prev); s.delete(midi); return s; });
      }
      sustainedRef.current.clear();
    }
  }, [sustain, octaveShift]);

  const setupMIDI = useCallback(async () => {
    try {
      const access = await (navigator as unknown as { requestMIDIAccess: () => Promise<unknown> }).requestMIDIAccess();
      midiAccessRef.current = access;
      setMidiAvailable(true);
      const inputs: string[] = [];
      (access as { inputs: Map<string, { name: string; onmidimessage: ((msg: { data: Uint8Array }) => void) | null }> }).inputs.forEach((input) => {
        inputs.push(input.name);
      });
      setMidiInputs(inputs);
      if (inputs.length) setSelectedInput(inputs[0]);
      logger.success(`Web MIDI: ${inputs.length} input(s) found`);

      (access as { inputs: Map<string, { name: string; onmidimessage: ((msg: { data: Uint8Array }) => void) | null }> }).inputs.forEach((input) => {
        input.onmidimessage = async (msg) => {
          const [status, note, velocity] = msg.data;
          const isOn = (status & 0xf0) === 0x90 && velocity > 0;
          const isOff = (status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && velocity === 0);
          const isCC = (status & 0xf0) === 0xb0;
          if (isCC && note === 64) { if (velocity >= 64) setSustain(true); else toggleSustain(); }
          if (isOn) await playNote(note, velocity);
          if (isOff) await releaseNote(note);
        };
      });
    } catch {
      logger.warn('Web MIDI not available or permission denied');
    }
  }, [logger, playNote, releaseNote, toggleSustain]);

  const connectLoopback = useCallback(async () => {
    await loadTone();
    const pc1 = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pc2 = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcRef.current = pc1;

    const dc = pc1.createDataChannel('midi');
    dcRef.current = dc;

    dc.onopen = () => { setConnected(true); logger.success('DataChannel open — loopback connected'); };
    dc.onclose = () => { setConnected(false); logger.info('DataChannel closed'); };

    pc2.ondatachannel = (ev) => {
      const remote = ev.channel;
      remote.onmessage = async (e) => {
        const msg = JSON.parse(e.data) as { type: string; note: number; velocity: number };
        const Tone = await import('tone');
        const noteName = Tone.Frequency(msg.note, 'midi').toNote();
        if (msg.type === 'note_on') {
          try { (synthRef.current as InstanceType<typeof Tone.PolySynth>).triggerAttack(noteName); } catch {/* ignore */}
        } else if (msg.type === 'note_off') {
          try { (synthRef.current as InstanceType<typeof Tone.PolySynth>).triggerRelease(noteName); } catch {/* ignore */}
        }
      };
    };

    pc1.onicecandidate = e => { if (e.candidate) pc2.addIceCandidate(e.candidate); };
    pc2.onicecandidate = e => { if (e.candidate) pc1.addIceCandidate(e.candidate); };

    const offer = await pc1.createOffer();
    await pc1.setLocalDescription(offer);
    await pc2.setRemoteDescription(offer);
    const answer = await pc2.createAnswer();
    await pc2.setLocalDescription(answer);
    await pc1.setRemoteDescription(answer);

    logger.info('Loopback RTCPeerConnection established');
  }, [loadTone, logger]);

  const disconnect = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    pcRef.current = null;
    dcRef.current = null;
    setConnected(false);
    logger.info('Disconnected');
  }, [logger]);

  // Cleanup
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rollRafRef.current);
      dcRef.current?.close();
      pcRef.current?.close();
    };
  }, []);

  // Build piano keys
  const whiteKeys: number[] = [];
  const blackKeys: number[] = [];
  for (let m = FIRST_MIDI; m <= LAST_MIDI; m++) {
    if (isBlack(m)) blackKeys.push(m);
    else whiteKeys.push(m);
  }
  const whiteWidth = 100 / whiteKeys.length;

  return (
    <DemoLayout
      title="MIDI Jam"
      difficulty="advanced"
      description="Play MIDI keyboard or on-screen piano. Notes transmit over RTCDataChannel and synthesize with Tone.js on the other peer."
      explanation={
        <div className="space-y-3 text-sm">
          <p>The <strong>Web MIDI API</strong> exposes hardware MIDI devices (keyboards, controllers, drum pads) directly to the browser. Each MIDI message is a compact 3-byte packet: status byte (note on/off + channel), note number (0–127), and velocity (0–127).</p>
          <p>These tiny packets (3 bytes each) travel through an <strong>RTCDataChannel</strong> with near-zero latency. The receiving peer uses <strong>Tone.js PolySynth</strong> to synthesize audio locally — zero audio bandwidth required!</p>
          <p>If no MIDI hardware is available, the on-screen piano lets you play with mouse clicks. The piano roll canvas visualizes recent notes scrolling from right to left.</p>
        </div>
      }
      demo={
        <div className="space-y-4">
          {/* Controls bar */}
          <div className="flex flex-wrap items-center gap-3">
            {!connected ? (
              <button
                onClick={connectLoopback}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg"
              >
                Connect Loopback
              </button>
            ) : (
              <button
                onClick={disconnect}
                className="px-4 py-2 bg-red-700 hover:bg-red-600 text-white text-sm font-medium rounded-lg"
              >
                Disconnect
              </button>
            )}
            <button
              onClick={setupMIDI}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium rounded-lg"
            >
              {midiAvailable ? `MIDI: ${midiInputs.length} device(s)` : 'Detect MIDI'}
            </button>
            <span className={`text-xs px-2 py-1 rounded-full font-medium ${connected ? 'bg-green-900 text-green-300' : 'bg-zinc-800 text-zinc-400'}`}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          {/* MIDI input selector */}
          {midiAvailable && midiInputs.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-400">MIDI Input:</label>
              <select
                value={selectedInput}
                onChange={e => setSelectedInput(e.target.value)}
                className="text-xs bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-zinc-200"
              >
                {midiInputs.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          )}

          {/* Instrument presets */}
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p, i) => (
              <button
                key={p.label}
                onClick={() => updatePreset(i)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${preset === i ? 'bg-purple-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Secondary controls */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Octave:</span>
              <button onClick={() => setOctaveShift(o => Math.max(-2, o - 1))} className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-200">−</button>
              <span className="text-xs text-zinc-200 w-6 text-center">{octaveShift >= 0 ? '+' : ''}{octaveShift}</span>
              <button onClick={() => setOctaveShift(o => Math.min(2, o + 1))} className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-200">+</button>
            </div>
            <button
              onMouseDown={toggleSustain}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${sustain ? 'bg-amber-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'}`}
            >
              {sustain ? 'Sustain ON' : 'Sustain'}
            </button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Vol:</span>
              <input
                type="range" min={0} max={100} value={volume}
                onChange={e => updateVolume(Number(e.target.value))}
                className="w-24 accent-blue-500"
              />
              <span className="text-xs text-zinc-400">{volume}%</span>
            </div>
          </div>

          {/* Piano Roll */}
          <div className="rounded-lg overflow-hidden border border-zinc-800">
            <div className="text-xs text-zinc-500 px-2 py-1 bg-zinc-900">Piano Roll</div>
            <canvas
              ref={rollCanvasRef}
              width={560}
              height={100}
              className="w-full bg-zinc-950 block"
              style={{ imageRendering: 'pixelated' }}
            />
          </div>

          {/* On-screen piano */}
          <div className="rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900 p-2">
            <div className="text-xs text-zinc-500 mb-2">On-Screen Piano (C3 – F5) — click or tap to play</div>
            <div className="relative select-none" style={{ height: '80px' }}>
              {/* White keys */}
              {whiteKeys.map((midi, i) => {
                const isActive = activeNotes.has(midi);
                return (
                  <div
                    key={midi}
                    title={midiToName(midi)}
                    onMouseDown={() => playNote(midi, 100)}
                    onMouseUp={() => releaseNote(midi)}
                    onMouseLeave={() => { if (activeNotes.has(midi)) releaseNote(midi); }}
                    style={{
                      position: 'absolute',
                      left: `${i * whiteWidth}%`,
                      width: `${whiteWidth - 0.3}%`,
                      top: 0,
                      height: '100%',
                      cursor: 'pointer',
                    }}
                    className={`rounded-b border border-zinc-400 transition-colors ${isActive ? 'bg-blue-400' : 'bg-white hover:bg-zinc-100'}`}
                  />
                );
              })}
              {/* Black keys */}
              {(() => {
                let whiteIdx = 0;
                return Array.from({ length: LAST_MIDI - FIRST_MIDI + 1 }, (_, i) => {
                  const midi = FIRST_MIDI + i;
                  if (!isBlack(midi)) { whiteIdx++; return null; }
                  const leftWhiteIdx = whiteIdx - 1;
                  const isActive = activeNotes.has(midi);
                  return (
                    <div
                      key={midi}
                      title={midiToName(midi)}
                      onMouseDown={e => { e.stopPropagation(); playNote(midi, 100); }}
                      onMouseUp={e => { e.stopPropagation(); releaseNote(midi); }}
                      onMouseLeave={() => { if (activeNotes.has(midi)) releaseNote(midi); }}
                      style={{
                        position: 'absolute',
                        left: `${(leftWhiteIdx + 0.65) * whiteWidth}%`,
                        width: `${whiteWidth * 0.65}%`,
                        top: 0,
                        height: '58%',
                        zIndex: 10,
                        cursor: 'pointer',
                      }}
                      className={`rounded-b transition-colors ${isActive ? 'bg-purple-500' : 'bg-zinc-900 hover:bg-zinc-700'} border border-zinc-600`}
                    />
                  );
                });
              })()}
            </div>
          </div>

          {/* Active notes display */}
          {activeNotes.size > 0 && (
            <div className="flex flex-wrap gap-1">
              {[...activeNotes].map(n => (
                <span key={n} className="text-xs px-2 py-0.5 bg-purple-900 text-purple-200 rounded-full font-mono">
                  {midiToName(n + octaveShift * 12)}
                </span>
              ))}
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'MIDI → DataChannel → Tone.js' }}
      hints={[
        'Web MIDI API requires a secure context (HTTPS or localhost)',
        'Note-on with velocity=0 is treated as note-off by many MIDI devices',
        'The loopback means your notes travel through WebRTC before synthesis — same pipeline as remote!',
        'Sustain pedal (CC#64) is also transmitted over the DataChannel',
      ]}
      mdnLinks={[
        { label: 'Web MIDI API', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_MIDI_API' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
        { label: 'Tone.js PolySynth', href: 'https://tonejs.github.io/docs/latest/PolySynth' },
      ]}
    />
  );
}
