import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const PADS = [
  { id: 'kick',  label: 'Kick',      key: 'Q', color: 'bg-rose-600',    hover: 'hover:bg-rose-500',    synth: 'membrane', note: 'C1',  dur: '8n' },
  { id: 'snare', label: 'Snare',     key: 'W', color: 'bg-amber-600',   hover: 'hover:bg-amber-500',   synth: 'noise-w',  note: '',    dur: '8n' },
  { id: 'hihat', label: 'Hi-Hat',    key: 'E', color: 'bg-emerald-600', hover: 'hover:bg-emerald-500', synth: 'metal',    note: 'F#4', dur: '16n' },
  { id: 'tom1',  label: 'Tom Hi',    key: 'A', color: 'bg-blue-600',    hover: 'hover:bg-blue-500',    synth: 'membrane', note: 'G2',  dur: '8n' },
  { id: 'clap',  label: 'Clap',      key: 'S', color: 'bg-violet-600',  hover: 'hover:bg-violet-500',  synth: 'noise-p',  note: '',    dur: '16n' },
  { id: 'tom2',  label: 'Tom Lo',    key: 'D', color: 'bg-cyan-600',    hover: 'hover:bg-cyan-500',    synth: 'membrane', note: 'D2',  dur: '8n' },
  { id: 'crash', label: 'Crash',     key: 'Z', color: 'bg-yellow-600',  hover: 'hover:bg-yellow-500',  synth: 'metal',    note: 'C5',  dur: '2n' },
  { id: 'rim',   label: 'Rimshot',   key: 'X', color: 'bg-pink-600',    hover: 'hover:bg-pink-500',    synth: 'noise-w',  note: '',    dur: '32n' },
  { id: 'openHH',label: 'Open Hat',  key: 'C', color: 'bg-indigo-600',  hover: 'hover:bg-indigo-500',  synth: 'metal',    note: 'A4',  dur: '8n' },
];

const CODE = `// Drum pad: Tone.js instruments + audio stream + DataChannel pad sync
import * as Tone from 'tone';

const kick  = new Tone.MembraneSynth().toDestination();
const snare = new Tone.NoiseSynth({ noise: { type: 'white' } }).toDestination();
const hihat = new Tone.MetalSynth().toDestination();

// Stream audio via WebRTC
const dest = Tone.context.createMediaStreamDestination();
[kick, snare, hihat].forEach(s => s.connect(dest));
dest.stream.getTracks().forEach(t => pc.addTrack(t, dest.stream));

// Sync pad hits over DataChannel so peer "sees" what you're playing
function hitPad(id) {
  instruments[id].triggerAttackRelease(...);
  dc.send(JSON.stringify({ type: 'hit', id }));
}

// Visual feedback on remote peer
dc.onmessage = ({ data }) => {
  const { id } = JSON.parse(data);
  flashPad(id); // show which pad the peer hit
};`;

