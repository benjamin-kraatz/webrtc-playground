import { useMemo, useRef, useState, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

const CODE = `// Mesh: each new peer connects to ALL existing peers
ws.onmessage = async ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === 'peer-list') {
    // Connect to each existing peer
    for (const peer of msg.peers) {
      const pc = new RTCPeerConnection(config);
      peerConnections.set(peer.peerId, pc);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ type: 'offer', to: peer.peerId, sdp: offer }));
    }
  }
};`;

interface RemotePeer {
  peerId: string;
  stream: MediaStream | null;
  state: RTCPeerConnectionState;
}

export default function MeshNetwork() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [roomId, setRoomId] = useState('MESH01');
  const [joined, setJoined] = useState(false);
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const localRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());

  const updatePeer = (id: string, update: Partial<RemotePeer>) => {
    setRemotePeers((prev) => prev.map((p) => p.peerId === id ? { ...p, ...update } : p));
  };

  const createPc = useCallback((remotePeerId: string, sendFn: (msg: import('@/types/signaling').SignalingMessage) => void) => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    peerConnections.current.set(remotePeerId, pc);
    setRemotePeers((prev) => [...prev.filter((p) => p.peerId !== remotePeerId), { peerId: remotePeerId, stream: null, state: 'new' }]);

    pc.onconnectionstatechange = () => updatePeer(remotePeerId, { state: pc.connectionState });
    pc.onicecandidate = (ev) => {
      if (ev.candidate) sendFn({ type: 'ice-candidate', from: peerId, to: remotePeerId, candidate: ev.candidate.toJSON() });
    };
    pc.ontrack = (ev) => {
      const s = ev.streams[0] ?? new MediaStream([ev.track]);
      updatePeer(remotePeerId, { stream: s });
      logger.success(`Remote track from ${remotePeerId}`);
    };

    // Add local stream
    localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!));
    return pc;
  }, [peerId, logger]);

  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const { status, connect, join, send } = useSignaling({
    logger,
    onMessage: useCallback(async (msg: import('@/types/signaling').SignalingMessage) => {
      switch (msg.type) {
        case 'peer-list':
          // Connect to all existing peers
          for (const peer of msg.peers) {
            const pc = createPc(peer.peerId, sendRef.current);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendRef.current({ type: 'offer', from: peerId, to: peer.peerId, sdp: offer });
            logger.info(`Sending offer to ${peer.peerId}`);
          }
          break;
        case 'peer-joined': {
          // Don't initiate — they'll send us an offer
          logger.info(`New peer joined: ${msg.peerId}`);
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
        case 'peer-left':
          peerConnections.current.get(msg.peerId)?.close();
          peerConnections.current.delete(msg.peerId);
          setRemotePeers((prev) => prev.filter((p) => p.peerId !== msg.peerId));
          break;
      }
    }, [createPc, peerId, logger]),
  });
  sendRef.current = send;

  const handleJoin = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localRef.current) localRef.current.srcObject = stream;
      connect();
      setTimeout(() => { join(roomId, peerId); setJoined(true); }, 500);
      logger.success(`Joined mesh room ${roomId} as ${peerId}`);
    } catch (e) { logger.error(`Failed: ${e}`); }
  };

  const handleLeave = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    setJoined(false);
    setRemotePeers([]);
  };

  return (
    <DemoLayout
      title="Mesh Network"
      difficulty="advanced"
      description="Connect 3-4 peers in a full mesh — every peer connects to every other peer."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            In a <strong>mesh topology</strong>, every peer connects directly to every other peer.
            With N peers, there are N×(N-1)/2 connections. This is simple but doesn't scale beyond ~4-6 peers.
          </p>
          <p>
            When you join, the server sends you a list of existing peers. You initiate an offer to each one.
            New joiners receive a <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">peer-joined</code> event
            and wait for the newcomer's offer.
          </p>
          <p className="text-amber-400/80">⚡ Requires signaling server. Open 3-4 tabs with the same room code.</p>
        </div>
      }
      hints={['Start bun run dev', 'Open 3 tabs with same room code', '4 peers = 6 simultaneous connections']}
      demo={
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">Signaling: <span className={status === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{status}</span></span>
            <span className="text-xs text-zinc-500">Your ID: <span className="font-mono text-zinc-300">{peerId}</span></span>
          </div>

          <div className="flex gap-2">
            <input value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={joined}
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-zinc-200 w-28 focus:outline-none focus:border-blue-500 disabled:opacity-50" />
            {!joined ? (
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">Join Mesh</button>
            ) : (
              <button onClick={handleLeave} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">Leave</button>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">You ({peerId})</p>
              <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
                <video ref={localRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
              </div>
            </div>
            {remotePeers.map((peer) => (
              <div key={peer.peerId} className="space-y-1">
                <div className="flex items-center gap-1">
                  <p className="text-xs text-zinc-500 font-mono">{peer.peerId}</p>
                  <ConnectionStatus state={peer.state} className="text-[10px] px-1.5 py-0.5" />
                </div>
                <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
                  {peer.stream ? (
                    <RemoteVideo stream={peer.stream} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs">Connecting...</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {joined && remotePeers.length === 0 && (
            <p className="text-sm text-zinc-500">Waiting for other peers to join room <span className="font-mono text-zinc-300">{roomId}</span>...</p>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Mesh — connecting to all existing peers' }}
      mdnLinks={[{ label: 'WebRTC multi-peer', href: 'https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API' }]}
    />
  );
}

function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useMemo(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline className="w-full h-full object-cover" onLoadedMetadata={(e) => { (e.target as HTMLVideoElement).srcObject = stream; }} />;
}
