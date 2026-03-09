import { useMemo, useRef, useState, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

interface LyricLine { beat: number; text: string }

const SONGS = [
  {
    title: '🎸 Lo-Fi Beat',
    bpm: 75,
    chords: ['Dm7','G7','Cmaj7','Am7'],
    lyrics: [
      { beat: 0,  text: '♪ Drifting through the static haze…' },
      { beat: 8,  text: '♪ Analog dreams on FM waves…' },
      { beat: 16, text: '♪ Every pixel tells a story…' },
      { beat: 24, text: '♪ Underneath the neon glory…' },
      { beat: 32, text: '♪ Code and coffee, late at night…' },
      { beat: 40, text: '♪ Bugs and features, endless fight…' },
      { beat: 48, text: '♪ Git commit and push to main…' },
      { beat: 56, text: '♪ Deploy at dawn in the rain ☔' },
    ] as LyricLine[],
  },
  {
    title: '🎵 Synth Pop',
    bpm: 110,
    chords: ['Am','F','C','G'],
    lyrics: [
      { beat: 0,  text: '✨ We are living in the future…' },
      { beat: 8,  text: '✨ WebRTC runs in the browser…' },
      { beat: 16, text: '✨ Peer to peer, no server needed…' },
      { beat: 24, text: '✨ All your calls are intercepted— wait no.' },
      { beat: 32, text: '✨ STUN turns map your public IP…' },
      { beat: 40, text: '✨ ICE connects you and me…' },
      { beat: 48, text: '✨ DataChannels carry the beat…' },
      { beat: 56, text: '✨ Real-time audio, no latency ⚡' },
    ] as LyricLine[],
  },
];

const CODE = `// Karaoke Machine: Tone.js chords + scrolling lyrics synced over DataChannel
import * as Tone from 'tone';

const synth = new Tone.PolySynth(Tone.Synth).toDestination();
const CHORDS = { Dm7: ['D4','F4','A4','C5'], G7: ['G3','B3','D4','F4'], ... };
let beat = 0;

Tone.Transport.scheduleRepeat((time) => {
  synth.triggerAttackRelease(CHORDS[song.chords[beat % 4]], '2n', time, 0.4);
  setCurrentBeat(beat);
  beat++;
  // Sync beat count over DataChannel so all peers scroll the same lyrics
  dc.send(JSON.stringify({ type: 'beat', beat, song: selectedSong }));
}, '2n');

// Capture Tone.js audio → WebRTC stream
const dest = Tone.context.createMediaStreamDestination();
synth.connect(dest);
stream.getTracks().forEach(t => pc.addTrack(t, stream));`;

const CHORD_NOTES: Record<string, string[]> = {
  Dm7:   ['D4','F4','A4','C5'],
  G7:    ['G3','B3','D4','F4'],
  Cmaj7: ['C4','E4','G4','B4'],
  Am7:   ['A3','C4','E4','G4'],
  Am:    ['A3','E4','A4'],
  F:     ['F3','A3','C4'],
  C:     ['C4','E4','G4'],
  G:     ['G3','B3','D4'],
};

export default function KaraokeMachine() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [roomId, setRoomId] = useState('KARAOKE01');
  const [joined, setJoined] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [selectedSong, setSelectedSong] = useState(0);
  const [currentBeat, setCurrentBeat] = useState(-1);
  const [micActive, setMicActive] = useState(false);
  const synthRef = useRef<{ triggerAttackRelease: (notes: string[], dur: string, time: number, vel: number) => void } | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const dataChannels = useRef(new Map<string, RTCDataChannel>());
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const broadcast = (msg: object) => {
    const s = JSON.stringify(msg);
    dataChannels.current.forEach(dc => { if (dc.readyState === 'open') dc.send(s); });
  };

  const setupDc = useCallback((dc: RTCDataChannel, remotePeerId: string) => {
    dataChannels.current.set(remotePeerId, dc);
    dc.onopen = () => logger.success(`Karaoke channel open with ${remotePeerId}`);
    dc.onmessage = ev => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'beat') { setCurrentBeat(msg.beat); setSelectedSong(msg.song); }
    };
  }, []);

  const createPc = useCallback((remotePeerId: string) => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    peerConnections.current.set(remotePeerId, pc);
    pc.onicecandidate = ev => { if (ev.candidate) sendRef.current({ type: 'ice-candidate', from: peerId, to: remotePeerId, candidate: ev.candidate.toJSON() }); };
    pc.ondatachannel = ev => setupDc(ev.channel, remotePeerId);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => pc.addTrack(t, streamRef.current!));
    pc.ontrack = ev => {
      const audio = new Audio(); audio.srcObject = ev.streams[0]; audio.play().catch(() => {});
    };
    return pc;
  }, [peerId, setupDc]);

  const { connect, join, send } = useSignaling({
    logger,
    onMessage: useCallback(async (msg: SignalingMessage) => {
      switch (msg.type) {
        case 'peer-list': {
          for (const peer of msg.peers) {
            const pc = createPc(peer.peerId);
            const dc = pc.createDataChannel('karaoke');
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
        case 'answer': await peerConnections.current.get(msg.from)?.setRemoteDescription(msg.sdp); break;
        case 'ice-candidate': await peerConnections.current.get(msg.from)?.addIceCandidate(msg.candidate).catch(console.warn); break;
      }
    }, [createPc, setupDc, peerId]),
  });
  sendRef.current = send;

  const handleJoin = () => {
    connect();
    setTimeout(() => { join(roomId, peerId); setJoined(true); }, 500);
    logger.success(`Joined karaoke room ${roomId}`);
  };

  const handlePlay = async () => {
    const Tone = await import('tone');
    await Tone.start();
    const synth = new Tone.PolySynth(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.05, decay: 0.3, sustain: 0.4, release: 1 } }).toDestination();
    const dest = Tone.context.createMediaStreamDestination();
    synth.connect(dest);
    streamRef.current = dest.stream;
    synthRef.current = synth as unknown as typeof synthRef.current;

    const song = SONGS[selectedSong];
    Tone.Transport.bpm.value = song.bpm;
    let beat = 0;
    Tone.Transport.scheduleRepeat((time: number) => {
      const chord = song.chords[beat % song.chords.length];
      const notes = CHORD_NOTES[chord] ?? [];
      (synth as unknown as { triggerAttackRelease: (n: string[], d: string, t: number, v: number) => void }).triggerAttackRelease(notes, '2n', time, 0.35);
      setCurrentBeat(beat);
      broadcast({ type: 'beat', beat, song: selectedSong });
      beat++;
    }, '2n');
    Tone.Transport.start();
    setPlaying(true);
    logger.success(`Playing: ${song.title} at ${song.bpm} BPM`);
  };

  const handleStop = async () => {
    const Tone = await import('tone');
    Tone.Transport.stop();
    Tone.Transport.cancel();
    setPlaying(false);
    setCurrentBeat(-1);
    logger.info('Stopped');
  };

  const handleLeave = async () => {
    await handleStop();
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear(); dataChannels.current.clear();
    setJoined(false);
  };

  const song = SONGS[selectedSong];
  const activeLine = song.lyrics.reduce<LyricLine | null>((best, line) =>
    line.beat <= currentBeat && (best === null || line.beat > best.beat) ? line : best, null);

  return (
    <DemoLayout
      title="Karaoke Machine"
      difficulty="intermediate"
      description="A Tone.js backing track with scrolling lyrics — beat positions sync over DataChannel so all peers are in time."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>Tone.js Transport</strong> is a precise musical clock. Every two beats, it
            triggers a chord (as a <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">PolySynth</code>)
            and sends the current beat number over a <strong>DataChannel</strong>. Every peer
            in the room receives the same beat index and scrolls its own lyrics display in sync.
          </p>
          <p>
            The synthesizer audio is routed to a{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">MediaStreamDestination</code> node,
            then streamed over WebRTC — so the host's backing track plays in all peers' browsers.
          </p>
          <p className="text-amber-400/80">⚡ Requires signaling server. Open multiple tabs and join the same room for a full karaoke experience!</p>
        </div>
      }
      hints={[
        'Open two tabs — the lyrics scroll in sync across both',
        'The host streams audio via WebRTC, all peers hear the same chords',
        'Try singing along — it actually sounds decent with headphones!',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap gap-3 items-center">
            <input value={roomId} onChange={e => setRoomId(e.target.value)} disabled={joined}
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono w-36 focus:outline-none disabled:opacity-50" />
            {!joined ? (
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">Join Room</button>
            ) : (
              <button onClick={handleLeave} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">Leave</button>
            )}
          </div>

          {/* Song select */}
          <div className="flex gap-2">
            {SONGS.map((s, i) => (
              <button key={i} onClick={() => setSelectedSong(i)} disabled={playing}
                className={`px-3 py-2 text-sm rounded-xl border disabled:opacity-50 transition-colors ${selectedSong === i ? 'border-blue-500 bg-blue-950/40 text-blue-300' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}>
                {s.title}
              </button>
            ))}
          </div>

          {/* Lyric display */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-6 min-h-28 flex flex-col items-center justify-center text-center">
            {activeLine ? (
              <p className="text-xl font-medium text-white leading-relaxed" style={{ animation: 'popIn 0.2s ease-out' }}>
                {activeLine.text}
              </p>
            ) : (
              <p className="text-zinc-700">{playing ? '🎵' : 'Press Play to start'}</p>
            )}
            {playing && currentBeat >= 0 && (
              <div className="flex gap-1 mt-4">
                {song.chords.map((ch, i) => (
                  <span key={i} className={`px-2 py-0.5 text-xs rounded font-mono transition-all ${i === currentBeat % song.chords.length ? 'bg-blue-600 text-white scale-110' : 'bg-surface-2 text-zinc-500'}`}>{ch}</span>
                ))}
              </div>
            )}
          </div>

          {/* Transport */}
          <div className="flex gap-3 justify-center">
            {!playing ? (
              <button onClick={handlePlay} disabled={!joined} className="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold rounded-xl text-lg">
                ▶ Play
              </button>
            ) : (
              <button onClick={handleStop} className="px-6 py-3 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-lg">
                ■ Stop
              </button>
            )}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Tone.js Transport + beat sync + audio stream' }}
      mdnLinks={[
        { label: 'Tone.js Transport', href: 'https://tonejs.github.io/docs/15.0.4/classes/Transport.html' },
        { label: 'AudioContext.createMediaStreamDestination()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaStreamDestination' },
      ]}
    />
  );
}
