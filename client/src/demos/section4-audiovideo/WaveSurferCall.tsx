import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

const CODE = `// WaveSurfer v7 visualizes a remote audio MediaStream
const remoteAudio = new Audio();
remoteAudio.srcObject = remoteStream;

const ws = WaveSurfer.create({
  container: waveRef.current,
  waveColor: '#818cf8',
  progressColor: '#4f46e5',
  media: remoteAudio,
  height: 80,
  barWidth: 2,
  barGap: 1,
  barRadius: 2,
  interact: false,
});

// For local mic level, use Web Audio AnalyserNode
const ctx = new AudioContext();
const src = ctx.createMediaStreamSource(localStream);
const analyser = ctx.createAnalyser();
src.connect(analyser);`;

export default function WaveSurferCall() {
  const logger = useMemo(() => new Logger(), []);
  const [roomId, setRoomId] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase());
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [joined, setJoined] = useState(false);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [hasRemote, setHasRemote] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [muted, setMuted] = useState(false);

  const localWaveRef = useRef<HTMLDivElement>(null);
  const remoteWaveRef = useRef<HTMLDivElement>(null);
  const localWsRef = useRef<WaveSurfer | null>(null);
  const remoteWsRef = useRef<WaveSurfer | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const setupLocalVisualizer = useCallback((stream: MediaStream) => {
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;

    // Local waveform via WaveSurfer microphone source
    if (localWaveRef.current) {
      localWsRef.current?.destroy();
      const localAudio = new Audio();
      localAudio.srcObject = stream;
      localAudio.muted = true;
      const ws = WaveSurfer.create({
        container: localWaveRef.current,
        waveColor: '#34d399',
        progressColor: '#059669',
        height: 64,
        barWidth: 2,
        barGap: 1,
        barRadius: 3,
        interact: false,
        media: localAudio,
      });
      localWsRef.current = ws;
      localAudio.play().catch(() => {});
    }

    const buf = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteFrequencyData(buf);
      const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
      setMicLevel(Math.round((avg / 255) * 100));
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  const setupRemoteVisualizer = useCallback((stream: MediaStream) => {
    if (!remoteWaveRef.current) return;
    remoteWsRef.current?.destroy();

    const audio = new Audio();
    audio.srcObject = stream;
    audio.autoplay = true;
    remoteAudioRef.current = audio;

    const ws = WaveSurfer.create({
      container: remoteWaveRef.current,
      waveColor: '#818cf8',
      progressColor: '#4f46e5',
      height: 64,
      barWidth: 2,
      barGap: 1,
      barRadius: 3,
      interact: false,
      media: audio,
    });
    remoteWsRef.current = ws;
    audio.play().catch(() => {});
    setHasRemote(true);
    logger.success('Remote audio stream connected — visualizing waveform!');
  }, [logger]);

  const onMessage = useCallback(async (msg: SignalingMessage) => {
    const pc = pcRef.current;
    if (!pc) return;
    switch (msg.type) {
      case 'peer-joined': {
        remotePeerIdRef.current = msg.peerId;
        logger.info(`Peer joined — sending offer…`);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendRef.current({ type: 'offer', from: peerId, to: msg.peerId, sdp: offer });
        break;
      }
      case 'offer':
        remotePeerIdRef.current = msg.from;
        await pc.setRemoteDescription(msg.sdp);
        {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendRef.current({ type: 'answer', from: peerId, to: msg.from, sdp: answer });
        }
        break;
      case 'answer':
        await pc.setRemoteDescription(msg.sdp);
        break;
      case 'ice-candidate':
        await pc.addIceCandidate(msg.candidate).catch(() => {});
        break;
    }
  }, [peerId, logger]);

  const { status: sigStatus, connect, join, send, disconnect } = useSignaling({ logger, onMessage });
  sendRef.current = send;

  const handleJoin = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      setupLocalVisualizer(stream);
      logger.success('Microphone acquired');

      const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      pcRef.current = pc;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.onconnectionstatechange = () => setConnectionState(pc.connectionState);
      pc.onicecandidate = (ev) => {
        if (ev.candidate && remotePeerIdRef.current) {
          send({ type: 'ice-candidate', from: peerId, to: remotePeerIdRef.current, candidate: ev.candidate.toJSON() });
        }
      };
      pc.ontrack = (ev) => {
        const remoteStream = ev.streams[0] ?? new MediaStream([ev.track]);
        setupRemoteVisualizer(remoteStream);
      };

      connect();
      setTimeout(() => { join(roomId, peerId); setJoined(true); }, 400);
    } catch (e) {
      logger.error(`Failed to join: ${e}`);
    }
  };

  const handleLeave = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    audioCtxRef.current?.close();
    localWsRef.current?.destroy();
    remoteWsRef.current?.destroy();
    pcRef.current?.close();
    disconnect();
    setJoined(false);
    setHasRemote(false);
    setMicLevel(0);
    setConnectionState('new');
  };

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = muted; });
    setMuted(!muted);
    logger.info(muted ? 'Unmuted' : 'Muted');
  };

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      audioCtxRef.current?.close();
      localWsRef.current?.destroy();
      remoteWsRef.current?.destroy();
      pcRef.current?.close();
    };
  }, []);

  return (
    <DemoLayout
      title="WaveSurfer Audio Call"
      difficulty="intermediate"
      description="A peer-to-peer audio call where WaveSurfer.js visualizes both sides of the conversation in real time."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>WaveSurfer.js v7</strong> accepts an <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">HTMLMediaElement</code> as
            its audio source. By pointing it at an <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">&lt;audio&gt;</code> element
            whose <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">srcObject</code> is the
            remote WebRTC <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">MediaStream</code>, we get a live
            waveform of the remote peer's voice.
          </p>
          <p>
            Local mic level is visualized with a Web Audio <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">AnalyserNode</code>.
            Open two tabs with the same room code and speak — both waveforms animate in real time.
          </p>
          {sigStatus !== 'connected' && (
            <p className="text-amber-400 text-xs">⚠ Run <code className="bg-surface-2 px-1 py-0.5 rounded">bun run dev</code> to start the signaling server.</p>
          )}
        </div>
      }
      hints={['Open two tabs with the same room code', 'Green waveform = local mic, Indigo = remote peer', 'Use headphones to prevent audio feedback']}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <ConnectionStatus state={connectionState} />
            <span className="text-xs text-zinc-500">Signaling: <span className={sigStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{sigStatus}</span></span>
          </div>

          {!joined ? (
            <div className="flex items-center gap-3">
              <div>
                <label className="text-xs text-zinc-500">Room Code</label>
                <input value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="block mt-1 bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-zinc-200 w-28 focus:outline-none focus:border-blue-500" />
              </div>
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg mt-4">
                Join Room
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-2">
                <button
                  onClick={toggleMute}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${muted ? 'bg-red-700 hover:bg-red-600 text-white' : 'bg-surface-2 hover:bg-surface-3 text-zinc-300'}`}
                >
                  {muted ? '🔇 Unmute' : '🎙 Mute'}
                </button>
                <button onClick={handleLeave} className="px-3 py-2 bg-red-900/40 hover:bg-red-900 text-red-400 text-sm font-medium rounded-lg border border-red-800 transition-colors">
                  Leave
                </button>
              </div>

              {/* Local */}
              <div className="bg-surface-0 border border-zinc-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-emerald-400">🎙 Your Microphone</p>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-2 bg-zinc-800 rounded-full overflow-hidden">
                      <div className="h-full bg-emerald-400 rounded-full transition-all duration-100" style={{ width: `${micLevel}%` }} />
                    </div>
                    <span className="text-xs text-zinc-500 w-8 text-right">{micLevel}%</span>
                  </div>
                </div>
                <div ref={localWaveRef} className="rounded-lg overflow-hidden" style={{ minHeight: 64 }} />
              </div>

              {/* Remote */}
              <div className="bg-surface-0 border border-zinc-800 rounded-xl p-4 space-y-2">
                <p className="text-xs font-medium text-indigo-400">📡 Remote Peer</p>
                {!hasRemote ? (
                  <div className="h-16 flex items-center justify-center text-sm text-zinc-600">
                    Waiting for peer to join…
                  </div>
                ) : (
                  <div ref={remoteWaveRef} className="rounded-lg overflow-hidden" style={{ minHeight: 64 }} />
                )}
              </div>
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'WaveSurfer.js with WebRTC MediaStream' }}
      mdnLinks={[
        { label: 'MediaStream', href: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaStream' },
        { label: 'Web Audio API', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API' },
      ]}
    />
  );
}
