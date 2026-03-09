import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const CODE = `// QR Teleporter: encode text as a QR code, stream via WebRTC video, decode on the other end

// Step 1 — Generate QR code onto a canvas
import QRCode from 'qrcode';
await QRCode.toCanvas(qrCanvas, text, { width: 300, margin: 2 });

// Step 2 — Capture the canvas as a MediaStream
const qrStream = qrCanvas.captureStream(5); // 5 fps is plenty

// Step 3 — Send it over WebRTC
qrStream.getTracks().forEach(track => pcA.addTrack(track, qrStream));

// Step 4 — Receive the video on the other peer
pcB.ontrack = ({ streams }) => { videoEl.srcObject = streams[0]; };

// Step 5 — Read frames and decode with jsQR
import jsQR from 'jsqr';
function scanFrame() {
  ctx.drawImage(videoEl, 0, 0, W, H);
  const { data, width, height } = ctx.getImageData(0, 0, W, H);
  const code = jsQR(data, width, height);
  if (code) console.log('Decoded:', code.data);
  requestAnimationFrame(scanFrame);
}`;

export default function QrTeleporter() {
  const logger = useMemo(() => new Logger(), []);
  const [text, setText] = useState('Hello, WebRTC! 👋');
  const [connected, setConnected] = useState(false);
  const [decoded, setDecoded] = useState('');
  const [scanning, setScanning] = useState(false);
  const [qrGenerated, setQrGenerated] = useState(false);

  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const pcARef = useRef<RTCPeerConnection | null>(null);
  const pcBRef = useRef<RTCPeerConnection | null>(null);

  const QR_W = 280, QR_H = 280;

  const generateQR = useCallback(async (value: string) => {
    if (!qrCanvasRef.current) return;
    try {
      const QRCode = (await import('qrcode')).default;
      await QRCode.toCanvas(qrCanvasRef.current, value || ' ', {
        width: QR_W,
        margin: 2,
        color: { dark: '#ffffff', light: '#09090b' },
      });
      setQrGenerated(true);
      logger.info(`QR generated for: "${value.slice(0, 50)}${value.length > 50 ? '…' : ''}"`);
    } catch (e) {
      logger.error(`QR error: ${e}`);
    }
  }, [logger]);

  useEffect(() => { generateQR(text); }, [text, generateQR]);

  const scanLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = scanCanvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(scanLoop);
      return;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, QR_W, QR_H);
    const imageData = ctx.getImageData(0, 0, QR_W, QR_H);

    import('jsqr').then(({ default: jsQR }) => {
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code && code.data !== decoded) {
        setDecoded(code.data);
        logger.success(`Decoded via WebRTC video: "${code.data.slice(0, 80)}"`);
      }
    });

    rafRef.current = requestAnimationFrame(scanLoop);
  }, [decoded, logger]);

  const connect = async () => {
    if (!qrCanvasRef.current) return;
    logger.info('Capturing QR canvas as MediaStream...');

    const qrStream = (qrCanvasRef.current as HTMLCanvasElement & { captureStream: (fps: number) => MediaStream }).captureStream(5);

    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcARef.current = pcA;
    pcBRef.current = pcB;

    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);

    qrStream.getTracks().forEach((t) => pcA.addTrack(t, qrStream));

    pcB.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().then(() => {
          setScanning(true);
          rafRef.current = requestAnimationFrame(scanLoop);
          logger.success('Receiving QR video — scanning frames for QR code...');
        });
      }
    };

    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);

    setConnected(true);
    logger.success('Loopback connected! QR stream flowing Peer A → Peer B');
  };

  const disconnect = () => {
    cancelAnimationFrame(rafRef.current);
    pcARef.current?.close();
    pcBRef.current?.close();
    pcARef.current = null;
    pcBRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setConnected(false);
    setScanning(false);
    setDecoded('');
    logger.info('Disconnected');
  };

  useEffect(() => () => disconnect(), []);

  return (
    <DemoLayout
      title="QR Code Teleporter"
      difficulty="intermediate"
      description="Encode a message as a QR code, stream it over WebRTC video, and decode it frame-by-frame on the other end."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This demo chains four technologies together in a fun pipeline:
          </p>
          <ol className="list-decimal list-inside space-y-1 pl-2">
            <li><strong>qrcode</strong> — generates a QR code onto an HTML canvas</li>
            <li><strong>HTMLCanvasElement.captureStream()</strong> — captures the canvas as a <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">MediaStream</code></li>
            <li><strong>WebRTC loopback</strong> — streams the video from Peer A to Peer B</li>
            <li><strong>jsQR</strong> — reads each received video frame and decodes the QR</li>
          </ol>
          <p>
            The "teleporter" effect: whatever you type instantly becomes a QR code on Peer A's side,
            which is streamed as live video to Peer B, who decodes it back into text. Text → pixels → network → pixels → text!
          </p>
        </div>
      }
      hints={[
        'Type your message, click Connect, then watch Peer B decode it from the video stream',
        'The QR updates live as you type — the stream updates too',
        'This pipeline demonstrates canvas.captureStream() — the same trick used by Virtual Background',
      ]}
      demo={
        <div className="space-y-5">
          {/* Text input */}
          <div className="space-y-1">
            <label className="text-xs text-zinc-500">Message to teleport</label>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Type anything..."
              className="w-full bg-surface-0 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Peer A — QR generator */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-xs font-semibold text-zinc-300">Peer A — Sender</span>
              </div>
              <div className="bg-surface-0 border border-zinc-800 rounded-xl p-3 flex items-center justify-center" style={{ minHeight: QR_H + 24 }}>
                <canvas
                  ref={qrCanvasRef}
                  width={QR_W}
                  height={QR_H}
                  className="rounded-lg"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
              <p className="text-xs text-zinc-600 text-center">QR generated with <strong>qrcode</strong></p>
            </div>

            {/* Peer B — QR receiver/decoder */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${scanning ? 'bg-emerald-500' : 'bg-zinc-600'}`} />
                <span className="text-xs font-semibold text-zinc-300">Peer B — Receiver</span>
              </div>
              <div className="bg-surface-0 border border-zinc-800 rounded-xl p-3 flex items-center justify-center" style={{ minHeight: QR_H + 24 }}>
                {connected ? (
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    width={QR_W}
                    height={QR_H}
                    className="rounded-lg"
                    style={{ imageRendering: 'pixelated' }}
                  />
                ) : (
                  <div className="text-center text-zinc-600 text-sm">
                    <div className="text-3xl mb-2">📡</div>
                    Connect to see the video stream
                  </div>
                )}
              </div>
              <p className="text-xs text-zinc-600 text-center">Video stream decoded with <strong>jsQR</strong></p>
            </div>
          </div>

          {/* Hidden scan canvas */}
          <canvas ref={scanCanvasRef} width={QR_W} height={QR_H} className="hidden" />

          {/* Decoded result */}
          {decoded && (
            <div className="bg-emerald-950 border border-emerald-800 rounded-xl p-4">
              <p className="text-xs text-emerald-500 font-semibold mb-1">Decoded by Peer B via WebRTC video:</p>
              <p className="text-emerald-300 text-sm font-mono break-all">{decoded}</p>
            </div>
          )}

          {/* Connect button */}
          <div className="flex gap-3">
            {!connected ? (
              <button
                onClick={connect}
                disabled={!qrGenerated}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
              >
                Connect & Stream
              </button>
            ) : (
              <button onClick={disconnect} className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg">
                Disconnect
              </button>
            )}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'QR code → canvas → WebRTC video → jsQR decode' }}
      mdnLinks={[
        { label: 'HTMLCanvasElement.captureStream()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream' },
        { label: 'qrcode (npm)', href: 'https://github.com/soldair/node-qrcode' },
        { label: 'jsQR (npm)', href: 'https://github.com/cozmo/jsQR' },
      ]}
    />
  );
}
