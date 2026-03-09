import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

const CONFETTI_TYPES = [
  { id: 'classic', label: '🎉 Classic', colors: ['#ff0000','#ff7f00','#ffff00','#00ff00','#0000ff','#8b00ff'] },
  { id: 'gold', label: '✨ Gold', colors: ['#ffd700','#ffec61','#fff48d','#c8960c','#daa520'] },
  { id: 'pastel', label: '🌸 Pastel', colors: ['#ffb3ba','#ffdfba','#ffffba','#baffc9','#bae1ff','#e8baff'] },
  { id: 'fire', label: '🔥 Fire', colors: ['#ff4d00','#ff7700','#ff9500','#ffb700','#ffd000'] },
  { id: 'snow', label: '❄️ Snow', colors: ['#ffffff','#e0f0ff','#c2e0ff','#a0c8f0'] },
  { id: 'rainbow', label: '🌈 Rainbow', colors: ['#ff0000','#ff7700','#ffee00','#00cc00','#0033ff','#9900cc'] },
];

const CODE = `// Firing confetti on both local and remote peers
import confetti from 'canvas-confetti';

// Fire locally
confetti({
  particleCount: 150,
  spread: 80,
  origin: { x: Math.random(), y: 0.6 },
  colors: selectedColors,
});

// Broadcast to all peers via DataChannel
dc.send(JSON.stringify({ type: 'confetti', colors: selectedColors }));

// Receive and fire on remote peer
dc.onmessage = ({ data }) => {
  const { colors } = JSON.parse(data);
  confetti({ particleCount: 150, spread: 80, colors });
};`;

export default function ConfettiParty() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [roomId, setRoomId] = useState('PARTY01');
  const [joined, setJoined] = useState(false);
  const [fireCount, setFireCount] = useState(0);
  const [receivedCount, setReceivedCount] = useState(0);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const dataChannels = useRef(new Map<string, RTCDataChannel>());
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const fireConfetti = async (colors: string[], origin?: { x: number; y: number }) => {
    const confetti = (await import('canvas-confetti')).default;
    confetti({
      particleCount: 160,
      spread: 80,
      origin: origin ?? { x: Math.random() * 0.6 + 0.2, y: 0.65 },
      colors,
      ticks: 200,
    });
  };

  const broadcast = (msg: object) => {
    const s = JSON.stringify(msg);
    dataChannels.current.forEach((dc) => { if (dc.readyState === 'open') dc.send(s); });
  };

  const handleFire = async (type: typeof CONFETTI_TYPES[0]) => {
    await fireConfetti(type.colors);
    setFireCount((c) => c + 1);
    broadcast({ type: 'confetti', colors: type.colors, label: type.label });
    logger.info(`Fired ${type.label} confetti → broadcasting to ${dataChannels.current.size} peer(s)`);
  };

  const setupDc = (dc: RTCDataChannel, remotePeerId: string) => {
    dataChannels.current.set(remotePeerId, dc);
    dc.onopen = () => logger.success(`Party channel open with ${remotePeerId} 🎊`);
    dc.onmessage = async (ev) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'confetti') {
        await fireConfetti(msg.colors, { x: Math.random() * 0.6 + 0.2, y: 0.65 });
        setReceivedCount((c) => c + 1);
        logger.success(`Received ${msg.label ?? 'confetti'} from ${remotePeerId}! 🎉`);
      }
    };
  };

  const createPc = (remotePeerId: string) => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    peerConnections.current.set(remotePeerId, pc);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) sendRef.current({ type: 'ice-candidate', from: peerId, to: remotePeerId, candidate: ev.candidate.toJSON() });
    };
    pc.ondatachannel = (ev) => setupDc(ev.channel, remotePeerId);
    return pc;
  };

  const { connect, join, send } = useSignaling({
    logger,
    onMessage: async (msg: SignalingMessage) => {
      switch (msg.type) {
        case 'peer-list': {
          for (const peer of msg.peers) {
            const pc = createPc(peer.peerId);
            const dc = pc.createDataChannel('confetti');
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
    },
  });
  sendRef.current = send;

  const handleJoin = () => {
    connect();
    setTimeout(() => { join(roomId, peerId); setJoined(true); }, 500);
    logger.success(`Joined party room ${roomId} 🥳`);
  };

  const handleLeave = () => {
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    dataChannels.current.clear();
    setJoined(false);
  };

  return (
    <DemoLayout
      title="Confetti Party"
      difficulty="beginner"
      description="Trigger confetti explosions that sync to all peers in the room via RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>canvas-confetti</strong> is a tiny JavaScript library that fires canvas-based
            confetti animations. This demo wires it to a <strong>RTCDataChannel</strong>: when you
            fire confetti, a JSON message containing the color palette is broadcast to every peer in
            the room, triggering the same explosion in their browser.
          </p>
          <p>
            This pattern — fire an event locally, then broadcast via DataChannel for peers to
            replay — is a fundamental building block of real-time collaborative apps. The messages
            are tiny (under 200 bytes), but the effect is immediate and delightful.
          </p>
          <p className="text-amber-400/80">⚡ Requires the signaling server. Open multiple tabs with the same room code to party together!</p>
        </div>
      }
      hints={[
        'Open two or more tabs with the same room code',
        'Fire confetti in one tab — watch it explode in all the others!',
        'Each button sends a different color palette over the DataChannel',
      ]}
      demo={
        <div className="space-y-6">
          {/* Room controls */}
          <div className="flex flex-wrap gap-3 items-center">
            <input value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={joined}
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-zinc-200 w-28 focus:outline-none disabled:opacity-50" />
            {!joined ? (
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Join Party
              </button>
            ) : (
              <button onClick={handleLeave} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                Leave
              </button>
            )}
          </div>

          {/* Stats */}
          {joined && (
            <div className="flex gap-4 text-sm">
              <div className="bg-surface-0 border border-zinc-800 rounded-lg px-4 py-2">
                <span className="text-zinc-500">Fired: </span>
                <span className="text-blue-400 font-bold font-mono">{fireCount}</span>
              </div>
              <div className="bg-surface-0 border border-zinc-800 rounded-lg px-4 py-2">
                <span className="text-zinc-500">Received: </span>
                <span className="text-emerald-400 font-bold font-mono">{receivedCount}</span>
              </div>
            </div>
          )}

          {/* Confetti buttons */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {CONFETTI_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => handleFire(type)}
                disabled={!joined}
                className="relative h-16 rounded-xl text-sm font-bold disabled:opacity-40 hover:scale-105 active:scale-95 transition-all duration-100 overflow-hidden border border-zinc-700"
                style={{
                  background: `linear-gradient(135deg, ${type.colors[0]}33, ${type.colors[Math.floor(type.colors.length/2)]}33)`,
                }}
              >
                <div className="absolute inset-0 flex items-center justify-center gap-1">
                  {type.colors.slice(0, 5).map((c, i) => (
                    <div key={i} className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} />
                  ))}
                </div>
                <span className="absolute bottom-2 left-0 right-0 text-center text-xs text-zinc-200 font-semibold">
                  {type.label}
                </span>
              </button>
            ))}
          </div>

          <p className="text-xs text-zinc-500 text-center">
            {joined
              ? `Room: ${roomId} · Peer ID: ${peerId} · ${dataChannels.current.size} peer(s) connected`
              : 'Join a room first, then fire confetti across tabs!'}
          </p>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'canvas-confetti + RTCDataChannel broadcast' }}
      mdnLinks={[
        { label: 'canvas-confetti', href: 'https://github.com/catdad/canvas-confetti' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
