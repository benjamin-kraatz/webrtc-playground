import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const W = 560, H = 320;
const ROOM_W = W, ROOM_H = H;
const SPEED = 3;

type Effect = 'normal' | 'robot' | 'echo' | 'cathedral' | 'chipmunk' | 'underwater';
const EFFECT_LABELS: Record<Effect, string> = {
  normal: '🎤 Normal', robot: '🤖 Robot', echo: '🔁 Echo',
  cathedral: '⛪ Cathedral', chipmunk: '🐿 Chipmunk', underwater: '🌊 Underwater',
};
const EFFECT_COLORS: Record<Effect, string> = {
  normal: '#60a5fa', robot: '#a78bfa', echo: '#34d399',
  cathedral: '#fbbf24', chipmunk: '#f87171', underwater: '#38bdf8',
};

const CODE = `// MASHUP: VoiceChanger + SpatialAudioRoom
// Voice effects layered with 3D HRTF spatial audio positioning

// 1. Mic → voice effect chain
const mic = audioCtx.createMediaStreamSource(micStream);
const effect = createEffect(audioCtx, selectedEffect);
mic.connect(effect.input);

// 2. Effect → Panner (spatial positioning)
const panner = audioCtx.createPanner();
panner.panningModel = 'HRTF';
panner.distanceModel = 'inverse';
panner.refDistance = 80;
effect.output.connect(panner);

// 3. Panner → MediaStreamDestination → WebRTC
panner.connect(dest);
panner.setPosition(myX - W/2, 0, myY - H/2);

// 4. Sync avatar position via DataChannel
dc.send(JSON.stringify({ type: 'pos', x: myPos.x, y: myPos.y, effect }));`;

interface Avatar { x: number; y: number; effect: Effect; }

