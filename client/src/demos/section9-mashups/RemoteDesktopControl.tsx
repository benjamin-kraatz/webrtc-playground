import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

// ─── Mini-app canvas dimensions ────────────────────────────────────────────
const AW = 480, AH = 360;
const PALETTE = ['#f38ba8', '#fab387', '#f9e2af', '#a6e3a1', '#89dceb', '#cba6f7'];

interface AppState {
  count: number;
  color: string;
  dots: { x: number; y: number; color: string; r: number }[];
  lastMsg: string;
}

// ─── Hit-test: click coordinates → state update ────────────────────────────
function applyClick(x: number, y: number, state: AppState): AppState {
  // − button  (20..80 × 50..90)
  if (x >= 20 && x <= 80 && y >= 50 && y <= 90)
    return { ...state, count: state.count - 1, lastMsg: `Count: ${state.count - 1}` };
  // + button  (AW-80..AW-20 × 50..90)
  if (x >= AW - 80 && x <= AW - 20 && y >= 50 && y <= 90)
    return { ...state, count: state.count + 1, lastMsg: `Count: ${state.count + 1}` };
  // Clear button  (10..120 × AH-42..AH-8)
  if (x >= 10 && x <= 120 && y >= AH - 42 && y <= AH - 8)
    return { ...state, dots: [], lastMsg: 'Canvas cleared!' };
  // Palette  (12+i*46 .. +40 × 132..172)
  for (let i = 0; i < 6; i++) {
    if (x >= 12 + i * 46 && x <= 52 + i * 46 && y >= 132 && y <= 172)
      return { ...state, color: PALETTE[i], lastMsg: `Color → ${PALETTE[i]}` };
  }
  return state;
}

function applyDraw(x: number, y: number, state: AppState): AppState {
  // Drawing area: 10..AW-10 × 180..AH-52
  if (x >= 10 && x <= AW - 10 && y >= 180 && y <= AH - 52)
    return { ...state, dots: [...state.dots, { x, y, color: state.color, r: 6 }] };
  return state;
}

// ─── Render mini-app to canvas ─────────────────────────────────────────────
function renderApp(ctx: CanvasRenderingContext2D, state: AppState, controlledBy: string | null) {
  // Background
  ctx.fillStyle = '#1e1e2e'; ctx.fillRect(0, 0, AW, AH);

  // Title bar
  ctx.fillStyle = '#313244'; ctx.fillRect(0, 0, AW, 38);
  ctx.fillStyle = '#cdd6f4'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'left';
  ctx.fillText('🖥️  Remote Desktop App', 10, 24);
  if (controlledBy) {
    ctx.fillStyle = '#a6e3a1'; ctx.font = '11px monospace'; ctx.textAlign = 'right';
    ctx.fillText(`⬡ Controlled by ${controlledBy}`, AW - 8, 24);
  }

  // Counter section
  ctx.fillStyle = '#313244';
  ctx.beginPath(); ctx.roundRect(10, 45, AW - 20, 80, 8); ctx.fill();

  // − button
  ctx.fillStyle = '#f38ba8';
  ctx.beginPath(); ctx.roundRect(18, 53, 64, 40, 6); ctx.fill();
  ctx.fillStyle = '#1e1e2e'; ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center';
  ctx.fillText('−', 50, 81);

  // Count display
  ctx.fillStyle = '#cdd6f4'; ctx.font = 'bold 40px monospace'; ctx.textAlign = 'center';
  ctx.fillText(String(state.count), AW / 2, 95);

  // + button
  ctx.fillStyle = '#a6e3a1';
  ctx.beginPath(); ctx.roundRect(AW - 82, 53, 64, 40, 6); ctx.fill();
  ctx.fillStyle = '#1e1e2e'; ctx.font = 'bold 28px monospace'; ctx.textAlign = 'center';
  ctx.fillText('+', AW - 50, 81);

  // Palette
  PALETTE.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.roundRect(12 + i * 46, 132, 40, 38, 5); ctx.fill();
    if (c === state.color) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(12 + i * 46, 132, 40, 38, 5); ctx.stroke();
    }
  });
  ctx.fillStyle = '#585b70'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText('COLOR PALETTE', 12, 128);

  // Drawing canvas area
  ctx.fillStyle = '#11111b';
  ctx.beginPath(); ctx.roundRect(10, 180, AW - 20, AH - 232, 6); ctx.fill();
  ctx.strokeStyle = '#45475a'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(10, 180, AW - 20, AH - 232, 6); ctx.stroke();
  ctx.fillStyle = '#313244'; ctx.font = '10px monospace'; ctx.textAlign = 'left';
  ctx.fillText('DRAWING CANVAS — Click to draw', 14, 176);

  // Draw dots
  for (const d of state.dots) {
    ctx.fillStyle = d.color;
    ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2); ctx.fill();
  }

  // Clear button
  ctx.fillStyle = '#45475a';
  ctx.beginPath(); ctx.roundRect(10, AH - 44, 110, 32, 6); ctx.fill();
  ctx.fillStyle = '#cdd6f4'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
  ctx.fillText('🗑 Clear', 65, AH - 22);

  // Last action message
  if (state.lastMsg) {
    ctx.fillStyle = '#a6e3a1'; ctx.font = '11px monospace'; ctx.textAlign = 'right';
    ctx.fillText(state.lastMsg, AW - 12, AH - 26);
  }
}

