import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const CODE = `// Cooperative drawing: Peer A controls X, Peer B controls Y
// Neither can draw alone!

// Peer A listens for left/right arrow keys, sends X over DataChannel
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft')  cursorX -= SPEED;
  if (e.key === 'ArrowRight') cursorX += SPEED;
  dc.send(JSON.stringify({ type: 'x', x: cursorX }));
});

// Peer B listens for up/down arrow keys, sends Y over DataChannel
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp')   cursorY -= SPEED;
  if (e.key === 'ArrowDown') cursorY += SPEED;
  dc.send(JSON.stringify({ type: 'y', y: cursorY }));
});

// Draw the combined position on the canvas
dc.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === 'x') cursorX = msg.x;
  if (msg.type === 'y') cursorY = msg.y;
  ctx.lineTo(cursorX, cursorY);
  ctx.stroke();
};`;

const SPEED = 3;
const W = 480, H = 320;

export default function EtchASketch() {
  const logger = useMemo(() => new Logger(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [connected, setConnected] = useState(false);
  const [mode, setMode] = useState<'both' | 'x-only' | 'y-only'>('both');
  const cursorRef = useRef({ x: W / 2, y: H / 2 });
  const keysRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number>(0);
  const dcARef = useRef<RTCDataChannel | null>(null);
  const [lineColor, setLineColor] = useState('#60a5fa');
  const drawingRef = useRef(false);

  const draw = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    if (!drawingRef.current) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      drawingRef.current = true;
    } else {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const gameLoop = () => {
    const canvas = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(gameLoop); return; }
    const ctx = canvas.getContext('2d')!;
    const c = cursorRef.current;
    let moved = false;

    const canMoveX = mode === 'both' || mode === 'x-only';
    const canMoveY = mode === 'both' || mode === 'y-only';

    if (canMoveX && keysRef.current.has('ArrowLeft'))  { c.x = Math.max(0, c.x - SPEED); moved = true; }
    if (canMoveX && keysRef.current.has('ArrowRight')) { c.x = Math.min(W, c.x + SPEED); moved = true; }
    if (canMoveY && keysRef.current.has('ArrowUp'))    { c.y = Math.max(0, c.y - SPEED); moved = true; }
    if (canMoveY && keysRef.current.has('ArrowDown'))  { c.y = Math.min(H, c.y + SPEED); moved = true; }

    if (moved) {
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      draw(ctx, c.x, c.y);

      if (dcARef.current?.readyState === 'open') {
        dcARef.current.send(JSON.stringify({ x: c.x, y: c.y }));
      }
    } else {
      drawingRef.current = false;
    }

    rafRef.current = requestAnimationFrame(gameLoop);
  };

  const connect = async () => {
    logger.info('Creating loopback DataChannel...');
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);

    const dc = pcA.createDataChannel('etch', { ordered: true });
    dcARef.current = dc;
    dc.onopen = () => {
      setConnected(true);
      logger.success('Connected! Use arrow keys to draw. Each axis is a separate DataChannel message.');
    };

    pcB.ondatachannel = (ev) => {
      ev.channel.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        logger.debug?.(`DataChannel: position (${msg.x.toFixed(0)}, ${msg.y.toFixed(0)})`);
      };
    };

    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);

    rafRef.current = requestAnimationFrame(gameLoop);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, W, H);
    cursorRef.current = { x: W / 2, y: H / 2 };
    drawingRef.current = false;
    logger.info('Canvas cleared');
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keysRef.current.add(e.key);
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const COLORS = ['#60a5fa', '#f87171', '#34d399', '#fbbf24', '#a78bfa', '#f9a8d4', '#ffffff'];

  return (
    <DemoLayout
      title="Cooperative Etch-a-Sketch"
      difficulty="beginner"
      description="Draw on a shared canvas — one peer controls X, the other controls Y via RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Inspired by the classic Etch-a-Sketch toy, this demo requires <em>two people to cooperate</em>:
            Peer A sends X-axis movements over a DataChannel; Peer B sends Y-axis movements. Neither can
            draw diagonals alone!
          </p>
          <p>
            In the <strong>Both</strong> mode, one player controls all four directions on a single
            page (demonstrating the DataChannel sync). Switch to <strong>X-only</strong> or{' '}
            <strong>Y-only</strong> mode to simulate playing as one of the two peers.
          </p>
          <p>
            Every key press sends a tiny JSON payload with the new cursor coordinates — under 30 bytes
            per message. This shows that DataChannels are perfectly suited for high-frequency,
            small-payload state sync like game inputs.
          </p>
        </div>
      }
      hints={[
        'Arrow keys move the cursor — connect first!',
        'Try X-only mode: you can only draw horizontal strokes',
        'In a real setup, one tab sends X, another sends Y — together you can draw anything',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!connected ? (
              <button onClick={connect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Connect
              </button>
            ) : (
              <button onClick={clearCanvas} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                Clear
              </button>
            )}

            <div className="flex items-center gap-1.5 text-xs text-zinc-500">
              Mode:
              {(['both', 'x-only', 'y-only'] as const).map((m) => (
                <button key={m} onClick={() => setMode(m)}
                  className={`px-2 py-1 rounded-md text-xs font-medium transition-colors ${mode === m ? 'bg-blue-600 text-white' : 'bg-surface-2 text-zinc-400 hover:bg-surface-3'}`}>
                  {m}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              {COLORS.map((c) => (
                <button key={c} onClick={() => setLineColor(c)}
                  className="w-6 h-6 rounded-full border-2 transition-all"
                  style={{ backgroundColor: c, borderColor: lineColor === c ? 'white' : 'transparent' }} />
              ))}
            </div>
          </div>

          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className="rounded-xl border border-zinc-800 bg-zinc-950 w-full max-w-xl block"
            style={{ cursor: 'crosshair' }}
          />

          <p className="text-xs text-zinc-500">
            {mode === 'both' ? '← → ↑ ↓ — full control' : mode === 'x-only' ? '← → — horizontal only (Peer A role)' : '↑ ↓ — vertical only (Peer B role)'}
          </p>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Cooperative drawing via DataChannel' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