export default function EchoChamber() {
  const logger = useMemo(() => new Logger(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const [myPos, setMyPos] = useState<Avatar>({ x: 160, y: H / 2, effect: 'normal' });
  const [peerPos, setPeerPos] = useState<Avatar | null>(null);
  const myPosRef = useRef<Avatar>({ x: 160, y: H / 2, effect: 'normal' });
  const peerPosRef = useRef<Avatar | null>(null);
  const [effect, setEffect] = useState<Effect>('normal');
  const effectRef = useRef<Effect>('normal');
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const keysRef = useRef<Set<string>>(new Set());
  const audioCtxRef = useRef<AudioContext | null>(null);
  const pannerRef = useRef<PannerNode | null>(null);
  const effectNodeRef = useRef<{ input: AudioNode; output: AudioNode } | null>(null);

  const createEffect = (ctx: AudioContext, fx: Effect): { input: AudioNode; output: AudioNode } => {
    if (fx === 'normal') {
      const g = ctx.createGain(); g.gain.value = 1; return { input: g, output: g };
    }
    if (fx === 'robot') {
      const osc = ctx.createOscillator(); osc.frequency.value = 50; osc.type = 'sawtooth'; osc.start();
      const gain = ctx.createGain(); gain.gain.value = 0;
      osc.connect(gain.gain);
      const g = ctx.createGain(); return { input: g, output: g };
    }
    if (fx === 'echo') {
      const delay = ctx.createDelay(2); delay.delayTime.value = 0.3;
      const feedback = ctx.createGain(); feedback.gain.value = 0.45;
      const dry = ctx.createGain(); dry.gain.value = 0.7;
      const wet = ctx.createGain(); wet.gain.value = 0.5;
      const out = ctx.createGain();
      delay.connect(feedback); feedback.connect(delay);
      dry.connect(out); delay.connect(wet); wet.connect(out);
      return { input: dry, output: out };
    }
    if (fx === 'cathedral') {
      const convolver = ctx.createConvolver();
      const rate = ctx.sampleRate; const len = rate * 4;
      const buf = ctx.createBuffer(2, len, rate);
      for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
      convolver.buffer = buf;
      const g = ctx.createGain(); g.connect(convolver); return { input: g, output: convolver };
    }
    if (fx === 'chipmunk') {
      const g = ctx.createGain(); g.gain.value = 1.5; return { input: g, output: g };
    }
    if (fx === 'underwater') {
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 600;
      const lfo = ctx.createOscillator(); lfo.frequency.value = 3; lfo.start();
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 100;
      lfo.connect(lfoGain); lfoGain.connect(filter.frequency);
      return { input: filter, output: filter };
    }
    const g = ctx.createGain(); return { input: g, output: g };
  };

  const startAudio = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext(); audioCtxRef.current = ctx;
    const src = ctx.createMediaStreamSource(stream);
    const efxChain = createEffect(ctx, effectRef.current);
    effectNodeRef.current = efxChain;
    const panner = ctx.createPanner();
    panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse'; panner.refDistance = 80; panner.maxDistance = 600;
    pannerRef.current = panner;
    src.connect(efxChain.input); efxChain.output.connect(panner);
    const dest = ctx.createMediaStreamDestination();
    panner.connect(dest);
    // Setup WebRTC
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG), pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = e => e.candidate && pcB.addIceCandidate(e.candidate);
    pcB.onicecandidate = e => e.candidate && pcA.addIceCandidate(e.candidate);
    dest.stream.getTracks().forEach(t => pcA.addTrack(t, dest.stream));
    const dc = pcA.createDataChannel('pos'); dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Echo Chamber connected!'); };
    pcB.ondatachannel = ev => { ev.channel.onmessage = e => {
      const m = JSON.parse(e.data as string);
      if (m.type === 'pos') { setPeerPos({ x: m.x, y: m.y, effect: m.effect }); peerPosRef.current = { x: m.x, y: m.y, effect: m.effect }; }
    }; };
    pcB.ontrack = ev => {
      const audioEl = new Audio(); audioEl.srcObject = ev.streams[0]; audioEl.play().catch(() => {});
    };
    const offer = await pcA.createOffer(); await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer(); await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
    setRunning(true);
    logger.success('Room active — use WASD/arrows to move. Your voice effect changes with position!');
  };

  const syncPos = useCallback(() => {
    const pos = myPosRef.current;
    if (audioCtxRef.current) {
      audioCtxRef.current.listener.setPosition(
        (pos.x - W / 2) / 80, 0, (pos.y - H / 2) / 80
      );
    }
    if (pannerRef.current) pannerRef.current.setPosition(0, 0, 0);
    if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'pos', x: pos.x, y: pos.y, effect: pos.effect }));
  }, []);

  // Keyboard movement
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d'].includes(e.key)) {
        e.preventDefault(); keysRef.current.add(e.key);
      }
    };
    const offKey = (e: KeyboardEvent) => keysRef.current.delete(e.key);
    window.addEventListener('keydown', onKey); window.addEventListener('keyup', offKey);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', offKey); };
  }, []);

  // Move loop
  useEffect(() => {
    const tick = () => {
      const keys = keysRef.current;
      let dx = 0, dy = 0;
      if (keys.has('ArrowLeft') || keys.has('a')) dx -= SPEED;
      if (keys.has('ArrowRight') || keys.has('d')) dx += SPEED;
      if (keys.has('ArrowUp') || keys.has('w')) dy -= SPEED;
      if (keys.has('ArrowDown') || keys.has('s')) dy += SPEED;
      if (dx !== 0 || dy !== 0) {
        setMyPos(prev => {
          const newPos = { ...prev, x: Math.max(20, Math.min(W - 20, prev.x + dx)), y: Math.max(20, Math.min(H - 20, prev.y + dy)) };
          myPosRef.current = newPos; syncPos(); return newPos;
        });
      }
    };
    const id = setInterval(tick, 16);
    return () => clearInterval(id);
  }, [syncPos]);

  // Canvas render
  useEffect(() => {
    const draw = () => {
      const canvas = canvasRef.current; if (!canvas) { rafRef.current = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext('2d')!;
      // Room
      ctx.fillStyle = '#0a0a14'; ctx.fillRect(0, 0, W, H);
      // Grid
      ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      // Room border
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, W - 4, H - 4);

      // Draw avatars
      const drawAvatar = (pos: Avatar, label: string) => {
        const col = EFFECT_COLORS[pos.effect];
        // Glow
        const grd = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 35);
        grd.addColorStop(0, col + '44'); grd.addColorStop(1, 'transparent');
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(pos.x, pos.y, 35, 0, Math.PI * 2); ctx.fill();
        // Circle
        ctx.fillStyle = col; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pos.x, pos.y, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        // Label
        ctx.fillStyle = '#e2e8f0'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(label, pos.x, pos.y - 22);
        // Effect
        ctx.fillStyle = col; ctx.font = '10px sans-serif';
        ctx.fillText(EFFECT_LABELS[pos.effect].split(' ')[0], pos.x, pos.y + 30);
      };

      drawAvatar(myPosRef.current, 'You');
      if (peerPosRef.current) drawAvatar(peerPosRef.current, 'Peer');

      // Distance line between peers
      if (peerPosRef.current) {
        const d = Math.sqrt((myPosRef.current.x - peerPosRef.current.x) ** 2 + (myPosRef.current.y - peerPosRef.current.y) ** 2);
        ctx.strokeStyle = `rgba(255,255,255,${Math.max(0, 1 - d / 300) * 0.3})`;
        ctx.setLineDash([4, 6]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(myPosRef.current.x, myPosRef.current.y); ctx.lineTo(peerPosRef.current.x, peerPosRef.current.y); ctx.stroke();
        ctx.setLineDash([]);
      }

      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const changeEffect = (fx: Effect) => {
    setEffect(fx); effectRef.current = fx;
    setMyPos(prev => { const n = { ...prev, effect: fx }; myPosRef.current = n; syncPos(); return n; });
    logger.info(`Effect: ${EFFECT_LABELS[fx]}`);
  };

  return (
    <DemoLayout
      title="Echo Chamber"
      difficulty="advanced"
      description="MASHUP: VoiceChanger + SpatialAudioRoom — move your avatar with WASD. Your voice gets both a creative effect (robot, echo, cathedral…) AND 3D HRTF spatial positioning based on room location."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Your microphone signal passes through two processing stages:
          </p>
          <ol className="list-decimal list-inside space-y-1 pl-2">
            <li><strong>Voice Effect</strong>: Echo (delay+feedback), Cathedral (convolver), Robot (gain mod), Chipmunk (boost), Underwater (lowpass LFO)</li>
            <li><strong>HRTF Panner</strong>: Your avatar's XY position in the room maps to the Web Audio PannerNode's 3D XZ coordinates</li>
          </ol>
          <p>The processed stream is routed through a WebRTC loopback. Move away from the center to hear the spatial effect.</p>
        </div>
      }
      hints={[
        '🎧 Headphones recommended for spatial audio effect',
        'Move to opposite corners of the room for maximum distance effect',
        'Cathedral effect + far position = very immersive',
        'WASD or arrow keys to move your avatar',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            {!running && <button onClick={startAudio} className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white text-sm font-medium rounded-lg">🎤 Enter Chamber</button>}
            {connected && <span className="px-2 py-1 bg-teal-900/40 border border-teal-700 text-teal-300 text-xs rounded-lg">🔗 Connected</span>}
            <span className="text-xs text-zinc-500">Use WASD / Arrow keys to move</span>
          </div>
          {running && (
            <div className="flex flex-wrap gap-1">
              {(Object.keys(EFFECT_LABELS) as Effect[]).map(fx => (
                <button key={fx} onClick={() => changeEffect(fx)}
                  className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${effect === fx ? 'text-white' : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'}`}
                  style={effect === fx ? { borderColor: EFFECT_COLORS[fx], backgroundColor: EFFECT_COLORS[fx] + '33', color: EFFECT_COLORS[fx] } : {}}>
                  {EFFECT_LABELS[fx]}
                </button>
              ))}
            </div>
          )}
          <canvas ref={canvasRef} width={W} height={H} className="rounded-xl border border-zinc-800 w-full" tabIndex={0} />
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Voice effect chain + HRTF spatial panner' }}
      mdnLinks={[
        { label: 'PannerNode', href: 'https://developer.mozilla.org/en-US/docs/Web/API/PannerNode' },
        { label: 'ConvolverNode', href: 'https://developer.mozilla.org/en-US/docs/Web/API/ConvolverNode' },
      ]}
    />
  );
}
