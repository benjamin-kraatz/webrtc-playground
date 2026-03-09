import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

const RW = 560, RH = 320, AVATAR_R = 18;
const COLORS = ['#60a5fa','#f87171','#34d399','#fbbf24','#a78bfa','#fb923c'];

interface Avatar { id: string; x: number; y: number; color: string; name: string }

function hashColor(id: string): string { let h = 0; for (const c of id) h = (h*31+c.charCodeAt(0))>>>0; return COLORS[h % COLORS.length]; }

const CODE = `// Spatial Audio Room — 3D audio panning based on 2D avatar positions
// Uses Web Audio API PannerNode for each remote peer

const audioCtx = new AudioContext();

// For each remote peer's incoming audio track:
function addSpatialAudioPeer(track, remotePeerId) {
  const src = audioCtx.createMediaStreamSource(new MediaStream([track]));
  const panner = audioCtx.createPanner();
  panner.panningModel = 'HRTF';      // Head-Related Transfer Function
  panner.distanceModel = 'inverse';
  panner.refDistance = 1;
  panner.maxDistance = 400;
  panner.rolloffFactor = 1.5;
  src.connect(panner);
  panner.connect(audioCtx.destination);
  panners.set(remotePeerId, panner);
}

// When a peer moves, update their panner position
dc.onmessage = ({ data }) => {
  const { id, x, y } = JSON.parse(data);
  const panner = panners.get(id);
  if (panner) {
    // Map room 2D coords → 3D space (y becomes -z in Web Audio)
    panner.positionX.setValueAtTime(x - RW/2, audioCtx.currentTime);
    panner.positionY.setValueAtTime(0, audioCtx.currentTime);
    panner.positionZ.setValueAtTime(-(y - RH/2), audioCtx.currentTime);
  }
};

// Set listener position (your own avatar)
audioCtx.listener.positionX.setValueAtTime(myX - RW/2, audioCtx.currentTime);
audioCtx.listener.positionZ.setValueAtTime(-(myY - RH/2), audioCtx.currentTime);`;