// ─── Code snippet ───────────────────────────────────────────────────────────
const CODE = `// Remote Desktop Control — full loop in 4 steps

// Step 1: Host renders interactive mini-app onto canvas
function renderApp(ctx, state) { /* draw buttons, counter, palette… */ }
appState = applyClick(x, y, appState); // process local interactions
renderApp(ctx, appState);

// Step 2: Stream the canvas to the guest via WebRTC
const stream = canvas.captureStream(30);
stream.getTracks().forEach(t => pc.addTrack(t, stream));

// Step 3: Guest overlay captures mouse events on the video element
videoEl.addEventListener('mousemove', e => {
  const { x, y } = normalizeCoords(e, videoEl);
  dc.send(JSON.stringify({ type: 'mousemove', x, y }));
});
videoEl.addEventListener('mousedown', e => dc.send(
  JSON.stringify({ type: 'mousedown', x, y })
));

// Step 4: Host applies remote events — canvas updates flow back to guest
dc.onmessage = ({ data }) => {
  const { type, x, y } = JSON.parse(data);
  const ax = x * AW, ay = y * AH; // de-normalize
  if (type === 'mousedown') appState = applyClick(ax, ay, appState);
  if (type === 'mousemove' && drawing) appState = applyDraw(ax, ay, appState);
  renderApp(ctx, appState, remotePeer); // → captureStream → WebRTC → guest sees it
};`;

