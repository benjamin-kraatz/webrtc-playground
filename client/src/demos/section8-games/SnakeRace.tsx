import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const COLS = 24, ROWS = 18, CELL = 22;
const W = COLS * CELL, H = ROWS * CELL;
const TICK_MS = 130;

interface Snake { body: Array<[number, number]>; dir: [number, number]; alive: boolean }
type Food = [number, number];

function randCell(): [number, number] {
  return [Math.floor(Math.random() * COLS), Math.floor(Math.random() * ROWS)];
}

function moveSnake(snake: Snake): Snake {
  if (!snake.alive) return snake;
  const [hx, hy] = snake.body[0];
  const [dx, dy] = snake.dir;
  const nx = (hx + dx + COLS) % COLS;
  const ny = (hy + dy + ROWS) % ROWS;
  return { ...snake, body: [[nx, ny], ...snake.body.slice(0, -1)] };
}

const CODE = `// Two-player snake race — food positions synced over DataChannel
// Each snake runs locally; when food is eaten, new food position is broadcast

tickInterval = setInterval(() => {
  snake1 = moveSnake(snake1);
  snake2 = moveSnake(snake2);

  // Check if snake1 ate food
  if (snake1.body[0][0] === food[0] && snake1.body[0][1] === food[1]) {
    snake1.body.push(snake1.body.at(-1)); // grow
    score1++;
    food = randomCell();
    dc.send(JSON.stringify({ type: 'food', food })); // sync new food
  }
  // (same for snake2)
  draw();
}, 130);

dc.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.type === 'food') food = msg.food;
};`;

