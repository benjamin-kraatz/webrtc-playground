import { useMemo, useRef, useState, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

const CODE = `// Tone.js synth → WebRTC audio stream
import * as Tone from 'tone';

const synth = new Tone.PolySynth(Tone.Synth).toDestination();

// Capture audio output as a MediaStream
const dest = Tone.context.createMediaStreamDestination();
synth.connect(dest);
const stream = dest.stream;

// Add to peer connection
stream.getTracks().forEach(t => pc.addTrack(t, stream));

// Sync note events via data channel
dc.send(JSON.stringify({ type: 'note', note: 'C4', duration: '8n' }));
dc.onmessage = (ev) => {
  const { note, duration } = JSON.parse(ev.data);
  synth.triggerAttackRelease(note, duration);
};`;

const NOTES = [
  { note: 'C4', label: 'C', color: 'bg-white text-zinc-900', black: false },
  { note: 'C#4', label: 'C#', color: 'bg-zinc-900 text-white', black: true },
  { note: 'D4', label: 'D', color: 'bg-white text-zinc-900', black: false },
  { note: 'D#4', label: 'D#', color: 'bg-zinc-900 text-white', black: true },
  { note: 'E4', label: 'E', color: 'bg-white text-zinc-900', black: false },
  { note: 'F4', label: 'F', color: 'bg-white text-zinc-900', black: false },
  { note: 'F#4', label: 'F#', color: 'bg-zinc-900 text-white', black: true },
  { note: 'G4', label: 'G', color: 'bg-white text-zinc-900', black: false },
  { note: 'G#4', label: 'G#', color: 'bg-zinc-900 text-white', black: true },
  { note: 'A4', label: 'A', color: 'bg-white text-zinc-900', black: false },
  { note: 'A#4', label: 'A#', color: 'bg-zinc-900 text-white', black: true },
  { note: 'B4', label: 'B', color: 'bg-white text-zinc-900', black: false },
  { note: 'C5', label: 'C5', color: 'bg-white text-zinc-900', black: false },
];

export default function WebAudioSynth() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [roomId, setRoomId] = useState('SYNTH01');
  const [joined, setJoined] = useState(false);
  const [toneLoaded, setToneLoaded] = useState(false);
  const [activeNotes, setActiveNotes] = useState<Set<string>>(new Set());
  const synthRef = useRef<unknown>(null);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const dataChannels = useRef(new Map<string, RTCDataChannel>());
  const streamRef = useRef<MediaStream | null>(null);

  const broadcast = (msg: object) => {
    const s = JSON.stringify(msg);
    dataChannels.current.forEach((dc) => { if (dc.readyState === 'open') dc.send(s); });
  };

  const playNote = useCallback((note: string) => {
    if (!synthRef.current) return;
    const synth = synthRef.current as { triggerAttackRelease: (note: string, duration: string) => void };
    synth.triggerAttackRelease(note, '8n');
    setActiveNotes((prev) => { const next = new Set(prev); next.add(note); setTimeout(() => setActiveNotes((p) => { const n = new Set(p); n.delete(note); return n; }), 300); return next; });
    broadcast({ type: 'note', note, duration: '8n' });
  }, []);

  const setupDc = (dc: RTCDataChannel, remotePeerId: string) => {
    dataChannels.current.set(remotePeerId, dc);
    dc.onopen = () => logger.success(`Synth channel open with ${remotePeerId}`);
    dc.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'note' && synthRef.current) {
        const synth = synthRef.current as { triggerAttackRelease: (note: string, duration: string) => void };
        synth.triggerAttackRelease(msg.note, msg.duration);
        setActiveNotes((prev) => { const next = new Set(prev); next.add(msg.note); setTimeout(() => setActiveNotes((p) => { const n = new Set(p); n.delete(msg.note); return n; }), 300); return next; });
        logger.info(`Remote: ${msg.note}`);
      }
    };
  };

  const createPc = useCallback((remotePeerId: string, sendFn: (msg: import('@/types/signaling').SignalingMessage) => void) => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    peerConnections.current.set(remotePeerId, pc);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) sendFn({ type: 'ice-candidate', from: peerId, to: remotePeerId, candidate: ev.candidate.toJSON() });
    };
    pc.ondatachannel = (ev) => setupDc(ev.channel, remotePeerId);
    // Add local audio stream
    streamRef.current?.getTracks().forEach((t) => pc.addTrack(t, streamRef.current!));
    return pc;
  }, [peerId]);

  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const { status, connect, join, send } = useSignaling({
    logger,
    onMessage: useCallback(async (msg: import('@/types/signaling').SignalingMessage) => {
      switch (msg.type) {
        case 'peer-list': {
          for (const peer of msg.peers) {
            const pc = createPc(peer.peerId, sendRef.current);
            const dc = pc.createDataChannel('synth', { ordered: true });
            setupDc(dc, peer.peerId);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendRef.current({ type: 'offer', from: peerId, to: peer.peerId, sdp: offer });
          }
          break;
        }
        case 'offer': {
          const pc = createPc(msg.from, sendRef.current);
          await pc.setRemoteDescription(msg.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendRef.current({ type: 'answer', from: peerId, to: msg.from, sdp: answer });
          break;
        }
        case 'answer': {
          const pc = peerConnections.current.get(msg.from);
          if (pc) await pc.setRemoteDescription(msg.sdp);
          break;
        }
        case 'ice-candidate': {
          const pc = peerConnections.current.get(msg.from);
          if (pc) await pc.addIceCandidate(msg.candidate).catch(console.warn);
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
    const dest = Tone.context.createMediaStreamDestination();
    const synth = new Tone.PolySynth(Tone.Synth).toDestination();
    synth.connect(dest);
    synthRef.current = synth;
    streamRef.current = dest.stream;
    setToneLoaded(true);
    logger.success('Tone.js ready');

    connect();
    setTimeout(() => { join(roomId, peerId); setJoined(true); }, 500);
    logger.success(`Joined synth room ${roomId}`);
  };

  const handleLeave = () => {
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    dataChannels.current.clear();
    setJoined(false);
    setToneLoaded(false);
    synthRef.current = null;
  };

  return (
    <DemoLayout
      title="WebAudio Synth Jam"
      difficulty="advanced"
      description="Play synthesizer notes together — audio via Tone.js, streamed over WebRTC."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            A collaborative synthesizer: <strong>Tone.js</strong> generates audio, which is captured
            as a MediaStream and sent over WebRTC. Note events are also sync'd via RTCDataChannel so
            all peers hear the same notes.
          </p>
          <p className="text-amber-400/80">⚡ Requires signaling server. Open multiple tabs with the same room code.</p>
        </div>
      }
      demo={
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">Signaling: <span className={status === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{status}</span></span>
          </div>

          <div className="flex gap-2">
            <input value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={joined}
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-zinc-200 w-28 focus:outline-none disabled:opacity-50" />
            {!joined ? (
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Join Jam Session
              </button>
            ) : (
              <button onClick={handleLeave} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                Leave
              </button>
            )}
          </div>

          {/* Piano keyboard */}
          <div className="relative flex gap-0.5 justify-center select-none" style={{ height: 140 }}>
            {NOTES.filter((n) => !n.black).map((n, i) => (
              <button
                key={n.note}
                disabled={!toneLoaded}
                onMouseDown={() => playNote(n.note)}
                className={`${n.color} ${activeNotes.has(n.note) ? 'brightness-75' : ''} w-10 h-full rounded-b-md border border-zinc-700 text-xs font-semibold flex items-end justify-center pb-2 cursor-pointer transition-all duration-75 disabled:opacity-40 hover:brightness-90 active:brightness-75`}
              >
                {n.label}
              </button>
            ))}
          </div>

          <p className="text-xs text-zinc-500 text-center">Click keys to play • Notes sync to all peers in real time</p>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Tone.js + WebRTC audio stream' }}
      mdnLinks={[
        { label: 'Tone.js', href: 'https://tonejs.github.io/' },
        { label: 'Web Audio API', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API' },
      ]}
    />
  );
}
