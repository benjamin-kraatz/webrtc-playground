import { useMemo, useRef, useState, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

const STEPS = 16;
const TRACKS = [
  { id: 'kick',  label: 'Kick',  color: 'bg-rose-500',    note: 'C1',  synth: 'membrane' as const },
  { id: 'snare', label: 'Snare', color: 'bg-amber-500',   note: 'D1',  synth: 'noise' as const },
  { id: 'hihat', label: 'Hi-Hat', color: 'bg-emerald-500', note: 'F#1', synth: 'metal' as const },
  { id: 'clap',  label: 'Clap',  color: 'bg-blue-500',    note: 'E1',  synth: 'noise' as const },
];

type Grid = { [key: string]: boolean[] };

const makeEmptyGrid = (): Grid =>
  Object.fromEntries(TRACKS.map((t) => [t.id, Array(STEPS).fill(false)]));

const CODE = `// Tone.js drum sequencer + DataChannel grid sync
import * as Tone from 'tone';

const kick  = new Tone.MembraneSynth().toDestination();
const snare = new Tone.NoiseSynth({ noise: { type: 'white' } }).toDestination();
const hihat = new Tone.MetalSynth({ frequency: 400, envelope: { decay: 0.04 } }).toDestination();

// 16-step sequencer
Tone.Transport.scheduleRepeat((time) => {
  if (grid.kick[currentStep])  kick.triggerAttackRelease('C1', '8n', time);
  if (grid.snare[currentStep]) snare.triggerAttackRelease('8n', time);
  if (grid.hihat[currentStep]) hihat.triggerAttackRelease('C4', '16n', time);
  currentStep = (currentStep + 1) % 16;
}, '16n');

// Sync grid changes over DataChannel
dc.onmessage = ({ data }) => {
  const { track, step, on } = JSON.parse(data);
  grid[track][step] = on;           // remote peer updated a step
};
dc.send(JSON.stringify({ track, step, on })); // local toggle`;

export default function BeatMachine() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [roomId, setRoomId] = useState('BEAT01');
  const [joined, setJoined] = useState(false);
  const [bpm, setBpm] = useState(120);
  const [playing, setPlaying] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [grid, setGrid] = useState<Grid>(makeEmptyGrid);
  const toneRef = useRef<{ kick: unknown; snare: unknown; hihat: unknown; clap: unknown } | null>(null);
  const transportRef = useRef<unknown>(null);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const dataChannels = useRef(new Map<string, RTCDataChannel>());
  const gridRef = useRef<Grid>(makeEmptyGrid());
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const broadcast = (msg: object) => {
    const s = JSON.stringify(msg);
    dataChannels.current.forEach((dc) => { if (dc.readyState === 'open') dc.send(s); });
  };

  const toggleStep = (trackId: string, step: number) => {
    setGrid((prev) => {
      const next = { ...prev, [trackId]: [...prev[trackId]] };
      next[trackId][step] = !next[trackId][step];
      gridRef.current = next;
      broadcast({ type: 'step', track: trackId, step, on: next[trackId][step] });
      return next;
    });
  };

  const setupDc = (dc: RTCDataChannel, remotePeerId: string) => {
    dataChannels.current.set(remotePeerId, dc);
    dc.onopen = () => logger.success(`Beat channel open with ${remotePeerId}`);
    dc.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'step') {
        setGrid((prev) => {
          const track = msg.track as string;
          const next: Grid = { ...prev, [track]: [...(prev[track] ?? Array(STEPS).fill(false))] };
          next[track][msg.step as number] = msg.on as boolean;
          gridRef.current = next;
          return next;
        });
      }
      if (msg.type === 'bpm') {
        setBpm(msg.bpm);
        if (transportRef.current) {
          const T = transportRef.current as { bpm: { value: number } };
          T.bpm.value = msg.bpm;
        }
      }
    };
  };

  const createPc = useCallback((remotePeerId: string) => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    peerConnections.current.set(remotePeerId, pc);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) sendRef.current({ type: 'ice-candidate', from: peerId, to: remotePeerId, candidate: ev.candidate.toJSON() });
    };
    pc.ondatachannel = (ev) => setupDc(ev.channel, remotePeerId);
    return pc;
  }, [peerId]);

  const { connect, join, send } = useSignaling({
    logger,
    onMessage: useCallback(async (msg: SignalingMessage) => {
      switch (msg.type) {
        case 'peer-list': {
          for (const peer of msg.peers) {
            const pc = createPc(peer.peerId);
            const dc = pc.createDataChannel('beat');
            setupDc(dc, peer.peerId);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendRef.current({ type: 'offer', from: peerId, to: peer.peerId, sdp: offer });
          }
          break;
        }
        case 'offer': {
          const pc = createPc(msg.from);
          await pc.setRemoteDescription(msg.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendRef.current({ type: 'answer', from: peerId, to: msg.from, sdp: answer });
          break;
        }
        case 'answer': {
          await peerConnections.current.get(msg.from)?.setRemoteDescription(msg.sdp);
          break;
        }
        case 'ice-candidate': {
          await peerConnections.current.get(msg.from)?.addIceCandidate(msg.candidate).catch(console.warn);
          break;
        }
      }
    }, [createPc, peerId]),
  });
  sendRef.current = send;

  const handleJoin = async () => {
    logger.info('Loading Tone.js...');
    const Tone = await import('tone');
    await Tone.start();
    type TAR1 = { triggerAttackRelease: (note: string, duration: string, time: number) => void };
    type TAR2 = { triggerAttackRelease: (duration: string, time: number) => void };

    const kick = new Tone.MembraneSynth({ pitchDecay: 0.05, octaves: 8, envelope: { attack: 0.001, decay: 0.3, sustain: 0 } }).toDestination();
    const snare = new Tone.NoiseSynth({ noise: { type: 'white' as const }, envelope: { attack: 0.001, decay: 0.15, sustain: 0 } }).toDestination();
    const hihat = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 0.04, release: 0.01 } }).toDestination();
    const clap = new Tone.NoiseSynth({ noise: { type: 'pink' as const }, envelope: { attack: 0.005, decay: 0.1, sustain: 0 } }).toDestination();
    toneRef.current = { kick, snare, hihat, clap };
    transportRef.current = Tone.Transport;
    Tone.Transport.bpm.value = bpm;

    let step = 0;
    Tone.Transport.scheduleRepeat((time: number) => {
      const g = gridRef.current;
      const synths = toneRef.current!;
      if (g['kick'][step])  (synths.kick as unknown as TAR1).triggerAttackRelease('C1', '8n', time);
      if (g['snare'][step]) (synths.snare as unknown as TAR2).triggerAttackRelease('8n', time);
      if (g['hihat'][step]) (synths.hihat as unknown as TAR1).triggerAttackRelease('C4', '16n', time);
      if (g['clap'][step])  (synths.clap as unknown as TAR2).triggerAttackRelease('8n', time);
      setCurrentStep(step);
      step = (step + 1) % STEPS;
    }, '16n');

    connect();
    setTimeout(() => { join(roomId, peerId); setJoined(true); }, 500);
    logger.success(`Joined beat room ${roomId}`);
  };

  const handlePlayStop = async () => {
    const Tone = await import('tone');
    if (!playing) {
      Tone.Transport.start();
      setPlaying(true);
      logger.info('Transport started');
    } else {
      Tone.Transport.stop();
      setPlaying(false);
      setCurrentStep(-1);
      logger.info('Transport stopped');
    }
  };

  const handleBpmChange = async (newBpm: number) => {
    setBpm(newBpm);
    if (transportRef.current) {
      const T = transportRef.current as { bpm: { value: number } };
      T.bpm.value = newBpm;
    }
    broadcast({ type: 'bpm', bpm: newBpm });
  };

  const handleLeave = async () => {
    const Tone = await import('tone');
    Tone.Transport.stop();
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    dataChannels.current.clear();
    setJoined(false);
    setPlaying(false);
    setCurrentStep(-1);
    setGrid(makeEmptyGrid());
    gridRef.current = makeEmptyGrid();
    toneRef.current = null;
  };

  const clearGrid = () => {
    const empty = makeEmptyGrid();
    setGrid(empty);
    gridRef.current = empty;
    broadcast({ type: 'clear' });
  };

  const loadPreset = () => {
    const preset = makeEmptyGrid();
    preset.kick  = [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0].map(Boolean);
    preset.snare = [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0].map(Boolean);
    preset.hihat = [1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0].map(Boolean);
    preset.clap  = [0,0,0,0,1,0,0,1,0,0,0,0,1,0,1,0].map(Boolean);
    setGrid(preset);
    gridRef.current = preset;
    broadcast({ type: 'grid', grid: preset });
  };

  return (
    <DemoLayout
      title="Collaborative Beat Machine"
      difficulty="advanced"
      description="Build beats together — a 16-step drum sequencer powered by Tone.js, synced over RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>Tone.js</strong> provides a precise Web Audio sequencer engine.
            Each step toggle sends a tiny JSON event over <strong>RTCDataChannel</strong> so
            all peers in the room hear and see the same beat in real time — sub-millisecond
            latency with zero server relay.
          </p>
          <p>
            The four instruments — Kick (<code className="text-xs bg-surface-2 px-1 py-0.5 rounded">MembraneSynth</code>),
            Snare & Clap (<code className="text-xs bg-surface-2 px-1 py-0.5 rounded">NoiseSynth</code>),
            and Hi-Hat (<code className="text-xs bg-surface-2 px-1 py-0.5 rounded">MetalSynth</code>) — are all
            generated purely in the browser with no audio samples.
          </p>
          <p className="text-amber-400/80">⚡ Requires the signaling server. Open multiple tabs with the same room code.</p>
        </div>
      }
      hints={[
        'Open two tabs with the same room code — beat changes sync instantly',
        'Hit Load Preset for a funky starting groove',
        'BPM changes broadcast to all peers in the room',
      ]}
      demo={
        <div className="space-y-5">
          {/* Room join */}
          <div className="flex flex-wrap gap-3 items-center">
            <input value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={joined}
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-zinc-200 w-28 focus:outline-none disabled:opacity-50" />
            {!joined ? (
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">Join Room</button>
            ) : (
              <button onClick={handleLeave} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">Leave</button>
            )}
          </div>

          {/* Transport controls */}
          <div className="flex flex-wrap gap-3 items-center">
            <button onClick={handlePlayStop} disabled={!joined}
              className={`px-5 py-2 text-white text-sm font-bold rounded-lg disabled:opacity-40 ${playing ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}>
              {playing ? '■ Stop' : '▶ Play'}
            </button>
            <button onClick={loadPreset} disabled={!joined} className="px-3 py-2 bg-surface-2 hover:bg-surface-3 disabled:opacity-40 text-zinc-300 text-xs rounded-lg">Load Preset</button>
            <button onClick={clearGrid} disabled={!joined} className="px-3 py-2 bg-surface-2 hover:bg-surface-3 disabled:opacity-40 text-zinc-300 text-xs rounded-lg">Clear</button>
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              BPM:
              <input type="range" min={60} max={200} value={bpm} disabled={!joined}
                onChange={(e) => handleBpmChange(Number(e.target.value))}
                className="w-24 accent-blue-500 disabled:opacity-40" />
              <span className="font-mono w-8">{bpm}</span>
            </label>
          </div>

          {/* Sequencer grid */}
          <div className="space-y-2 overflow-x-auto">
            {TRACKS.map((track) => (
              <div key={track.id} className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 w-12 shrink-0 text-right">{track.label}</span>
                <div className="flex gap-1">
                  {Array.from({ length: STEPS }, (_, i) => (
                    <button
                      key={i}
                      onClick={() => toggleStep(track.id, i)}
                      className={[
                        'w-8 h-8 rounded-md border transition-all duration-75 text-xs font-bold',
                        grid[track.id][i]
                          ? `${track.color} border-transparent text-white`
                          : 'bg-surface-0 border-zinc-800 text-zinc-700 hover:border-zinc-600',
                        currentStep === i && playing ? 'ring-2 ring-white ring-offset-1 ring-offset-surface-1' : '',
                        i === 4 || i === 8 || i === 12 ? 'ml-2' : '',
                      ].join(' ')}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-zinc-600">
            {joined ? `Room: ${roomId} · Peer: ${peerId}` : 'Join a room to start playing'}
          </p>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Tone.js sequencer + DataChannel sync' }}
      mdnLinks={[
        { label: 'Tone.js', href: 'https://tonejs.github.io/' },
        { label: 'Web Audio API', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API' },
      ]}
    />
  );
}