export default function SnakeRace() {
  const logger = useMemo(() => new Logger(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snake1Ref = useRef<Snake>({ body: [[4,9],[3,9],[2,9]], dir: [1,0], alive: true });
  const snake2Ref = useRef<Snake>({ body: [[20,9],[21,9],[22,9]], dir: [-1,0], alive: true });
  const foodRef = useRef<Food>(randCell());
  const scoreRef = useRef([0, 0]);
  const keysRef = useRef<Set<string>>(new Set());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [playing, setPlaying] = useState(false);
  const [scores, setScores] = useState([0, 0]);
  const [gameOver, setGameOver] = useState<string | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const [connected, setConnected] = useState(false);

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= COLS; x++) { ctx.beginPath(); ctx.moveTo(x*CELL,0); ctx.lineTo(x*CELL,H); ctx.stroke(); }
    for (let y = 0; y <= ROWS; y++) { ctx.beginPath(); ctx.moveTo(0,y*CELL); ctx.lineTo(W,y*CELL); ctx.stroke(); }

    // Food
    const [fx, fy] = foodRef.current;
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath(); ctx.arc(fx*CELL+CELL/2, fy*CELL+CELL/2, CELL/2-2, 0, Math.PI*2); ctx.fill();

    const drawSnake = (s: Snake, color: string, headColor: string) => {
      s.body.forEach(([bx, by], i) => {
        const r = i === 0 ? CELL/2-1 : CELL/2-3;
        ctx.fillStyle = i === 0 ? headColor : color;
        ctx.beginPath();
        ctx.roundRect(bx*CELL+2, by*CELL+2, CELL-4, CELL-4, i === 0 ? 6 : 4);
        ctx.fill();
        if (i === 0) {
          // Eyes
          ctx.fillStyle = '#000';
          const [dx, dy] = s.dir;
          const ex = bx*CELL+CELL/2 + dy*4;
          const ey = by*CELL+CELL/2 + dx*4;
          ctx.beginPath(); ctx.arc(ex+dy*2, ey-dx*2, 2, 0, Math.PI*2); ctx.fill();
          ctx.beginPath(); ctx.arc(ex-dy*2, ey+dx*2, 2, 0, Math.PI*2); ctx.fill();
        }
        void r;
      });
    };

    if (snake1Ref.current.alive) drawSnake(snake1Ref.current, '#3b82f6', '#60a5fa');
    if (snake2Ref.current.alive) drawSnake(snake2Ref.current, '#ef4444', '#f87171');
  };

  const tick = () => {
    const keys = keysRef.current;
    const s1 = snake1Ref.current;
    const s2 = snake2Ref.current;

    // Change direction based on keys
    if (keys.has('w') || keys.has('W')) { if (s1.dir[1] !== 1)  s1.dir = [0,-1]; }
    if (keys.has('s') || keys.has('S')) { if (s1.dir[1] !== -1) s1.dir = [0,1]; }
    if (keys.has('a') || keys.has('A')) { if (s1.dir[0] !== 1)  s1.dir = [-1,0]; }
    if (keys.has('d') || keys.has('D')) { if (s1.dir[0] !== -1) s1.dir = [1,0]; }
    if (keys.has('ArrowUp'))    { if (s2.dir[1] !== 1)  s2.dir = [0,-1]; }
    if (keys.has('ArrowDown'))  { if (s2.dir[1] !== -1) s2.dir = [0,1]; }
    if (keys.has('ArrowLeft'))  { if (s2.dir[0] !== 1)  s2.dir = [-1,0]; }
    if (keys.has('ArrowRight')) { if (s2.dir[0] !== -1) s2.dir = [1,0]; }

    const ns1 = moveSnake(s1);
    const ns2 = moveSnake(s2);

    // Self collision
    const hitsSelf = (s: Snake) => s.body.slice(1).some(([bx,by]) => bx===s.body[0][0] && by===s.body[0][1]);
    if (hitsSelf(ns1)) { ns1.alive = false; }
    if (hitsSelf(ns2)) { ns2.alive = false; }

    const food = foodRef.current;
    const head1 = ns1.body[0], head2 = ns2.body[0];
    const ate1 = head1[0]===food[0] && head1[1]===food[1];
    const ate2 = head2[0]===food[0] && head2[1]===food[1];

    if (ate1 && ns1.alive) {
      ns1.body.push([...ns1.body[ns1.body.length - 1]] as [number, number]);
      scoreRef.current[0]++;
      const newFood = randCell();
      foodRef.current = newFood;
      if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'food', food: newFood }));
      logger.info(`🔵 Blue snake ate food! Score: ${scoreRef.current[0]}`);
    }
    if (ate2 && ns2.alive) {
      ns2.body.push([...ns2.body[ns2.body.length - 1]] as [number, number]);
      scoreRef.current[1]++;
      const newFood = randCell();
      foodRef.current = newFood;
      if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'food', food: newFood }));
      logger.info(`🔴 Red snake ate food! Score: ${scoreRef.current[1]}`);
    }

    setScores([...scoreRef.current]);
    snake1Ref.current = ns1;
    snake2Ref.current = ns2;

    if (!ns1.alive || !ns2.alive) {
      clearInterval(tickRef.current!);
      setPlaying(false);
      const winner = !ns1.alive && !ns2.alive ? 'Draw!' : !ns1.alive ? '🔴 Red wins!' : '🔵 Blue wins!';
      setGameOver(winner);
      logger.success(`Game over! ${winner}`);
    }
    draw();
  };

  const startGame = async () => {
    snake1Ref.current = { body: [[4,9],[3,9],[2,9]], dir: [1,0], alive: true };
    snake2Ref.current = { body: [[20,9],[21,9],[22,9]], dir: [-1,0], alive: true };
    foodRef.current = randCell();
    scoreRef.current = [0, 0];
    setScores([0, 0]);
    setGameOver(null);
    setPlaying(true);
    draw();

    if (!connected) {
      const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
      pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);
      const dc = pcA.createDataChannel('snake', { ordered: false, maxRetransmits: 0 });
      dcRef.current = dc;
      dc.onopen = () => { setConnected(true); logger.success('Food sync connected!'); };
      pcB.ondatachannel = (ev) => {
        ev.channel.onmessage = (e) => {
          const msg = JSON.parse(e.data as string);
          if (msg.type === 'food') foodRef.current = msg.food;
        };
      };
      const offer = await pcA.createOffer();
      await pcA.setLocalDescription(offer);
      await pcB.setRemoteDescription(offer);
      const answer = await pcB.createAnswer();
      await pcB.setLocalDescription(answer);
      await pcA.setRemoteDescription(answer);
    }

    tickRef.current = setInterval(tick, TICK_MS);
    logger.success('Game started! WASD = Blue · Arrows = Red');
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      keysRef.current.add(e.key);
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.key);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); clearInterval(tickRef.current!); };
  }, []);

  return (
    <DemoLayout
      title="Snake Race"
      difficulty="intermediate"
      description="Two snakes compete for the same food — food positions sync over RTCDataChannel to keep both players in sync."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Classic Snake, but competitive: Blue (WASD) and Red (↑↓←→) share the same food
            pellet. Whoever eats it first makes it disappear for the other, and a new food
            position is announced over a <strong>RTCDataChannel</strong> so both players always
            see the same apple.
          </p>
          <p>
            This demonstrates <em>authoritative state broadcast</em>: the peer that triggers a
            state change (eating food) is responsible for generating the new state (new food
            position) and broadcasting it. In a multi-device game you'd pick one peer as
            server or use consensus — but the DataChannel mechanism is identical.
          </p>
        </div>
      }
      hints={[
        '🔵 Blue snake: WASD keys',
        '🔴 Red snake: Arrow keys',
        'Snakes wrap around the edges — you can\'t die by hitting walls!',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-blue-500" />
              <span className="text-sm font-mono text-zinc-300">WASD: {scores[0]}</span>
            </div>
            <button
              onClick={startGame}
              className={`px-4 py-2 text-white text-sm font-medium rounded-lg ${playing ? 'bg-amber-600' : 'bg-emerald-600 hover:bg-emerald-500'}`}
              disabled={playing}
            >
              {playing ? 'Playing…' : gameOver ? '↩ Restart' : 'Start Race'}
            </button>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-red-500" />
              <span className="text-sm font-mono text-zinc-300">Arrows: {scores[1]}</span>
            </div>
          </div>

          {gameOver && (
            <div className="bg-amber-950/40 border border-amber-800 rounded-xl p-3 text-center">
              <p className="text-amber-300 font-bold text-lg">{gameOver}</p>
              <p className="text-zinc-400 text-sm">Final: Blue {scores[0]} – Red {scores[1]}</p>
            </div>
          )}

          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className="rounded-xl border border-zinc-800 w-full max-w-2xl block"
            style={{ background: '#09090b' }}
          />
          <p className="text-xs text-zinc-600">Click the canvas area, then use keyboard controls</p>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Snake race with DataChannel food sync' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
