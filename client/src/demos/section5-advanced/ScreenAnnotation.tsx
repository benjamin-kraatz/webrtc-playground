import { useMemo, useRef, useState, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

interface Stroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
}

const CODE = `// Screen share + annotation overlay
// 1. Share screen via getDisplayMedia
// 2. Render annotation canvas on top
// 3. Sync strokes via RTCDataChannel
dc.send(JSON.stringify({ type: 'stroke', stroke }));`;

export default function ScreenAnnotation() {
  const logger = useMemo(() => new Logger(), []);
  const [roomId] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase());
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [joined, setJoined] = useState(false);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [color, setColor] = useState('#ef4444');
  const [brushSize, setBrushSize] = useState(3);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  const isDrawing = useRef(false);
  const currentStroke = useRef<Stroke | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remotePeerRef = useRef<string | null>(null);

  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const { status, connect, join, send } = useSignaling({
    logger,
    onMessage: useCallback(async (msg: import('@/types/signaling').SignalingMessage) => {
      const pc = pcRef.current;
      if (!pc) return;
      switch (msg.type) {
        case 'peer-joined':
          remotePeerRef.current = msg.peerId;
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendRef.current({ type: 'offer', from: peerId, to: msg.peerId, sdp: offer });
          } catch (e) { logger.error(`${e}`); }
          break;
        case 'offer':
          remotePeerRef.current = msg.from;
          try {
            await pc.setRemoteDescription(msg.sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendRef.current({ type: 'answer', from: peerId, to: msg.from, sdp: answer });
          } catch (e) { logger.error(`${e}`); }
          break;
        case 'answer':
          try { await pc.setRemoteDescription(msg.sdp); } catch (e) { logger.error(`${e}`); }
          break;
        case 'ice-candidate':
          try { await pc.addIceCandidate(msg.candidate); } catch (e) { logger.warn(`${e}`); }
          break;
      }
    }, [peerId, logger]),
  });
  sendRef.current = send;

  const handleJoin = async () => {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
      if (screenRef.current) screenRef.current.srcObject = screen;
      screen.getVideoTracks()[0].onended = handleLeave;

      const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      pcRef.current = pc;
      pc.onconnectionstatechange = () => setConnectionState(pc.connectionState);
      pc.onicecandidate = (ev) => {
        if (ev.candidate && remotePeerRef.current) {
          send({ type: 'ice-candidate', from: peerId, to: remotePeerRef.current, candidate: ev.candidate.toJSON() });
        }
      };

      // Data channel for annotation sync
      const dc = pc.createDataChannel('annotations', { ordered: true });
      dcRef.current = dc;
      dc.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string);
        if (msg.type === 'stroke') {
          setStrokes((prev) => [...prev, msg.stroke]);
          drawStroke(msg.stroke);
        } else if (msg.type === 'clear') {
          setStrokes([]);
          clearCanvas();
        }
      };

      pc.ondatachannel = (ev) => {
        dcRef.current = ev.channel;
        ev.channel.onmessage = dc.onmessage;
      };

      screen.getTracks().forEach((t) => pc.addTrack(t, screen));

      pc.ontrack = (ev) => {
        if (screenRef.current) screenRef.current.srcObject = ev.streams[0];
        logger.success('Remote screen received');
      };

      connect();
      setTimeout(() => { join(roomId, peerId); setJoined(true); }, 500);
      logger.success('Joined room — share with another tab');
    } catch (e) { logger.error(`Failed: ${e}`); }
  };

  const handleLeave = () => {
    pcRef.current?.close();
    setJoined(false);
    setConnectionState('new');
    if (screenRef.current) screenRef.current.srcObject = null;
  };

  const drawStroke = (stroke: Stroke) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    stroke.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    isDrawing.current = true;
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = canvasRef.current!.width / rect.width;
    const scaleY = canvasRef.current!.height / rect.height;
    currentStroke.current = {
      points: [{ x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }],
      color,
      width: brushSize,
    };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current || !currentStroke.current) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const scaleX = canvasRef.current!.width / rect.width;
    const scaleY = canvasRef.current!.height / rect.height;
    const pt = { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    currentStroke.current.points.push(pt);
    // Draw incrementally
    const ctx = canvasRef.current!.getContext('2d')!;
    const pts = currentStroke.current.points;
    ctx.strokeStyle = color;
    ctx.lineWidth = brushSize;
    ctx.lineCap = 'round';
    if (pts.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
    }
  };

  const handleMouseUp = () => {
    if (!currentStroke.current) return;
    isDrawing.current = false;
    const stroke = currentStroke.current;
    setStrokes((prev) => [...prev, stroke]);
    dcRef.current?.send(JSON.stringify({ type: 'stroke', stroke }));
    currentStroke.current = null;
  };

  const handleClear = () => {
    clearCanvas();
    setStrokes([]);
    dcRef.current?.send(JSON.stringify({ type: 'clear' }));
  };

  return (
    <DemoLayout
      title="Screen Share + Annotation"
      difficulty="advanced"
      description="Share your screen and annotate it collaboratively via WebSocket signaling."
      explanation={
        <div className="space-y-3 text-sm">
          <p>Combines screen sharing with a transparent annotation canvas. Strokes are synced via RTCDataChannel in real time.</p>
          <p className="text-amber-400/80">⚡ Requires the signaling server (<code className="text-xs bg-surface-2 px-1 py-0.5 rounded">bun run dev</code>) and two tabs.</p>
        </div>
      }
      demo={
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <ConnectionStatus state={connectionState} />
            <span className="text-xs text-zinc-500">Signaling: <span className={status === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{status}</span></span>
            <span className="text-xs text-zinc-500 font-mono">Room: {roomId}</span>
          </div>

          <div className="flex gap-2 flex-wrap">
            {!joined ? (
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Share Screen & Join
              </button>
            ) : (
              <button onClick={handleLeave} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                Leave
              </button>
            )}
            {joined && (
              <>
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-8 h-9 rounded cursor-pointer" />
                <input type="range" min={1} max={20} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} className="w-24 accent-blue-400 self-center" />
                <button onClick={handleClear} className="px-3 py-2 bg-red-900/50 text-red-400 text-sm rounded-lg border border-red-800">Clear</button>
              </>
            )}
          </div>

          <div className="relative aspect-video bg-zinc-900 rounded-xl overflow-hidden">
            <video ref={screenRef} autoPlay playsInline muted className="w-full h-full object-contain" />
            <canvas ref={canvasRef} width={1280} height={720}
              className="absolute inset-0 w-full h-full cursor-crosshair"
              style={{ pointerEvents: joined ? 'auto' : 'none' }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Screen + annotation sync' }}
      mdnLinks={[{ label: 'getDisplayMedia()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia' }]}
    />
  );
}
