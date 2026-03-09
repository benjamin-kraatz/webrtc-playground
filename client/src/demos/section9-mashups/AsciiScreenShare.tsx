import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const ASCII_CHARS = ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$';

const CODE = `// MASHUP: Screen Share + ASCII Webcam → ASCII Screen Share
// getDisplayMedia → canvas → ASCII art → canvas.captureStream() → WebRTC

// Step 1: Capture the screen
const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
screenVideo.srcObject = screenStream;

// Step 2: Every frame, draw the screen to a tiny canvas and convert to ASCII
function frameLoop() {
  sampleCtx.drawImage(screenVideo, 0, 0, COLS, ROWS);
  const { data } = sampleCtx.getImageData(0, 0, COLS, ROWS);
  let ascii = '';
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const i = (y * COLS + x) * 4;
      const luma = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
      ascii += ASCII_CHARS[Math.floor(luma / 255 * (ASCII_CHARS.length - 1))];
    }
    ascii += '\\n';
  }
  // Render ASCII text onto the output canvas
  outCtx.fillText(ascii, 0, FONT_SIZE);
}

// Step 3: Capture the ASCII canvas as a MediaStream
const asciiStream = asciiCanvas.captureStream(10);
asciiStream.getTracks().forEach(t => pc.addTrack(t, asciiStream));`;

const COLS = 100;
const ROWS = 40;

