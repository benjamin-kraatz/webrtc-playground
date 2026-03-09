import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const KATAKANA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*<>{}';

const CODE = `// Matrix Digital Rain → canvas.captureStream() → WebRTC peer

// Draw rain onto a canvas
function drawRain(ctx, columns, drops) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.05)'; // fade
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#00ff41'; // matrix green
  ctx.font = fontSize + 'px monospace';

  for (let i = 0; i < columns; i++) {
    const char = chars[Math.floor(Math.random() * chars.length)];
    ctx.fillText(char, i * fontSize, drops[i] * fontSize);
    if (drops[i] * fontSize > height && Math.random() > 0.975) drops[i] = 0;
    drops[i]++;
  }
}

// Capture as a MediaStream and send over WebRTC
const stream = canvas.captureStream(30); // 30 fps
stream.getTracks().forEach(track => pc.addTrack(track, stream));`;

const THEMES = [
  { id: 'green',   name: '🟢 Classic',    fg: '#00ff41', bg: 'rgba(0,0,0,0.05)',     head: '#ffffff' },
  { id: 'blue',    name: '🔵 Blue Void',  fg: '#00bfff', bg: 'rgba(0,0,16,0.06)',    head: '#80dfff' },
  { id: 'red',     name: '🔴 Blood',      fg: '#ff2200', bg: 'rgba(8,0,0,0.06)',     head: '#ff8888' },
  { id: 'gold',    name: '✨ Gold',       fg: '#ffd700', bg: 'rgba(8,6,0,0.06)',     head: '#ffffff' },
  { id: 'rainbow', name: '🌈 Rainbow',   fg: 'rainbow',  bg: 'rgba(0,0,0,0.05)',     head: '#ffffff' },
];

