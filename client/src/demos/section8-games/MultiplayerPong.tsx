import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

interface GameState {
  ballX: number;
  ballY: number;
  ballVx: number;
  ballVy: number;
  paddleL: number;
  paddleR: number;
  scoreL: number;
  scoreR: number;
}

const W = 600, H = 360;
const PADDLE_H = 80, PADDLE_W = 12;
const BALL_R = 8;
const PADDLE_SPEED = 5;
const INITIAL_SPEED = 4;

const CODE = `// Multiplayer Pong via RTCDataChannel
// Left paddle (Peer A) sends its Y position to Peer B
dc.send(JSON.stringify({ type: 'paddle', y: paddleY }));

// Right paddle (Peer B) sends its Y position to Peer A
dc.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === 'paddle') remotePaddleY = msg.y;
};

// Ball physics run on the same page; DataChannel
// demonstrates how inputs would sync in a real network game.
// In a real game, you'd pick one peer as the "authority"
// and broadcast authoritative state, not just inputs.`;

export default function MultiplayerPong() {
  const logger = useMemo(() => new Logger(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>({
    ballX: W / 2, ballY: H / 2,
    ballVx: INITIAL_SPEED, ballVy: INITIAL_SPEED,
    paddleL: H / 2 - PADDLE_H / 2,
    paddleR: H / 2 - PADDLE_H / 2,
    scoreL: 0, scoreR: 0,
  });
  const keysRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number>(0);
  const dcARef = useRef<RTCDataChannel | null>(null);
  const [connected, setConnected] = useState(false);
  const [scores, setScores] = useState({ l: 0, r: 0 });

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  const resetBall = (dir: 1 | -1) => {
    const s = stateRef.current;
    s.ballX = W / 2;
    s.ballY = H / 2;
    s.ballVx = INITIAL_SPEED * dir;
    s.ballVy = (Math.random() > 0.5 ? 1 : -1) * INITIAL_SPEED;
  };

  const gameLoop = useCallback(() => {
    const s = stateRef.current;
    const canvas = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(gameLoop); return; }
    const ctx = canvas.getContext('2d')!;

    // Move left paddle (W/S)
    if (keysRef.current.has('w') || keysRef.current.has('W')) s.paddleL = clamp(s.paddleL - PADDLE_SPEED, 0, H - PADDLE_H);
    if (keysRef.current.has('s') || keysRef.current.has('S')) s.paddleL = clamp(s.paddleL + PADDLE_SPEED, 0, H - PADDLE_H);

    // Move right paddle (arrows)
    if (keysRef.current.has('ArrowUp'))   s.paddleR = clamp(s.paddleR - PADDLE_SPEED, 0, H - PADDLE_H);
    if (keysRef.current.has('ArrowDown')) s.paddleR = clamp(s.paddleR + PADDLE_SPEED, 0, H - PADDLE_H);

    // Send paddle positions over DataChannel (simulates network sync)
    if (dcARef.current?.readyState === 'open') {
      dcARef.current.send(JSON.stringify({ type: 'paddle', side: 'left', y: s.paddleL }));
    }

    // Move ball
    s.ballX += s.ballVx;
    s.ballY += s.ballVy;

    // Wall bounce (top/bottom)
    if (s.ballY - BALL_R < 0) { s.ballY = BALL_R; s.ballVy = Math.abs(s.ballVy); }
    if (s.ballY + BALL_R > H) { s.ballY = H - BALL_R; s.ballVy = -Math.abs(s.ballVy); }

    // Paddle collisions
    if (
      s.ballX - BALL_R < PADDLE_W + 10 &&
      s.ballY > s.paddleL && s.ballY < s.paddleL + PADDLE_H
    ) {
      s.ballVx = Math.abs(s.ballVx) * 1.05;
      s.ballVy += ((s.ballY - (s.paddleL + PADDLE_H / 2)) / (PADDLE_H / 2)) * 2;
    }
    if (
      s.ballX + BALL_R > W - PADDLE_W - 10 &&
      s.ballY > s.paddleR && s.ballY < s.paddleR + PADDLE_H
    ) {
      s.ballVx = -Math.abs(s.ballVx) * 1.05;
      s.ballVy += ((s.ballY - (s.paddleR + PADDLE_H / 2)) / (PADDLE_H / 2)) * 2;
    }

    // Cap speed
    const speed = Math.hypot(s.ballVx, s.ballVy);
    if (speed > 14) { s.ballVx = s.ballVx / speed * 14; s.ballVy = s.ballVy / speed * 14; }

    // Score
    if (s.ballX < 0) {
      s.scoreR++;
      setScores({ l: s.scoreL, r: s.scoreR });
      resetBall(-1);
      logger.info(`Right scores! ${s.scoreL}:${s.scoreR}`);
    }
    if (s.ballX > W) {
      s.scoreL++;
      setScores({ l: s.scoreL, r: s.scoreR });
      resetBall(1);
      logger.info(`Left scores! ${s.scoreL}:${s.scoreR}`);
    }

    // Draw
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, W, H);

    // Center line
    ctx.setLineDash([10, 10]);
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.setLineDash([]);

    // Paddles
    ctx.fillStyle = '#60a5fa';
    ctx.beginPath(); ctx.roundRect(10, s.paddleL, PADDLE_W, PADDLE_H, 4); ctx.fill();
    ctx.fillStyle = '#f87171';
    ctx.beginPath(); ctx.roundRect(W - PADDLE_W - 10, s.paddleR, PADDLE_W, PADDLE_H, 4); ctx.fill();

    // Ball
    ctx.fillStyle = '#fafafa';
    ctx.beginPath(); ctx.arc(s.ballX, s.ballY, BALL_R, 0, Math.PI * 2); ctx.fill();

    // Score text
    ctx.fillStyle = '#52525b';
    ctx.font = 'bold 48px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(s.scoreL), W / 4, 60);
    ctx.fillText(String(s.scoreR), (W * 3) / 4, 60);

    rafRef.current = requestAnimationFrame(gameLoop);
  }, []);

  const connect = async () => {
    logger.info('Creating loopback DataChannel for paddle sync...');
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);

    const dc = pcA.createDataChannel('pong', { ordered: false, maxRetransmits: 0 });
    dcARef.current = dc;
    dc.onopen = () => {
      setConnected(true);
      logger.success('Channel open — use W/S (left) and ↑/↓ (right) to play!');
    };

    pcB.ondatachannel = (ev) => {
      ev.channel.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'paddle') logger.debug?.(`DataChannel: left paddle Y = ${msg.y.toFixed(0)}`);
      };
    };

    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);

    stateRef.current = { ballX: W/2, ballY: H/2, ballVx: INITIAL_SPEED, ballVy: INITIAL_SPEED, paddleL: H/2-PADDLE_H/2, paddleR: H/2-PADDLE_H/2, scoreL: 0, scoreR: 0 };
    rafRef.current = requestAnimationFrame(gameLoop);
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keysRef.current.add(e.key);
      if (['ArrowUp','ArrowDown'].includes(e.key)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); cancelAnimationFrame(rafRef.current); };
  }, []);

  return (
    <DemoLayout
      title="Multiplayer Pong"
      difficulty="intermediate"
      description="Classic Pong with paddle sync via RTCDataChannel — two players, one page."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>Real-time game networking</strong> relies on fast, low-latency data delivery —
            exactly what <strong>RTCDataChannel</strong> in unreliable (UDP-like) mode provides.
            Each frame, Peer A sends its left paddle position to Peer B. In a real cross-device
            game, both peers would run the same physics locally (<em>client-side prediction</em>)
            while syncing authoritative state to avoid drift.
          </p>
          <p>
            Here the game runs on one page (loopback), so you can see both sides simultaneously.
            The DataChannel messages are logged so you can observe the paddle-sync messages flying
            past in the log panel.
          </p>
        </div>
      }
      hints={[
        'Left paddle: W / S keys',
        'Right paddle: ↑ / ↓ arrow keys',
        'DataChannel uses unreliable mode (maxRetransmits: 0) — like UDP',
      ]}
      demo={
        <div className="space-y-4">
          {!connected ? (
            <button onClick={connect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
              Start Game
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-8 text-sm">
                <span className="text-blue-400 font-bold">← W/S</span>
                <span className="text-xl font-mono font-bold text-zinc-300">{scores.l} : {scores.r}</span>
                <span className="text-rose-400 font-bold">↑/↓ →</span>
              </div>
              <canvas
                ref={canvasRef}
                width={W}
                height={H}
                className="rounded-xl border border-zinc-800 w-full max-w-2xl block mx-auto"
                style={{ background: '#09090b' }}
              />
              <p className="text-xs text-zinc-500 text-center">Focus this area, then use keyboard keys to control paddles</p>
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Paddle sync via RTCDataChannel' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
