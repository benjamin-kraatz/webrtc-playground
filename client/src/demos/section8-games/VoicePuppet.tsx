import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

type Anim = 'idle' | 'wave' | 'jump' | 'spin' | 'dance' | 'sad' | 'happy' | 'run' | 'flip';

const COMMANDS: Array<{ patterns: RegExp[]; anim: Anim; label: string }> = [
  { patterns: [/\b(wave|hello|hi|hey)\b/i],          anim: 'wave',  label: '👋 Wave'  },
  { patterns: [/\b(jump|up|leap|hop)\b/i],            anim: 'jump',  label: '⬆ Jump'  },
  { patterns: [/\b(spin|turn|rotate|twirl)\b/i],      anim: 'spin',  label: '🌀 Spin'  },
  { patterns: [/\b(dance|boogie|groove|party)\b/i],   anim: 'dance', label: '💃 Dance' },
  { patterns: [/\b(sad|cry|sob|unhappy|down)\b/i],    anim: 'sad',   label: '😢 Sad'   },
  { patterns: [/\b(happy|joy|yay|woohoo|yes)\b/i],    anim: 'happy', label: '😊 Happy' },
  { patterns: [/\b(run|go|sprint|dash|move)\b/i],     anim: 'run',   label: '🏃 Run'   },
  { patterns: [/\b(flip|backflip|somersault)\b/i],    anim: 'flip',  label: '🤸 Flip'  },
];

const CODE = `// Voice-Controlled Puppet — Web Speech API → canvas character → DataChannel

const recognition = new webkitSpeechRecognition();
recognition.continuous = true;
recognition.interimResults = false;

recognition.onresult = (event) => {
  const text = event.results[event.results.length - 1][0].transcript.toLowerCase();
  const anim = matchCommand(text); // pattern match against 8 commands
  if (anim) {
    playAnimation(anim);                      // local
    dc.send(JSON.stringify({ type: 'anim', anim })); // broadcast to peer
  }
};

// Both peers always see the same character perform the command
dc.onmessage = ({ data }) => {
  const { anim } = JSON.parse(data);
  playAnimation(anim); // remote-triggered animation
};

// Canvas character drawn with simple geometry
// ctx.save(); ctx.translate(x, y); ctx.rotate(tilt); ctx.scale(scale, scale); ctx.restore();
`;

