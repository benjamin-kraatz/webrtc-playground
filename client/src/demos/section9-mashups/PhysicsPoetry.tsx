import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import Matter from 'matter-js';

const W = 560, H = 400;
const WORD_COLORS = ['#f87171','#fb923c','#fbbf24','#34d399','#60a5fa','#a78bfa','#f472b6','#38bdf8'];
let colorIndex = 0;

const CODE = `// MASHUP: P2PChat + PhysicsWhiteboard
// Chat words become Matter.js rigid body physics objects

import Matter from 'matter-js';
const { Engine, World, Bodies } = Matter;

const engine = Engine.create({ gravity: { y: 1.0 } });

// For each word in a message:
function spawnWord(word, color) {
  const ctx = measureCtx;
  ctx.font = 'bold 15px monospace';
  const w = ctx.measureText(word).width + 24;
  
  const body = Bodies.rectangle(
    Math.random() * 400 + 80, // x: scattered across top
    -60,                       // y: above canvas (falls in)
    w, 38,                    // width, height
    { restitution: 0.6, friction: 0.3, label: word }
  );
  body.color = color; // custom property
  World.add(engine.world, body);
}

// Sync with peer
dc.send(JSON.stringify({ type: 'words', words: ['Hello', 'world'], color }));`;

interface WordBody {
  body: Matter.Body;
  word: string;
  color: string;
  w: number;
  h: number;
}

