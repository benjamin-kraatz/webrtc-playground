import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

const CODE = `// Auto signaling via WebSocket — no copy-paste needed!
ws.send(JSON.stringify({ type: 'join', roomId, peerId }));

ws.onmessage = async ({ data }) => {
  const msg = JSON.parse(data);
  switch (msg.type) {
    case 'peer-joined':
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: 'offer', to: msg.peerId, sdp: offer }));
      break;
    case 'offer':
      await pc.setRemoteDescription(msg.sdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: 'answer', to: msg.from, sdp: answer }));
      break;
    case 'answer':
      await pc.setRemoteDescription(msg.sdp);
      break;
    case 'ice-candidate':
      await pc.addIceCandidate(msg.candidate);
      break;
  }
};`;

export default function VideoCall() {
  const logger = useMemo(() => new Logger(), []);
  const [roomId, setRoomId] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase());
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [joined, setJoined] = useState(false);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const onMessage = useCallback(async (msg: SignalingMessage) => {
    const pc = pcRef.current;
    if (!pc) return;

    switch (msg.type) {
      case 'peer-joined':
        remotePeerIdRef.current = msg.peerId;
        logger.info(`Peer joined: ${msg.peerId} — sending offer...`);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          sendRef.current({ type: 'offer', from: peerId, to: msg.peerId, sdp: offer });
        } catch (e) { logger.error(`Offer failed: ${e}`); }
        break;

      case 'offer':
        remotePeerIdRef.current = msg.from;
        try {
          await pc.setRemoteDescription(msg.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendRef.current({ type: 'answer', from: peerId, to: msg.from, sdp: answer });
        } catch (e) { logger.error(`Answer failed: ${e}`); }
        break;

      case 'answer':
        try { await pc.setRemoteDescription(msg.sdp); } catch (e) { logger.error(`setRemote failed: ${e}`); }
        break;

      case 'ice-candidate':
        try { await pc.addIceCandidate(msg.candidate); } catch (e) { logger.warn(`addIce failed: ${e}`); }
        break;

      case 'peer-left':
        logger.info(`Peer left: ${msg.peerId}`);
        setRemoteStream(null);
        if (remoteRef.current) remoteRef.current.srcObject = null;
        break;
    }
  }, [peerId, logger]);

  const { status, connect, join, send, disconnect } = useSignaling({ logger, onMessage });
  // Keep sendRef up to date with stable send
  sendRef.current = send;

  const handleJoin = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      if (localRef.current) localRef.current.srcObject = stream;
      logger.success('Camera/mic acquired');

      const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      pcRef.current = pc;

      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      pc.onconnectionstatechange = () => { setConnectionState(pc.connectionState); logger.info(`connectionState → ${pc.connectionState}`); };
      pc.onicecandidate = (ev) => {
        if (ev.candidate && remotePeerIdRef.current) {
          send({ type: 'ice-candidate', from: peerId, to: remotePeerIdRef.current, candidate: ev.candidate.toJSON() });
        }
      };
      pc.ontrack = (ev) => {
        const s = ev.streams[0] ?? new MediaStream([ev.track]);
        setRemoteStream(s);
        if (remoteRef.current) remoteRef.current.srcObject = s;
        logger.success('Remote video track received!');
      };

      connect();
      setTimeout(() => { join(roomId, peerId); setJoined(true); }, 500);
    } catch (e) {
      logger.error(`Failed to join: ${e}`);
    }
  };

  const handleLeave = () => {
    localStream?.getTracks().forEach((t) => t.stop());
    pcRef.current?.close();
    disconnect();
    setJoined(false);
    setLocalStream(null);
    setRemoteStream(null);
    setConnectionState('new');
  };

  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach((t) => t.stop());
      pcRef.current?.close();
    };
  }, []);

  return (
    <DemoLayout
      title="Video Call"
      difficulty="intermediate"
      description="Full A/V video call between two tabs with automatic WebSocket signaling."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This demo uses the <strong>signaling server</strong> at
            <code className="ml-1 text-xs bg-surface-2 px-1 py-0.5 rounded">/ws</code>
            to automatically exchange offer/answer/ICE between peers in the same room.
          </p>
          <p>
            Open a second tab with the same room code, click Join, and you'll get a video call
            without any copy-pasting. The server only relays signaling messages — it never touches the
            media stream.
          </p>
          {status !== 'connected' && (
            <p className="text-amber-400">⚠ Signaling unavailable. In local development, run <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">bun run dev</code> at the project root.</p>
          )}
        </div>
      }
      hints={['Start the signaling server with bun run dev', 'Open two tabs with the same room code']}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-3">
            <ConnectionStatus state={connectionState} />
            <span className="text-xs text-zinc-500">
              Signaling: <span className={status === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{status}</span>
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div>
              <label className="text-xs text-zinc-500">Room Code</label>
              <div className="flex gap-2 mt-1">
                <input value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} disabled={joined}
                  className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-zinc-200 w-28 focus:outline-none focus:border-blue-500 disabled:opacity-50" />
                <span className="text-xs text-zinc-600 self-center">Your ID: {peerId}</span>
              </div>
            </div>
            {!joined ? (
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg mt-4">
                Join Room
              </button>
            ) : (
              <button onClick={handleLeave} className="px-4 py-2 bg-red-900/50 hover:bg-red-900 text-red-400 text-sm font-medium rounded-lg border border-red-800 mt-4">
                Leave
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Local</p>
              <div className="aspect-video bg-zinc-900 rounded-xl overflow-hidden">
                <video ref={localRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
              </div>
            </div>
            <div className="relative space-y-1">
              <p className="text-xs text-zinc-500">Remote</p>
              <div className="aspect-video bg-zinc-900 rounded-xl overflow-hidden flex items-center justify-center">
                <video ref={remoteRef} autoPlay playsInline className="w-full h-full object-cover" />
                {!remoteStream && joined && (
                  <p className="text-sm text-zinc-600 absolute">Waiting for peer...</p>
                )}
              </div>
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'WebSocket-based auto signaling' }}
      mdnLinks={[
        { label: 'Signaling and video calling', href: 'https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling' },
      ]}
    />
  );
}