export default function SpatialAudioRoom() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const myColor = useMemo(() => hashColor(peerId), [peerId]);
  const [roomId, setRoomId] = useState('SPATIAL01');
  const [joined, setJoined] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [avatars, setAvatars] = useState<Map<string, Avatar>>(new Map());
  const [myPos, setMyPos] = useState({ x: RW/2, y: RH/2 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pannersRef = useRef<Map<string, PannerNode>>(new Map());
  const myStreamRef = useRef<MediaStream | null>(null);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const dataChannels = useRef(new Map<string, RTCDataChannel>());
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});
  const myPosRef = useRef(myPos);
  myPosRef.current = myPos;
  const avatarsRef = useRef(avatars);
  avatarsRef.current = avatars;
  const rafRef = useRef<number>(0);
  const myNameRef = useRef(`User-${peerId.slice(0,4)}`);

  const broadcastPos = useCallback((x: number, y: number) => {
    const msg = JSON.stringify({ type: 'pos', id: peerId, x, y, color: myColor, name: myNameRef.current });
    dataChannels.current.forEach(dc => { if (dc.readyState === 'open') dc.send(msg); });
  }, [peerId, myColor]);

  const updateListenerPos = (x: number, y: number) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    ctx.listener.positionX.setTargetAtTime(x - RW/2, ctx.currentTime, 0.05);
    ctx.listener.positionY.setTargetAtTime(0, ctx.currentTime, 0.05);
    ctx.listener.positionZ.setTargetAtTime(-(y - RH/2), ctx.currentTime, 0.05);
  };

  const updatePannerPos = (id: string, x: number, y: number) => {
    const ctx = audioCtxRef.current;
    const panner = pannersRef.current.get(id);
    if (!ctx || !panner) return;
    panner.positionX.setTargetAtTime(x - RW/2, ctx.currentTime, 0.05);
    panner.positionY.setTargetAtTime(0, ctx.currentTime, 0.05);
    panner.positionZ.setTargetAtTime(-(y - RH/2), ctx.currentTime, 0.05);
  };

  const addAudioPeer = useCallback((track: MediaStreamTrack, remotePeerId: string) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 80;
    panner.maxDistance = 600;
    panner.rolloffFactor = 1.5;
    src.connect(panner);
    panner.connect(ctx.destination);
    pannersRef.current.set(remotePeerId, panner);
    // Set initial position far away
    panner.positionX.value = 200;
    panner.positionZ.value = 0;
    logger.info(`Added spatial audio for ${remotePeerId}`);
  }, [logger]);

  const setupDc = useCallback((dc: RTCDataChannel, rpId: string) => {
    dataChannels.current.set(rpId, dc);
    dc.onopen = () => {
      logger.success(`Room channel open with ${rpId}`);
      // Send our initial position
      broadcastPos(myPosRef.current.x, myPosRef.current.y);
    };
    dc.onclose = () => {
      setAvatars(prev => { const next = new Map(prev); next.delete(rpId); return next; });
      pannersRef.current.delete(rpId);
    };
    dc.onmessage = ev => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'pos') {
        setAvatars(prev => {
          const next = new Map(prev);
          next.set(msg.id, { id: msg.id, x: msg.x, y: msg.y, color: msg.color, name: msg.name });
          return next;
        });
        updatePannerPos(msg.id, msg.x, msg.y);
      }
    };
  }, [broadcastPos]);

  const createPc = useCallback((rpId: string) => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    peerConnections.current.set(rpId, pc);
    pc.onicecandidate = ev => { if (ev.candidate) sendRef.current({ type: 'ice-candidate', from: peerId, to: rpId, candidate: ev.candidate.toJSON() }); };
    pc.ondatachannel = ev => setupDc(ev.channel, rpId);
    myStreamRef.current?.getAudioTracks().forEach(t => pc.addTrack(t, myStreamRef.current!));
    pc.ontrack = ev => { addAudioPeer(ev.track, rpId); };
    return pc;
  }, [peerId, setupDc, addAudioPeer]);

  const { connect, join, send } = useSignaling({
    logger,
    onMessage: useCallback(async (msg: SignalingMessage) => {
      switch (msg.type) {
        case 'peer-list': {
          for (const peer of msg.peers) {
            const pc = createPc(peer.peerId);
            const dc = pc.createDataChannel('spatial'); setupDc(dc, peer.peerId);
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

  const handleJoin = async () => {
    try {
      logger.info('Requesting microphone...');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }, video: false });
      myStreamRef.current = stream;
      setMicActive(true);
      audioCtxRef.current = new AudioContext();
      // Set initial listener orientation (facing -Z)
      audioCtxRef.current.listener.forwardX.value = 0;
      audioCtxRef.current.listener.forwardY.value = 0;
      audioCtxRef.current.listener.forwardZ.value = -1;
      connect();
      setTimeout(() => { join(roomId, peerId); setJoined(true); }, 500);
      logger.success(`Joined spatial room ${roomId} — move your avatar to change who you hear!`);
    } catch (e) { logger.error(`Mic error: ${e}`); }
  };

  const handleLeave = () => {
    myStreamRef.current?.getTracks().forEach(t => t.stop());
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear(); dataChannels.current.clear();
    pannersRef.current.clear();
    setJoined(false); setMicActive(false); setAvatars(new Map());
  };

  // Draw room
  const drawRoom = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(drawRoom); return; }
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, RW, RH);

    // Floor grid
    ctx.strokeStyle = 'rgba(99,102,241,0.15)'; ctx.lineWidth = 1;
    for (let x = 0; x < RW; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,RH); ctx.stroke(); }
    for (let y = 0; y < RH; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(RW,y); ctx.stroke(); }

    // Walls
    ctx.strokeStyle = '#1e3a5f'; ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, RW-6, RH-6);

    // Distance rings around my avatar
    const p = myPosRef.current;
    [80, 160, 280].forEach(r => {
      ctx.strokeStyle = `rgba(99,102,241,${0.15-r*0.0003})`; ctx.lineWidth = 1;
      ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(99,102,241,0.4)'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`${r}px`, p.x+r-10, p.y);
    });

    // Remote avatars with distance lines
    for (const av of avatarsRef.current.values()) {
      const dist = Math.hypot(av.x - p.x, av.y - p.y);
      const vol = Math.max(0, 1 - dist / 280);
      ctx.strokeStyle = av.color + '40'; ctx.lineWidth = 1; ctx.setLineDash([3,3]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(av.x, av.y); ctx.stroke();
      ctx.setLineDash([]);
      const grd = ctx.createRadialGradient(av.x,av.y,0,av.x,av.y,AVATAR_R*2);
      grd.addColorStop(0, av.color+'80'); grd.addColorStop(1, av.color+'00');
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(av.x,av.y,AVATAR_R*2,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = av.color; ctx.beginPath(); ctx.arc(av.x,av.y,AVATAR_R,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = 'white'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      ctx.fillText(av.name.slice(0,6), av.x, av.y+4);
      ctx.fillStyle = av.color; ctx.font = '9px monospace';
      ctx.fillText(`${Math.round(vol*100)}%`, av.x, av.y+AVATAR_R+12);
      // Sound wave rings
      if (vol > 0.1) {
        for (let i = 1; i <= 2; i++) {
          ctx.strokeStyle = av.color + Math.floor(vol*80).toString(16).padStart(2,'0');
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(av.x, av.y, AVATAR_R + i*10 + (Date.now()/100 % 20), 0, Math.PI*2);
          ctx.stroke();
        }
      }
    }

    // My avatar (always on top)
    ctx.fillStyle = myColor + '40'; ctx.beginPath(); ctx.arc(p.x,p.y,AVATAR_R*1.5,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = myColor; ctx.beginPath(); ctx.arc(p.x,p.y,AVATAR_R,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'white'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x,p.y,AVATAR_R,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle = 'white'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
    ctx.fillText('YOU', p.x, p.y+4);

    rafRef.current = requestAnimationFrame(drawRoom);
  }, [myColor]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(drawRoom);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawRoom]);

  const handleRoomClick = (e: React.MouseEvent) => {
    if (!joined) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const x = Math.max(AVATAR_R, Math.min(RW-AVATAR_R, (e.clientX-rect.left)*(RW/rect.width)));
    const y = Math.max(AVATAR_R, Math.min(RH-AVATAR_R, (e.clientY-rect.top)*(RH/rect.height)));
    setMyPos({ x, y });
    myPosRef.current = { x, y };
    updateListenerPos(x, y);
    broadcastPos(x, y);
  };

  return (
    <DemoLayout
      title="Spatial Audio Room"
      difficulty="advanced"
      description="A virtual 2D room where proximity controls volume — Web Audio PannerNode gives every peer 3D positional audio."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            The <strong>Web Audio API's PannerNode</strong> simulates 3D sound by applying
            Head-Related Transfer Functions (HRTF) — the subtle timing and spectral differences
            between your two ears. By mapping each peer's 2D room position into a 3D coordinate,
            their voice gets louder as you approach and quieter (with stereo panning) as you move away.
          </p>
          <p>
            Every time you click to move, your position is broadcast over a{' '}
            <strong>DataChannel</strong>. The receiving peer calls{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">panner.positionX/Z.setTargetAtTime()</code>
            for smooth interpolation — no abrupt volume jumps. Audio is streamed directly
            via WebRTC tracks without any server processing.
          </p>
          <p className="text-amber-400/80">⚡ Use headphones for best 3D effect! Open multiple tabs with the same room code.</p>
        </div>
      }
      hints={[
        'Open 2+ tabs with the same room code — then move avatars around',
        'Use headphones — the HRTF stereo panning effect is much clearer',
        'The percentage shown under each avatar is the current audio volume level',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <input value={roomId} onChange={e => setRoomId(e.target.value)} disabled={joined}
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono w-32 focus:outline-none disabled:opacity-50" />
            {!joined ? (
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">🎤 Join Room</button>
            ) : (
              <button onClick={handleLeave} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">Leave</button>
            )}
            {joined && <span className="text-xs text-zinc-500">{avatars.size} peer{avatars.size !== 1 ? 's' : ''} in room</span>}
          </div>
          <canvas ref={canvasRef} width={RW} height={RH}
            className="rounded-2xl border border-zinc-800 w-full max-w-2xl block"
            style={{ background: '#0f172a', cursor: joined ? 'pointer' : 'default' }}
            onClick={handleRoomClick} />
          <p className="text-xs text-zinc-500">
            {joined ? 'Click anywhere to move your avatar — peer voices change volume and stereo position' : 'Join a room to see the spatial audio in action'}
          </p>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Web Audio PannerNode spatial positioning from DataChannel' }}
      mdnLinks={[
        { label: 'PannerNode', href: 'https://developer.mozilla.org/en-US/docs/Web/API/PannerNode' },
        { label: 'AudioListener', href: 'https://developer.mozilla.org/en-US/docs/Web/API/AudioListener' },
      ]}
    />
  );
}