export default function MatrixRain() {
  const logger = useMemo(() => new Logger(), []);
  const srcCanvasRef = useRef<HTMLCanvasElement>(null);
  const rcvVideoRef = useRef<HTMLVideoElement>(null);
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [theme, setTheme] = useState(0);
  const [charset, setCharset] = useState<'katakana' | 'latin' | 'mixed'>('mixed');
  const [speed, setSpeed] = useState(30);
  const rafRef = useRef<number>(0);
  const pcARef = useRef<RTCPeerConnection | null>(null);
  const pcBRef = useRef<RTCPeerConnection | null>(null);

  const W = 480, H = 320, FONT_SIZE = 14;
  const cols = Math.floor(W / FONT_SIZE);
  const dropsRef = useRef<number[]>(Array(cols).fill(1));
  const frameRef = useRef(0);
  const themeRef = useRef(theme);
  const charsetRef = useRef(charset);
  themeRef.current = theme;
  charsetRef.current = charset;

  const getChars = () => {
    if (charsetRef.current === 'katakana') return KATAKANA;
    if (charsetRef.current === 'latin') return LATIN;
    return KATAKANA + LATIN;
  };

  const draw = useCallback(() => {
    const canvas = srcCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const t = THEMES[themeRef.current];
    const chars = getChars();

    frameRef.current++;
    if (frameRef.current % 2 !== 0) { rafRef.current = requestAnimationFrame(draw); return; }

    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.font = `${FONT_SIZE}px monospace`;

    const drops = dropsRef.current;
    for (let i = 0; i < cols; i++) {
      const char = chars[Math.floor(Math.random() * chars.length)];
      const x = i * FONT_SIZE;
      const y = drops[i] * FONT_SIZE;

      if (t.fg === 'rainbow') {
        ctx.fillStyle = `hsl(${(frameRef.current * 2 + i * 10) % 360},100%,60%)`;
      } else {
        ctx.fillStyle = t.fg;
      }
      ctx.fillText(char, x, y);

      // Bright head
      if (drops[i] > 1) {
        ctx.fillStyle = t.head;
        ctx.fillText(chars[Math.floor(Math.random() * chars.length)], x, (drops[i] - 1) * FONT_SIZE);
      }

      if (y > H && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    }

    rafRef.current = requestAnimationFrame(draw);
  }, []);

  const start = async () => {
    dropsRef.current = Array(cols).fill(1);
    const canvas = srcCanvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Capture stream
    const stream = (canvas as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(speed);

    // WebRTC loopback
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcARef.current = pcA; pcBRef.current = pcB;
    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);
    stream.getTracks().forEach((t) => pcA.addTrack(t, stream));
    pcB.ontrack = (ev) => {
      if (rcvVideoRef.current) {
        rcvVideoRef.current.srcObject = ev.streams[0];
        rcvVideoRef.current.play();
      }
      setConnected(true);
      logger.success('Matrix stream flowing over WebRTC loopback!');
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);

    setRunning(true);
    rafRef.current = requestAnimationFrame(draw);
    logger.success('There is no spoon. 🥄');
  };

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    pcARef.current?.close(); pcBRef.current?.close();
    if (rcvVideoRef.current) rcvVideoRef.current.srcObject = null;
    setRunning(false); setConnected(false);
    logger.info('Matrix stopped');
  };

  useEffect(() => () => stop(), []);

  return (
    <DemoLayout
      title="Matrix Digital Rain"
      difficulty="intermediate"
      description="The iconic Matrix rain effect — rendered on canvas, captured as a MediaStream, and streamed over WebRTC."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            The Matrix rain is a cascade of random characters that fade as they fall.
            It's drawn to an off-screen canvas using{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">fillStyle = 'rgba(0,0,0,0.05)'</code>
            each frame to create the fade trail, and the head character is drawn bright white
            for the "leading edge" effect.
          </p>
          <p>
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">canvas.captureStream(30)</code> turns
            the canvas into a live <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">MediaStream</code>.
            This stream is added to a WebRTC loopback connection — exactly how virtual cameras,
            screen share, and processed video sources work under the hood.
          </p>
          <p>
            The received video on the right is the WebRTC-decoded stream — same content but
            potentially with codec compression artifacts at lower bitrates.
          </p>
        </div>
      }
      hints={[
        'Left panel = source canvas · Right panel = received WebRTC video',
        'Try the Rainbow theme with Katakana charset for maximum drama',
        'This is the same captureStream() trick used by the Virtual Background demo',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!running ? (
              <button onClick={start} className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg font-mono">
                Enter The Matrix
              </button>
            ) : (
              <button onClick={stop} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg">Exit</button>
            )}

            <div className="flex gap-1">
              {THEMES.map((t, i) => (
                <button key={t.id} onClick={() => setTheme(i)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${theme === i ? 'border-emerald-500 text-emerald-300 bg-emerald-950/40' : 'border-zinc-800 text-zinc-500 hover:border-zinc-600'}`}>
                  {t.name}
                </button>
              ))}
            </div>

            <div className="flex gap-1">
              {(['katakana','latin','mixed'] as const).map((c) => (
                <button key={c} onClick={() => setCharset(c)}
                  className={`px-2 py-1 text-xs rounded border transition-colors ${charset === c ? 'border-blue-500 text-blue-300' : 'border-zinc-800 text-zinc-500 hover:border-zinc-600'}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Source Canvas</p>
              <canvas ref={srcCanvasRef} width={W} height={H}
                className="rounded-xl border border-zinc-800 w-full block"
                style={{ background: '#000', imageRendering: 'pixelated' }} />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">WebRTC Received {connected ? '🔴 Live' : '(not connected)'}</p>
              <video ref={rcvVideoRef} muted playsInline
                className="rounded-xl border border-zinc-800 w-full block"
                style={{ background: '#000', aspectRatio: `${W}/${H}` }} />
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'canvas.captureStream() → WebRTC video track' }}
      mdnLinks={[
        { label: 'HTMLCanvasElement.captureStream()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream' },
        { label: 'MediaStream', href: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaStream' },
      ]}
    />
  );
}