export default function AsciiScreenShare() {
  const logger = useMemo(() => new Logger(), []);
  const [sharing, setSharing] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const [colored, setColored] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const srcVideoRef = useRef<HTMLVideoElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement>(null);
  const outCanvasRef = useRef<HTMLCanvasElement>(null);
  const rcvVideoRef = useRef<HTMLVideoElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const pcARef = useRef<RTCPeerConnection | null>(null);
  const pcBRef = useRef<RTCPeerConnection | null>(null);
  const coloredRef = useRef(colored);
  coloredRef.current = colored;

  const FONT = 7;
  const OUT_W = COLS * (FONT - 1);
  const OUT_H = ROWS * FONT;

  const renderLoop = useCallback(() => {
    const video = srcVideoRef.current;
    const sample = sampleCanvasRef.current;
    const out = outCanvasRef.current;
    if (!video || !sample || !out || video.readyState < 2) { rafRef.current = requestAnimationFrame(renderLoop); return; }

    const sCtx = sample.getContext('2d')!;
    const oCtx = out.getContext('2d')!;
    sCtx.drawImage(video, 0, 0, COLS, ROWS);
    const { data } = sCtx.getImageData(0, 0, COLS, ROWS);

    oCtx.fillStyle = '#000';
    oCtx.fillRect(0, 0, OUT_W, OUT_H);
    oCtx.font = `${FONT}px monospace`;

    let ascii = '';
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const idx = (y * COLS + x) * 4;
        const r = data[idx], g = data[idx+1], b = data[idx+2];
        const luma = 0.299*r + 0.587*g + 0.114*b;
        const ch = ASCII_CHARS[Math.floor(luma / 255 * (ASCII_CHARS.length - 1))];
        if (coloredRef.current) {
          oCtx.fillStyle = `rgb(${r},${g},${b})`;
          oCtx.fillText(ch, x * (FONT - 1), (y + 1) * FONT);
        } else {
          oCtx.fillStyle = '#33ff33';
          oCtx.fillText(ch, x * (FONT - 1), (y + 1) * FONT);
          ascii += ch;
        }
      }
      if (!coloredRef.current) ascii += '\n';
    }
    if (!coloredRef.current && preRef.current) preRef.current.textContent = ascii;

    rafRef.current = requestAnimationFrame(renderLoop);
  }, []);

  const start = async () => {
    try {
      logger.info('Requesting screen share...');
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: { width: 1280, height: 720 }, audio: false });
      streamRef.current = screen;
      if (srcVideoRef.current) { srcVideoRef.current.srcObject = screen; await srcVideoRef.current.play(); }

      const out = outCanvasRef.current!;
      const asciiStream = (out as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(10);

      const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      pcARef.current = pcA; pcBRef.current = pcB;
      pcA.onicecandidate = ev => ev.candidate && pcB.addIceCandidate(ev.candidate);
      pcB.onicecandidate = ev => ev.candidate && pcA.addIceCandidate(ev.candidate);
      asciiStream.getTracks().forEach(t => pcA.addTrack(t, asciiStream));
      pcB.ontrack = ev => {
        if (rcvVideoRef.current) { rcvVideoRef.current.srcObject = ev.streams[0]; rcvVideoRef.current.play(); }
        setReceiving(true);
        logger.success('ASCII video stream received by Peer B!');
      };
      const offer = await pcA.createOffer();
      await pcA.setLocalDescription(offer);
      await pcB.setRemoteDescription(offer);
      const answer = await pcB.createAnswer();
      await pcB.setLocalDescription(answer);
      await pcA.setRemoteDescription(answer);

      setSharing(true);
      rafRef.current = requestAnimationFrame(renderLoop);
      screen.getTracks()[0].onended = () => stop();
      logger.success('ASCII screen share active — your screen is being ASCII-fied! 🖥️');
    } catch (e) { logger.error(`Screen share error: ${e}`); }
  };

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    pcARef.current?.close(); pcBRef.current?.close();
    if (srcVideoRef.current) srcVideoRef.current.srcObject = null;
    if (rcvVideoRef.current) rcvVideoRef.current.srcObject = null;
    setSharing(false); setReceiving(false);
    logger.info('Stopped');
  };

  useEffect(() => () => stop(), []);

  return (
    <DemoLayout
      title="ASCII Screen Share"
      difficulty="intermediate"
      description="MASHUP: Screen Share + ASCII Webcam — share your screen as live ASCII art streamed over WebRTC."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This mashup chains three capabilities: <strong>Screen Share</strong>{' '}
            (<code className="text-xs bg-surface-2 px-1 py-0.5 rounded">getDisplayMedia</code>) captures
            your screen. <strong>ASCII Webcam</strong>'s pixel-brightness algorithm converts every
            frame to ASCII characters on a canvas. Then{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">canvas.captureStream()</code>
            turns that ASCII canvas into a video stream sent over WebRTC.
          </p>
          <p>
            The result: whoever receives the stream sees your screen rendered in ASCII art —
            an extremely lo-fi, deeply retro video compression method. At 10 fps it uses
            significantly less bandwidth than regular screen share, with significantly more style.
          </p>
        </div>
      }
      hints={[
        'Choose a window with high contrast for the best ASCII results',
        'Enable Colored mode for a psychedelic full-color ASCII version',
        'The right panel shows the WebRTC-received ASCII video stream',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!sharing ? (
              <button onClick={start} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                🖥️ Share Screen as ASCII
              </button>
            ) : (
              <button onClick={stop} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg">Stop</button>
            )}
            <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
              <input type="checkbox" checked={colored} onChange={e => setColored(e.target.checked)} className="accent-blue-500" />
              Colored Mode
            </label>
          </div>

          <video ref={srcVideoRef} muted playsInline className="hidden" />
          <canvas ref={sampleCanvasRef} width={COLS} height={ROWS} className="hidden" />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">ASCII Canvas (Peer A source)</p>
              <canvas ref={outCanvasRef} width={OUT_W} height={OUT_H}
                className="rounded-xl border border-zinc-800 w-full block"
                style={{ background: '#000', imageRendering: 'pixelated' }} />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">WebRTC Received (Peer B) {receiving ? '🔴' : ''}</p>
              <video ref={rcvVideoRef} muted playsInline
                className="rounded-xl border border-zinc-800 w-full block"
                style={{ background: '#000', aspectRatio: `${OUT_W}/${OUT_H}` }} />
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'getDisplayMedia → ASCII canvas → captureStream → WebRTC' }}
      mdnLinks={[
        { label: 'getDisplayMedia()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia' },
        { label: 'HTMLCanvasElement.captureStream()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream' },
      ]}
    />
  );
}