export default function VoicePuppet() {
  const logger = useMemo(() => new Logger(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const [listening, setListening] = useState(false);
  const [connected, setConnected] = useState(false);
  const [currentAnim, setCurrentAnim] = useState<Anim>('idle');
  const [transcript, setTranscript] = useState('');
  const [lastCommand, setLastCommand] = useState('');
  const recognitionRef = useRef<unknown>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const animRef = useRef<{ name: Anim; frame: number; total: number }>({ name: 'idle', frame: 0, total: 0 });

  const W = 480, H = 320;

  // ── Animation state machine ───────────────────────────────────────────────
  const playAnim = (name: Anim) => {
    const totals: Record<Anim, number> = { idle: 999, wave: 80, jump: 60, spin: 90, dance: 120, sad: 100, happy: 80, run: 100, flip: 70 };
    animRef.current = { name, frame: 0, total: totals[name] };
    setCurrentAnim(name);
  };

  // ── Canvas rendering ─────────────────────────────────────────────────────
  const drawCharacter = (ctx: CanvasRenderingContext2D, a: { name: Anim; frame: number }) => {
    const t = a.frame / Math.max(1, animRef.current.total);
    const sin = Math.sin, cos = Math.cos, PI = Math.PI;
    const f = a.frame;

    // Compute pose based on animation
    let bodyY = 0, bodyScale = 1, tilt = 0, armL = -PI/4, armR = PI/4, legL = 0, legR = 0;
    let eyeScale = 1, mouthCurve = 0, blinkOffset = 0;

    if (a.name === 'idle') {
      bodyY = sin(f * 0.04) * 3; armL = -PI/4 + sin(f*0.03)*0.1; armR = PI/4 - sin(f*0.03)*0.1; eyeScale = f%120 < 5 ? 0.1 : 1; mouthCurve = 0.3;
    } else if (a.name === 'wave') {
      armR = PI/4 + sin(f*0.3)*0.8; armL = -PI/4; mouthCurve = 0.5;
    } else if (a.name === 'jump') {
      bodyY = -sin(t*PI)*80; legL = -sin(t*PI)*0.4; legR = sin(t*PI)*0.4; bodyScale = 1+sin(t*PI)*0.1; mouthCurve = 0.5;
    } else if (a.name === 'spin') {
      tilt = t * PI * 4; bodyScale = 1 + sin(t*PI*4)*0.05; mouthCurve = 0.5;
    } else if (a.name === 'dance') {
      bodyY = sin(f*0.2)*12; tilt = sin(f*0.2)*0.2; armL = -PI/4 + sin(f*0.15)*0.6; armR = PI/4 - cos(f*0.15)*0.6; legL = sin(f*0.15)*0.3; legR = -sin(f*0.15)*0.3; mouthCurve = 0.6;
    } else if (a.name === 'sad') {
      bodyY = 8; tilt = 0.1; armL = PI/4; armR = -PI/4; mouthCurve = -0.5; eyeScale = 0.6; blinkOffset = 8;
    } else if (a.name === 'happy') {
      bodyY = -sin(f*0.4)*8; bodyScale = 1+sin(f*0.4)*0.08; armL = -PI*0.7; armR = PI*0.7; mouthCurve = 0.7; eyeScale = 1.2;
    } else if (a.name === 'run') {
      bodyY = -Math.abs(sin(f*0.25))*8; tilt = sin(f*0.25)*0.15; armL = sin(f*0.25)*0.8; armR = -sin(f*0.25)*0.8; legL = sin(f*0.25)*0.5; legR = -sin(f*0.25)*0.5;
    } else if (a.name === 'flip') {
      tilt = t * PI * 2; bodyY = -sin(t*PI)*60; bodyScale = 1+sin(t*PI)*0.1; mouthCurve = 0.5;
    }

    ctx.save();
    ctx.translate(W/2, H*0.65 + bodyY);
    ctx.rotate(tilt);
    ctx.scale(bodyScale, bodyScale);

    const col = { body:'#60a5fa', head:'#fde68a', limb:'#60a5fa', eye:'#1e293b', pupil:'#fff' };

    // Legs
    const drawLimb = (angle: number, length: number, x: number) => {
      ctx.save(); ctx.translate(x, 28); ctx.rotate(angle);
      ctx.fillStyle = col.limb; ctx.beginPath(); ctx.roundRect(-5, 0, 10, length, 5); ctx.fill();
      ctx.restore();
    };
    drawLimb(legL, 36, -12); drawLimb(legR, 36, 12);

    // Body
    ctx.fillStyle = col.body;
    ctx.beginPath(); ctx.roundRect(-20, -10, 40, 50, 8); ctx.fill();

    // Arms
    ctx.save(); ctx.translate(-20, 5); ctx.rotate(armL);
    ctx.fillStyle = col.limb; ctx.beginPath(); ctx.roundRect(-8, 0, 10, 30, 5); ctx.fill(); ctx.restore();
    ctx.save(); ctx.translate(20, 5); ctx.rotate(armR);
    ctx.fillStyle = col.limb; ctx.beginPath(); ctx.roundRect(-2, 0, 10, 30, 5); ctx.fill(); ctx.restore();

    // Head
    ctx.fillStyle = col.head;
    ctx.beginPath(); ctx.arc(0, -28, 22, 0, PI*2); ctx.fill();

    // Eyes
    [-9, 9].forEach(ex => {
      ctx.fillStyle = col.eye;
      ctx.beginPath(); ctx.ellipse(ex, -32+blinkOffset, 5, 5*eyeScale, 0, 0, PI*2); ctx.fill();
      ctx.fillStyle = col.pupil;
      ctx.beginPath(); ctx.arc(ex+1, -31+blinkOffset, 2, 0, PI*2); ctx.fill();
    });

    // Mouth
    ctx.strokeStyle = '#92400e'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-8, -18);
    ctx.quadraticCurveTo(0, -18 + mouthCurve*12, 8, -18);
    ctx.stroke();

    ctx.restore();
  };

  const renderLoop = () => {
    const canvas = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(renderLoop); return; }
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);

    // Background dots
    ctx.fillStyle = 'rgba(99,102,241,0.1)';
    for (let x = 20; x < W; x += 40) for (let y = 20; y < H; y += 40) {
      ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI*2); ctx.fill();
    }

    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(W/2, H*0.75+4, 24, 8, 0, 0, Math.PI*2); ctx.fill();

    drawCharacter(ctx, animRef.current);

    // Update animation frame
    const a = animRef.current;
    if (a.name !== 'idle') {
      a.frame++;
      if (a.frame >= a.total) { a.name = 'idle'; a.frame = 0; setCurrentAnim('idle'); }
    } else {
      a.frame++;
    }

    // Command label
    if (lastCommand) {
      ctx.fillStyle = 'rgba(99,102,241,0.8)'; ctx.font = 'bold 14px monospace'; ctx.textAlign = 'center';
      ctx.fillText(lastCommand, W/2, 30);
    }

    rafRef.current = requestAnimationFrame(renderLoop);
  };

  useEffect(() => {
    rafRef.current = requestAnimationFrame(renderLoop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [lastCommand]);

  const connect = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = ev => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = ev => ev.candidate && pcA.addIceCandidate(ev.candidate);
    const dc = pcA.createDataChannel('puppet'); dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Puppet sync connected!'); };
    pcB.ondatachannel = ev => {
      ev.channel.onmessage = e => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'anim') { playAnim(msg.anim); setLastCommand(`Remote: ${msg.anim}`); }
      };
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  const triggerAnim = (anim: Anim) => {
    playAnim(anim);
    setLastCommand(COMMANDS.find(c => c.anim === anim)?.label ?? anim);
    if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'anim', anim }));
    logger.info(`Animation: ${anim}`);
  };

  type SpeechRec = { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; onresult: ((e: { results: { length: number; [i: number]: { isFinal: boolean; [j: number]: { transcript: string } } } }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null };

  const startListening = () => {
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition ?? (window as unknown as { SpeechRecognition?: new () => SpeechRec }).SpeechRecognition;
    if (!SR) { logger.error('Web Speech API not supported (try Chrome)'); return; }
    const r = new SR(); r.continuous = true; r.interimResults = true; r.lang = 'en-US';
    recognitionRef.current = r;
    r.onresult = (ev) => {
      const text = ev.results[ev.results.length - 1][0].transcript;
      setTranscript(text);
      for (const cmd of COMMANDS) {
        if (cmd.patterns.some(p => p.test(text))) {
          triggerAnim(cmd.anim);
          setLastCommand(cmd.label);
          logger.info(`Voice: "${text}" → ${cmd.label}`);
          break;
        }
      }
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    r.start();
    setListening(true);
    logger.success('Listening — try: wave, jump, spin, dance, happy, sad, run, flip!');
  };

  const stopListening = () => { (recognitionRef.current as SpeechRec)?.stop(); setListening(false); };

  return (
    <DemoLayout
      title="Voice-Controlled Puppet"
      difficulty="beginner"
      description="Speak commands and a canvas character comes to life — animations sync to all peers via RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>Web Speech API</strong> transcribes your voice in real time. Each recognized
            phrase is matched against a pattern dictionary of 8 movement commands. When matched,
            the canvas character plays the corresponding animation <em>locally</em> and the command
            is broadcast over a <strong>DataChannel</strong> — so everyone in the session sees
            the puppet react to your voice simultaneously.
          </p>
          <p>
            The character is drawn entirely with Canvas 2D geometry — no images or sprites.
            Each animation is a procedural pose interpolation: arm/leg angles, vertical
            offsets, scale pulses, eye squints, and mouth curves all computed from the
            frame counter using sine waves and linear interpolation.
          </p>
        </div>
      }
      hints={[
        'Say: wave · jump · spin · dance · happy · sad · run · flip',
        'Use the buttons below if Web Speech API isn\'t available',
        'Connect Loopback and send commands — the "remote" peer sees the same animation',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!connected && <button onClick={connect} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg">Sync (Loopback)</button>}
            {!listening ? (
              <button onClick={startListening} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg">🎤 Start Listening</button>
            ) : (
              <button onClick={stopListening} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg animate-pulse">⏹ Stop</button>
            )}
            {transcript && <span className="text-xs text-zinc-500 italic">"{transcript}"</span>}
          </div>

          <canvas ref={canvasRef} width={W} height={H}
            className="rounded-2xl border border-zinc-800 w-full max-w-xl block" style={{ background: '#0f172a' }} />

          <div className="grid grid-cols-4 gap-2">
            {COMMANDS.map(c => (
              <button key={c.anim} onClick={() => triggerAnim(c.anim)}
                className={`py-2 text-xs rounded-xl border transition-all hover:scale-105 active:scale-95 ${currentAnim === c.anim ? 'border-blue-500 bg-blue-950/40 text-blue-300' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Web Speech API → canvas animation → DataChannel broadcast' }}
      mdnLinks={[
        { label: 'SpeechRecognition', href: 'https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition' },
        { label: 'CanvasRenderingContext2D', href: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D' },
      ]}
    />
  );
}
