import { useMemo, useRef, useState, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

const CODE = `// Broadcaster: one-to-many topology
// Each viewer gets their own RTCPeerConnection to the broadcaster

// Viewer side:
ws.send(JSON.stringify({ type: 'join', roomId, peerId, role: 'viewer' }));
// Server notifies broadcaster, who creates offer → viewer

// Broadcaster side:
onPeerJoined = async (viewerId) => {
  const pc = new RTCPeerConnection(config);
  stream.getTracks().forEach(t => pc.addTrack(t, stream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send({ type: 'offer', to: viewerId, sdp: offer });
};`;

interface ViewerState {
  peerId: string;
  state: RTCPeerConnectionState;
}

export default function BroadcasterViewer() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [roomId, setRoomId] = useState('BCAST01');
  const [role, setRole] = useState<'broadcaster' | 'viewer' | null>(null);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [viewers, setViewers] = useState<ViewerState[]>([]);
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());

  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const { status, connect, join, send } = useSignaling({
    logger,
    onMessage: useCallback(async (msg: import('@/types/signaling').SignalingMessage) => {
      switch (msg.type) {
        case 'peer-joined': {
          if (role === 'broadcaster') {
            // New viewer joined — send them an offer
            const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
            peerConnections.current.set(msg.peerId, pc);
            setViewers((v) => [...v, { peerId: msg.peerId, state: 'new' }]);

            pc.onconnectionstatechange = () => {
              setViewers((v) => v.map((x) => x.peerId === msg.peerId ? { ...x, state: pc.connectionState } : x));
            };
            pc.onicecandidate = (ev) => {
              if (ev.candidate) sendRef.current({ type: 'ice-candidate', from: peerId, to: msg.peerId, candidate: ev.candidate.toJSON() });
            };

            localStreamRef.current?.getTracks().forEach((t) => pc.addTrack(t, localStreamRef.current!));

            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendRef.current({ type: 'offer', from: peerId, to: msg.peerId, sdp: offer });
            logger.info(`Sent offer to viewer ${msg.peerId}`);
          }
          break;
        }
        case 'peer-left':
          peerConnections.current.get(msg.peerId)?.close();
          peerConnections.current.delete(msg.peerId);
          setViewers((v) => v.filter((x) => x.peerId !== msg.peerId));
          break;
        case 'offer': {
          if (role === 'viewer') {
            const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
            peerConnections.current.set(msg.from, pc);
            pc.onconnectionstatechange = () => setConnectionState(pc.connectionState);
            pc.onicecandidate = (ev) => {
              if (ev.candidate) sendRef.current({ type: 'ice-candidate', from: peerId, to: msg.from, candidate: ev.candidate.toJSON() });
            };
            pc.ontrack = (ev) => {
              const s = ev.streams[0] ?? new MediaStream([ev.track]);
              if (remoteRef.current) remoteRef.current.srcObject = s;
              logger.success('Broadcaster stream received!');
            };
            await pc.setRemoteDescription(msg.sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendRef.current({ type: 'answer', from: peerId, to: msg.from, sdp: answer });
          }
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
    }, [role, peerId, logger]),
  });
  sendRef.current = send;

  const handleBroadcast = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localRef.current) localRef.current.srcObject = stream;
      setRole('broadcaster');
      connect();
      setTimeout(() => join(roomId, peerId, 'broadcaster'), 500);
      logger.success(`Broadcasting in room ${roomId}`);
    } catch (e) { logger.error(`Failed: ${e}`); }
  };

  const handleWatch = () => {
    setRole('viewer');
    connect();
    setTimeout(() => join(roomId, peerId, 'viewer'), 500);
    logger.info(`Watching room ${roomId}`);
  };

  const handleLeave = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    setRole(null);
    setConnectionState('new');
    setViewers([]);
    if (localRef.current) localRef.current.srcObject = null;
    if (remoteRef.current) remoteRef.current.srcObject = null;
  };

  return (
    <DemoLayout
      title="Broadcaster / Viewer"
      difficulty="advanced"
      description="One broadcaster sends to multiple viewers — each gets their own WebRTC connection."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This topology simulates a streaming scenario: one broadcaster connects to N viewers individually.
            Each viewer gets a dedicated <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">RTCPeerConnection</code>
            from the broadcaster — there's no SFU involved.
          </p>
          <p className="text-amber-400/80">⚡ Open one tab as Broadcaster, then multiple as Viewer with the same room code.</p>
        </div>
      }
      demo={
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">Signaling: <span className={status === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{status}</span></span>
            <span className="text-xs text-zinc-500 font-mono">ID: {peerId}</span>
          </div>

          <div className="flex gap-2">
            <input value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={!!role}
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-zinc-200 w-28 focus:outline-none disabled:opacity-50" />
            {!role && (
              <>
                <button onClick={handleBroadcast} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg">
                  📡 Broadcast
                </button>
                <button onClick={handleWatch} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                  👁 Watch
                </button>
              </>
            )}
            {role && (
              <button onClick={handleLeave} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                Leave ({role})
              </button>
            )}
          </div>

          {role === 'broadcaster' && (
            <div>
              <p className="text-xs text-zinc-500 mb-2">VIEWERS ({viewers.length})</p>
              <div className="space-y-1">
                {viewers.map((v) => (
                  <div key={v.peerId} className="flex items-center gap-2 text-xs font-mono">
                    <span className="text-zinc-400">{v.peerId}</span>
                    <ConnectionStatus state={v.state} className="text-[10px] px-1.5 py-0.5" />
                  </div>
                ))}
                {viewers.length === 0 && <p className="text-zinc-600 text-xs">No viewers yet</p>}
              </div>
            </div>
          )}

          <div className="max-w-lg mx-auto">
            {role === 'broadcaster' && (
              <div className="aspect-video bg-zinc-900 rounded-xl overflow-hidden">
                <video ref={localRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
              </div>
            )}
            {role === 'viewer' && (
              <div className="space-y-2">
                <ConnectionStatus state={connectionState} />
                <div className="aspect-video bg-zinc-900 rounded-xl overflow-hidden">
                  <video ref={remoteRef} autoPlay playsInline className="w-full h-full object-cover" />
                </div>
              </div>
            )}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Broadcaster/viewer topology' }}
      mdnLinks={[{ label: 'RTCPeerConnection', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection' }]}
    />
  );
}
