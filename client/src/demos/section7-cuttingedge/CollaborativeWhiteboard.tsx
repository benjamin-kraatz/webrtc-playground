import { useMemo, useRef, useState, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

interface DrawEvent {
  type: 'draw' | 'clear';
  x?: number;
  y?: number;
  px?: number;
  py?: number;
  color: string;
  width: number;
}

const CODE = `// Sync canvas strokes via RTCDataChannel
dc.onmessage = (ev) => {
  const event = JSON.parse(ev.data);
  if (event.type === 'draw') {
    ctx.strokeStyle = event.color;
    ctx.lineWidth = event.width;
    ctx.beginPath();
    ctx.moveTo(event.px, event.py);
    ctx.lineTo(event.x, event.y);
    ctx.stroke();
  }
};`;

export default function CollaborativeWhiteboard() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [roomId, setRoomId] = useState('DRAW01');
  const [joined, setJoined] = useState(false);
  const [color, setColor] = useState('#60a5fa');
  const [brushSize, setBrushSize] = useState(3);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const dataChannels = useRef(new Map<string, RTCDataChannel>());

  const broadcast = (event: DrawEvent) => {
    const msg = JSON.stringify(event);
    dataChannels.current.forEach((dc) => { if (dc.readyState === 'open') dc.send(msg); });
  };

  const applyEvent = (event: DrawEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    if (event.type === 'clear') {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    } else if (event.type === 'draw' && event.px != null && event.py != null) {
      ctx.strokeStyle = event.color;
      ctx.lineWidth = event.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(event.px, event.py);
      ctx.lineTo(event.x!, event.y!);
      ctx.stroke();
    }
  };

  const setupDc = (dc: RTCDataChannel, remotePeerId: string) => {
    dataChannels.current.set(remotePeerId, dc);
    dc.onopen = () => logger.success(`Whiteboard channel open with ${remotePeerId}`);
    dc.onmessage = (ev) => applyEvent(JSON.parse(ev.data as string));
    dc.onclose = () => dataChannels.current.delete(remotePeerId);
  };

  const createPc = useCallback((remotePeerId: string, sendFn: (msg: import('@/types/signaling').SignalingMessage) => void) => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    peerConnections.current.set(remotePeerId, pc);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) sendFn({ type: 'ice-candidate', from: peerId, to: remotePeerId, candidate: ev.candidate.toJSON() });
    };
    pc.ondatachannel = (ev) => setupDc(ev.channel, remotePeerId);
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
            const dc = pc.createDataChannel('whiteboard', { ordered: true });
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
        case 'peer-left':
          peerConnections.current.get(msg.peerId)?.close();
          peerConnections.current.delete(msg.peerId);
          dataChannels.current.delete(msg.peerId);
          break;
      }
    }, [createPc, peerId]),
  });
  sendRef.current = send;

  const handleJoin = () => {
    connect();
    setTimeout(() => { join(roomId, peerId); setJoined(true); }, 500);
  };

  const handleLeave = () => {
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    dataChannels.current.clear();
    setJoined(false);
  };

  const getPos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = canvasRef.current!.width / rect.width;
    const scaleY = canvasRef.current!.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDrawing.current = true;
    lastPos.current = getPos(e);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || !lastPos.current) return;
    const pos = getPos(e);
    const event: DrawEvent = {
      type: 'draw',
      x: pos.x, y: pos.y,
      px: lastPos.current.x, py: lastPos.current.y,
      color: tool === 'eraser' ? '#09090b' : color,
      width: tool === 'eraser' ? brushSize * 5 : brushSize,
    };
    applyEvent(event);
    broadcast(event);
    lastPos.current = pos;
  };

  const handleMouseUp = () => { isDrawing.current = false; lastPos.current = null; };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    broadcast({ type: 'clear', color, width: brushSize });
  };

  return (
    <DemoLayout
      title="Collaborative Whiteboard"
      difficulty="advanced"
      description="Draw together on a shared canvas — strokes sync via RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>A real-time shared whiteboard. Each stroke is serialized as a small JSON event and broadcast to all connected peers via RTCDataChannels in a mesh topology.</p>
          <p className="text-amber-400/80">⚡ Requires signaling server. Open multiple tabs with the same room code.</p>
        </div>
      }
      demo={
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-zinc-500">Signaling: <span className={status === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{status}</span></span>
            <input value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={joined}
              className="bg-surface-0 border border-zinc-700 rounded-lg px-2 py-1 text-sm font-mono text-zinc-200 w-20 focus:outline-none disabled:opacity-50" />
            {!joined ? (
              <button onClick={handleJoin} className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg">Join</button>
            ) : (
              <button onClick={handleLeave} className="px-3 py-1 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm rounded-lg">Leave</button>
            )}
          </div>

          <div className="flex gap-2 flex-wrap items-center">
            <button onClick={() => setTool('pen')} className={`px-3 py-1 text-sm rounded-lg ${tool === 'pen' ? 'bg-surface-2 text-zinc-100' : 'text-zinc-500'}`}>✏ Pen</button>
            <button onClick={() => setTool('eraser')} className={`px-3 py-1 text-sm rounded-lg ${tool === 'eraser' ? 'bg-surface-2 text-zinc-100' : 'text-zinc-500'}`}>⬜ Eraser</button>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-8 h-7 rounded cursor-pointer" />
            <input type="range" min={1} max={20} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-20 accent-blue-400" />
            <span className="text-xs text-zinc-500">{brushSize}px</span>
            <button onClick={handleClear} className="px-3 py-1 bg-red-900/50 text-red-400 text-sm rounded-lg border border-red-800 ml-auto">Clear All</button>
          </div>

          <canvas ref={canvasRef} width={1000} height={550}
            className="w-full bg-surface-0 border border-zinc-800 rounded-xl cursor-crosshair"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Canvas stroke sync via RTCDataChannel' }}
      mdnLinks={[{ label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' }]}
    />
  );
}