export default function DrumPad() {
  const logger = useMemo(() => new Logger(), []);
  const [active, setActive] = useState(false);
  const [connected, setConnected] = useState(false);
  const [flashing, setFlashing] = useState<Set<string>>(new Set());
  const [remoteFlashing, setRemoteFlashing] = useState<Set<string>>(new Set());
  const instruments = useRef<Map<string, { triggerAttackRelease: (note: string | string[], dur: string) => void }>>(new Map());
  const dcRef = useRef<RTCDataChannel | null>(null);

  const flashPad = (id: string, remote = false) => {
    if (remote) {
      setRemoteFlashing(s => { const n = new Set(s); n.add(id); return n; });
      setTimeout(() => setRemoteFlashing(s => { const n = new Set(s); n.delete(id); return n; }), 150);
    } else {
      setFlashing(s => { const n = new Set(s); n.add(id); return n; });
      setTimeout(() => setFlashing(s => { const n = new Set(s); n.delete(id); return n; }), 150);
    }
  };

  const start = async () => {
    const Tone = await import('tone');
    await Tone.start();
    const dest = Tone.context.createMediaStreamDestination();

    const make = (pad: typeof PADS[0]) => {
      if (pad.synth === 'membrane') {
        const s = new Tone.MembraneSynth({ pitchDecay: 0.04, octaves: 8, envelope: { attack: 0.001, decay: 0.2, sustain: 0 } }).toDestination();
        s.connect(dest);
        return { triggerAttackRelease: (n: string | string[], d: string) => s.triggerAttackRelease(n as string, d) };
      } else if (pad.synth === 'metal') {
        const s = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: pad.id.includes('crash') ? 0.8 : 0.08, release: 0.01 } }).toDestination();
        s.connect(dest);
        return { triggerAttackRelease: (n: string | string[], d: string) => s.triggerAttackRelease(n as string, d) };
      } else {
        const type = pad.synth === 'noise-p' ? 'pink' as const : 'white' as const;
        const s = new Tone.NoiseSynth({ noise: { type }, envelope: { attack: 0.001, decay: pad.id === 'clap' ? 0.1 : 0.04, sustain: 0 } }).toDestination();
        s.connect(dest);
        return { triggerAttackRelease: (_n: string | string[], d: string) => s.triggerAttackRelease(d) };
      }
    };

    PADS.forEach(p => instruments.current.set(p.id, make(p)));

    // WebRTC loopback
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = ev => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = ev => ev.candidate && pcA.addIceCandidate(ev.candidate);
    dest.stream.getTracks().forEach(t => pcA.addTrack(t, dest.stream));
    const dc = pcA.createDataChannel('drumpad');
    dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Pad sync connected!'); };
    pcB.ontrack = ev => {
      const audio = new Audio(); audio.srcObject = ev.streams[0]; audio.play().catch(() => {});
    };
    pcB.ondatachannel = ev => {
      ev.channel.onmessage = e => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'hit') flashPad(msg.id, true);
      };
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);

    setActive(true);
    logger.success('Drum pad ready! Q W E / A S D / Z X C or click pads');
  };

  const hitPad = (padId: string) => {
    const pad = PADS.find(p => p.id === padId);
    const inst = instruments.current.get(padId);
    if (!pad || !inst) return;
    inst.triggerAttackRelease(pad.note || 'C4', pad.dur);
    flashPad(padId);
    if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'hit', id: padId }));
  };

  // Keyboard handler
  const handleKey = (e: React.KeyboardEvent) => {
    const pad = PADS.find(p => p.key === e.key.toUpperCase());
    if (pad && active) hitPad(pad.id);
  };

  return (
    <DemoLayout
      title="Drum Pad"
      difficulty="beginner"
      description="A 9-pad drum machine with Tone.js — audio streams over WebRTC while pad hits sync to peers via DataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Each pad uses a different <strong>Tone.js</strong> synthesis engine:{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">MembraneSynth</code> for deep
            kicks/toms, <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">NoiseSynth</code>
            for snares/claps, and <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">MetalSynth</code>
            for hi-hats and cymbals. All synths route through a shared{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">MediaStreamDestination</code>
            that's sent over WebRTC.
          </p>
          <p>
            Each pad hit also sends a <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">{`{type:'hit', id}`}</code>
            message over a DataChannel. The receiving peer's pad grid visually flashes to show
            which drum was hit — you can <em>see</em> the beat even if you muted the audio.
          </p>
        </div>
      }
      hints={[
        'Keyboard shortcuts: Q W E (top row) · A S D (middle) · Z X C (bottom)',
        'Blue glow = your hits · Orange glow = peer hits received via DataChannel',
        'Use headphones — the loopback will cause echo through speakers!',
      ]}
      demo={
        <div className="space-y-4" onKeyDown={handleKey} tabIndex={0} style={{ outline: 'none' }}>
          {!active ? (
            <button onClick={start} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold rounded-lg">
              🥁 Load Drum Kit
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <span className="text-xs text-zinc-500">Kit ready · {connected ? '🔗 Sync on' : '⏳ Connecting…'}</span>
              <div className="flex items-center gap-2 text-xs text-zinc-600">
                <span className="w-3 h-3 rounded-full bg-blue-500/60 inline-block" /> you
                <span className="w-3 h-3 rounded-full bg-orange-500/60 inline-block ml-1" /> peer
              </div>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2">
            {PADS.map(pad => {
              const isFlashing = flashing.has(pad.id);
              const isRemote = remoteFlashing.has(pad.id);
              return (
                <button
                  key={pad.id}
                  onClick={() => active && hitPad(pad.id)}
                  disabled={!active}
                  className={`h-24 rounded-2xl text-white font-bold flex flex-col items-center justify-center gap-1 transition-all duration-75 disabled:opacity-40 active:scale-95
                    ${isFlashing ? `${pad.color} scale-100 shadow-lg shadow-white/20` : isRemote ? 'bg-orange-600 scale-100' : `${pad.color} ${pad.hover} opacity-80 scale-100 hover:scale-105`}`}
                >
                  <span className="text-2xl">{pad.id === 'kick' ? '🥁' : pad.id === 'snare' ? '🪘' : pad.id === 'hihat' ? '🎩' : pad.id === 'clap' ? '👏' : pad.id === 'crash' ? '💥' : pad.id === 'rim' ? '🎯' : pad.id === 'openHH' ? '🎵' : '🔔'}</span>
                  <span className="text-xs font-semibold">{pad.label}</span>
                  <span className="text-xs opacity-60 font-mono">[{pad.key}]</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-zinc-600 text-center">Click pads or press keyboard keys · Tab to focus for keyboard input</p>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Tone.js drum kit + audio stream + DataChannel pad sync' }}
      mdnLinks={[
        { label: 'Tone.js', href: 'https://tonejs.github.io/' },
        { label: 'MembraneSynth', href: 'https://tonejs.github.io/docs/15.0.4/classes/MembraneSynth.html' },
      ]}
    />
  );
}