export default function RemoteDesktopControl() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [roomId, setRoomId] = useState('REMOTE01');
  const [role, setRole] = useState<'host' | 'guest' | null>(null);
  const [joined, setJoined] = useState(false);
  const [peerConnected, setPeerConnected] = useState(false);
  const [controlMode, setControlMode] = useState(false); // guest: control is active
  const [remotePeerId, setRemotePeerId] = useState<string | null>(null);

  // Host-side refs
  const hostCanvasRef = useRef<HTMLCanvasElement>(null);
  const appStateRef = useRef<AppState>({ count: 0, color: PALETTE[0], dots: [], lastMsg: 'Waiting for guest…' });
  const rafRef = useRef<number>(0);
  const isDrawingRef = useRef(false);

  // Guest-side refs
  const guestVideoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const dataChannels = useRef(new Map<string, RTCDataChannel>());
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  // ── Render loop for host ────────────────────────────────────────────────
  const renderLoop = useCallback(() => {
    const canvas = hostCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    renderApp(ctx, appStateRef.current, remotePeerId);
    rafRef.current = requestAnimationFrame(renderLoop);
  }, [remotePeerId]);

  useEffect(() => {
    if (role === 'host') {
      rafRef.current = requestAnimationFrame(renderLoop);
      return () => cancelAnimationFrame(rafRef.current);
    }
  }, [role, renderLoop]);

  // ── Handle host-local mouse (when not being remote-controlled) ───────────
  const handleHostMouse = useCallback((e: React.MouseEvent, type: string) => {
    if (role !== 'host') return;
    const rect = hostCanvasRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (AW / rect.width);
    const y = (e.clientY - rect.top) * (AH / rect.height);
    if (type === 'mousedown' || type === 'click') {
      appStateRef.current = applyClick(x, y, appStateRef.current);
      isDrawingRef.current = true;
    }
    if (type === 'mousemove' && isDrawingRef.current)
      appStateRef.current = applyDraw(x, y, appStateRef.current);
    if (type === 'mouseup') isDrawingRef.current = false;
  }, [role]);

  // ── Handle guest overlay mouse → send over DataChannel ──────────────────
  const handleGuestMouse = useCallback((e: React.MouseEvent, type: string) => {
    if (!controlMode) return;
    const rect = overlayRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const msg = JSON.stringify({ type, x, y });
    dataChannels.current.forEach(dc => { if (dc.readyState === 'open') dc.send(msg); });
    e.preventDefault();
  }, [controlMode]);

  // ── DataChannel: host receives remote events ────────────────────────────
  const setupDc = useCallback((dc: RTCDataChannel, rpId: string) => {
    dataChannels.current.set(rpId, dc);
    dc.onopen = () => {
      setPeerConnected(true);
      setRemotePeerId(rpId);
      logger.success(`${role === 'host' ? 'Guest' : 'Host'} connected: ${rpId}`);
      if (role === 'host') {
        appStateRef.current = { ...appStateRef.current, lastMsg: `${rpId} joined! Take control →` };
      }
    };
    dc.onmessage = ev => {
      if (role !== 'host') return; // only host processes incoming events
      const msg = JSON.parse(ev.data as string);
      const ax = msg.x * AW, ay = msg.y * AH;
      if (msg.type === 'mousedown') {
        appStateRef.current = applyClick(ax, ay, appStateRef.current);
        isDrawingRef.current = true;
        logger.info(`Remote click @ (${ax.toFixed(0)}, ${ay.toFixed(0)})`);
      }
      if (msg.type === 'mousemove' && isDrawingRef.current)
        appStateRef.current = applyDraw(ax, ay, appStateRef.current);
      if (msg.type === 'mouseup') isDrawingRef.current = false;
    };
  }, [role]);

  // ── Peer connection factory ─────────────────────────────────────────────
  const createPc = useCallback((rpId: string) => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    peerConnections.current.set(rpId, pc);
    pc.onicecandidate = ev => {
      if (ev.candidate) sendRef.current({ type: 'ice-candidate', from: peerId, to: rpId, candidate: ev.candidate.toJSON() });
    };
    pc.ondatachannel = ev => setupDc(ev.channel, rpId);

    if (role === 'host') {
      // Stream the canvas to the guest
      const canvas = hostCanvasRef.current!;
      const stream = (canvas as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(30);
      stream.getTracks().forEach(t => pc.addTrack(t, stream));
      logger.info('Canvas stream added to peer connection');
    }
    if (role === 'guest') {
      // Receive the host's canvas stream
      pc.ontrack = ev => {
        const stream = ev.streams[0] ?? new MediaStream([ev.track]);
        if (guestVideoRef.current) { guestVideoRef.current.srcObject = stream; guestVideoRef.current.play(); }
        logger.success('Receiving host canvas stream!');
      };
    }
    return pc;
  }, [role, peerId, setupDc]);

  const { connect, join, send } = useSignaling({
    logger,
    onMessage: useCallback(async (msg: SignalingMessage) => {
      switch (msg.type) {
        case 'peer-list': {
          for (const peer of msg.peers) {
            const pc = createPc(peer.peerId);
            const dc = pc.createDataChannel('control', { ordered: true });
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

  const handleJoin = (r: 'host' | 'guest') => {
    setRole(r);
    connect();
    setTimeout(() => { join(roomId, peerId); setJoined(true); }, 500);
    logger.success(`Joined as ${r.toUpperCase()} in room ${roomId}`);
  };

  const handleLeave = () => {
    cancelAnimationFrame(rafRef.current);
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear(); dataChannels.current.clear();
    if (guestVideoRef.current) guestVideoRef.current.srcObject = null;
    setJoined(false); setRole(null); setPeerConnected(false);
    setControlMode(false); setRemotePeerId(null);
  };

  return (
    <DemoLayout
      title="Remote Desktop Control"
      difficulty="advanced"
      description="One peer streams a live canvas mini-app; the other peer controls it with their mouse via RTCDataChannel event injection."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This is how remote desktop software like TeamViewer works — at the WebRTC level.
            The <strong>Host</strong> renders an interactive mini-app entirely in a canvas and
            captures it with <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">canvas.captureStream(30)</code>,
            streaming it to the Guest as a video track.
          </p>
          <p>
            The <strong>Guest</strong> sees the live video and has an invisible interaction
            overlay on top. Mouse events (normalized to 0–1 fractions of the canvas size) are
            sent back to the Host over a <strong>RTCDataChannel</strong>. The Host de-normalizes
            the coordinates, applies them to the canvas app state (click buttons, paint,
            switch colors), re-renders, and the updated canvas flows back over WebRTC.
          </p>
          <p>
            This creates a complete remote control loop: <em>Guest click → DataChannel → Host
            applies → Canvas updates → WebRTC video → Guest sees result.</em> No plugins.
            No screen capture APIs. Just WebRTC.
          </p>
        </div>
      }
      hints={[
        'Tab 1 = Host (has the app). Tab 2 = Guest (controls it).',
        'As guest, click "Take Control" then interact with the video — you\'re controlling Tab 1!',
        'Host can also interact locally — multiple inputs merge on the same canvas state',
      ]}
      demo={
        <div className="space-y-5">
          {/* Room + Role Setup */}
          {!joined ? (
            <div className="space-y-3">
              <div className="flex gap-2 items-center">
                <input value={roomId} onChange={e => setRoomId(e.target.value)}
                  className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono w-36 focus:outline-none" />
                <span className="text-xs text-zinc-500">Room code</span>
              </div>
              <div className="flex gap-3">
                <button onClick={() => handleJoin('host')}
                  className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl flex flex-col items-center gap-0.5">
                  <span className="text-lg">🖥️</span>
                  <span className="text-sm">Join as Host</span>
                  <span className="text-xs opacity-70">Runs the app</span>
                </button>
                <button onClick={() => handleJoin('guest')}
                  className="px-5 py-3 bg-violet-600 hover:bg-violet-500 text-white font-bold rounded-xl flex flex-col items-center gap-0.5">
                  <span className="text-lg">🕹️</span>
                  <span className="text-sm">Join as Guest</span>
                  <span className="text-xs opacity-70">Controls the app</span>
                </button>
              </div>
              <p className="text-xs text-zinc-500">Open two tabs — one Host, one Guest — with the same room code.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Status bar */}
              <div className="flex items-center gap-3 flex-wrap">
                <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${role === 'host' ? 'bg-blue-900 text-blue-300' : 'bg-violet-900 text-violet-300'}`}>
                  {role === 'host' ? '🖥️ HOST' : '🕹️ GUEST'}
                </span>
                <span className={`text-xs ${peerConnected ? 'text-emerald-400' : 'text-amber-400 animate-pulse'}`}>
                  {peerConnected ? `✓ Peer connected: ${remotePeerId}` : 'Waiting for peer…'}
                </span>
                {role === 'guest' && peerConnected && (
                  <button
                    onClick={() => setControlMode(m => !m)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all ${controlMode ? 'border-rose-500 bg-rose-950/40 text-rose-300' : 'border-emerald-500 bg-emerald-950/40 text-emerald-300'}`}>
                    {controlMode ? '🔴 Release Control' : '🕹️ Take Control'}
                  </button>
                )}
                <button onClick={handleLeave} className="ml-auto px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300 rounded-lg border border-zinc-800">
                  Leave
                </button>
              </div>

              {/* Host: show the live canvas mini-app */}
              {role === 'host' && (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-500">Your live app (being streamed to guest)</p>
                  <canvas
                    ref={hostCanvasRef}
                    width={AW}
                    height={AH}
                    className="rounded-2xl border-2 border-blue-900/60 w-full max-w-xl block cursor-pointer"
                    style={{ background: '#1e1e2e' }}
                    onMouseDown={e => handleHostMouse(e, 'mousedown')}
                    onMouseMove={e => handleHostMouse(e, 'mousemove')}
                    onMouseUp={e => handleHostMouse(e, 'mouseup')}
                  />
                  <p className="text-xs text-zinc-600">You can also interact directly — you and the guest share control</p>
                </div>
              )}

              {/* Guest: show received video + interaction overlay */}
              {role === 'guest' && (
                <div className="space-y-2">
                  <p className="text-xs text-zinc-500">
                    {controlMode
                      ? '🕹️ You have control — click/drag on the video to interact'
                      : 'Live view of host\'s app — click "Take Control" to interact'}
                  </p>
                  <div className="relative inline-block w-full max-w-xl">
                    <video ref={guestVideoRef} muted playsInline
                      className={`rounded-2xl border-2 w-full block ${controlMode ? 'border-violet-500 cursor-pointer' : 'border-zinc-700 cursor-default'}`}
                      style={{ aspectRatio: `${AW}/${AH}`, background: '#1e1e2e' }}
                    />
                    {/* Interaction overlay */}
                    <div
                      ref={overlayRef}
                      className="absolute inset-0 rounded-2xl"
                      style={{ cursor: controlMode ? 'pointer' : 'default', pointerEvents: controlMode ? 'auto' : 'none' }}
                      onMouseDown={e => handleGuestMouse(e, 'mousedown')}
                      onMouseMove={e => handleGuestMouse(e, 'mousemove')}
                      onMouseUp={e => handleGuestMouse(e, 'mouseup')}
                    />
                    {!peerConnected && (
                      <div className="absolute inset-0 flex items-center justify-center bg-zinc-950/80 rounded-2xl">
                        <p className="text-zinc-400 text-sm animate-pulse">Waiting for host to join…</p>
                      </div>
                    )}
                    {controlMode && (
                      <div className="absolute top-2 left-2 px-2 py-1 bg-violet-600/90 rounded-lg text-xs text-white font-bold pointer-events-none">
                        🕹️ CONTROLLING
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'canvas.captureStream() + DataChannel event injection loop' }}
      mdnLinks={[
        { label: 'HTMLCanvasElement.captureStream()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
        { label: 'RTCPeerConnection.addTrack()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/addTrack' },
      ]}
    />
  );
}