export default function PhysicsPoetry() {
  const logger = useMemo(() => new Logger(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Matter.Engine | null>(null);
  const wordBodiesRef = useRef<WordBody[]>([]);
  const rafRef = useRef<number>(0);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{ text: string; from: 'you' | 'peer'; color: string }[]>([]);

  // Setup Matter.js
  useEffect(() => {
    const engine = Matter.Engine.create({ gravity: { y: 1.2 } });
    engineRef.current = engine;

    // Walls
    const floor = Matter.Bodies.rectangle(W/2, H + 30, W + 100, 60, { isStatic: true });
    const wallL = Matter.Bodies.rectangle(-30, H/2, 60, H, { isStatic: true });
    const wallR = Matter.Bodies.rectangle(W + 30, H/2, 60, H, { isStatic: true });
    Matter.World.add(engine.world, [floor, wallL, wallR]);

    // Measure context for text widths
    const mc = document.createElement('canvas').getContext('2d')!;
    mc.font = 'bold 15px monospace';
    measureCtxRef.current = mc;

    // Render loop
    const draw = () => {
      Matter.Engine.update(engine, 1000 / 60);
      const canvas = canvasRef.current; if (!canvas) { rafRef.current = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#0d0d14'; ctx.fillRect(0, 0, W, H);

      // Ground
      ctx.fillStyle = '#1e1e2e'; ctx.fillRect(0, H - 10, W, 10);

      for (const wb of wordBodiesRef.current) {
        const { position: { x, y }, angle } = wb.body;
        ctx.save();
        ctx.translate(x, y); ctx.rotate(angle);
        // Word box
        const bw = wb.w, bh = wb.h;
        ctx.fillStyle = wb.color + '33';
        ctx.strokeStyle = wb.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.roundRect(-bw/2, -bh/2, bw, bh, 6); ctx.fill(); ctx.stroke();
        // Word text
        ctx.fillStyle = wb.color;
        ctx.font = 'bold 15px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(wb.word, 0, 0);
        ctx.restore();
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(rafRef.current); Matter.Engine.clear(engine); };
  }, []);

  const spawnWords = (words: string[], color: string, fromRemote = false) => {
    const engine = engineRef.current; if (!engine) return;
    const mc = measureCtxRef.current!;
    mc.font = 'bold 15px monospace';
    words.forEach((word, i) => {
      if (!word.trim()) return;
      const tw = mc.measureText(word).width;
      const bw = tw + 24, bh = 38;
      const x = 80 + Math.random() * (W - 200) + i * 30;
      const body = Matter.Bodies.rectangle(x, -60 - i * 50, bw, bh, {
        restitution: 0.55, friction: 0.3, frictionAir: 0.01,
        angle: (Math.random() - 0.5) * 0.4,
      });
      Matter.World.add(engine.world, body);
      wordBodiesRef.current.push({ body, word, color, w: bw, h: bh });
    });
    if (!fromRemote && dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'words', words, color }));
    }
  };

  const shakeAll = () => {
    for (const wb of wordBodiesRef.current) {
      Matter.Body.applyForce(wb.body, wb.body.position, { x: (Math.random() - 0.5) * 0.08, y: -Math.random() * 0.12 });
    }
  };

  const clearAll = () => {
    const engine = engineRef.current; if (!engine) return;
    wordBodiesRef.current.forEach(wb => Matter.World.remove(engine.world, wb.body));
    wordBodiesRef.current = [];
    if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'clear' }));
  };

  const sendMessage = () => {
    if (!input.trim()) return;
    const color = WORD_COLORS[colorIndex++ % WORD_COLORS.length];
    const words = input.trim().split(/\s+/);
    setMessages(prev => [...prev.slice(-10), { text: input.trim(), from: 'you', color }]);
    spawnWords(words, color);
    setInput('');
    logger.info(`Sent: "${input.trim()}" → ${words.length} word${words.length > 1 ? 's' : ''} launched`);
  };

  const connectLoopback = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG), pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = e => e.candidate && pcB.addIceCandidate(e.candidate);
    pcB.onicecandidate = e => e.candidate && pcA.addIceCandidate(e.candidate);
    const dc = pcA.createDataChannel('poetry'); dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Physics Poetry synced!'); };
    pcB.ondatachannel = ev => {
      ev.channel.onmessage = e => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'words') { spawnWords(msg.words, msg.color, true); setMessages(prev => [...prev.slice(-10), { text: msg.words.join(' '), from: 'peer', color: msg.color }]); }
        if (msg.type === 'clear') { clearAll(); }
      };
    };
    const offer = await pcA.createOffer(); await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer(); await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  return (
    <DemoLayout
      title="Physics Poetry"
      difficulty="intermediate"
      description="MASHUP: P2PChat + PhysicsWhiteboard — type messages and watch each word become a Matter.js physics body. Words fall, bounce, and pile up. Poetry arranged by gravity."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Every word in your message is converted into a <strong>Matter.js rigid body</strong>
            — a rectangle sized to fit the word. Words are spawned above the canvas and fall
            under gravity, bouncing off walls and each other.
          </p>
          <p>
            Messages are transmitted as word arrays over <strong>RTCDataChannel</strong>.
            The receiving peer spawns identical physics bodies, but from random X positions —
            so the same words arrange themselves differently on each side.
          </p>
        </div>
      }
      hints={[
        'Long messages make beautiful word avalanches',
        'Click "Shake" after a pile builds up',
        'Connect loopback and chat — words rain down on both sides',
        'Try typing a haiku: each line becomes its own physics event',
      ]}
      demo={
        <div className="space-y-3">
          <div className="flex gap-2">
            {!connected && <button onClick={connectLoopback} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg">🔗 Connect Loopback</button>}
            {connected && <span className="px-2 py-1 bg-blue-900/40 border border-blue-700 text-blue-300 text-xs rounded-lg">🔗 Synced</span>}
            <button onClick={shakeAll} className="px-3 py-1.5 bg-orange-700 hover:bg-orange-600 text-white text-xs rounded-lg">💥 Shake</button>
            <button onClick={clearAll} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg">🗑 Clear</button>
          </div>
          <canvas ref={canvasRef} width={W} height={H} className="rounded-xl border border-zinc-800 w-full" />
          <div className="flex gap-2">
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendMessage()}
              placeholder="Type poetry... (Enter to send)"
              className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 placeholder-zinc-500" />
            <button onClick={sendMessage} disabled={!input.trim()}
              className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm rounded-lg">Send</button>
          </div>
          {messages.length > 0 && (
            <div className="space-y-1 max-h-20 overflow-y-auto">
              {messages.map((m, i) => (
                <div key={i} className="flex gap-2 text-xs">
                  <span className="text-zinc-500">{m.from === 'you' ? 'You' : 'Peer'}:</span>
                  <span style={{ color: m.color }}>{m.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Chat words → Matter.js physics bodies' }}
      mdnLinks={[
        { label: 'Matter.js', href: 'https://brm.io/matter-js/' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
