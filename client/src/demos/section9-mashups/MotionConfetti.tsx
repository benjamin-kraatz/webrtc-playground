import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const CODE = `// MASHUP: Motion Detector + Confetti Party
// When the webcam detects significant motion, confetti fires locally
// AND a confetti trigger message is broadcast over DataChannel to all peers.

// Frame differencing (from Motion Detector)
function detectMotion(prev, curr) {
  let changed = 0;
  for (let i = 0; i < curr.length; i += 4) {
    const d = Math.abs(curr[i]-prev[i]) + Math.abs(curr[i+1]-prev[i+1]) + Math.abs(curr[i+2]-prev[i+2]);
    if (d > threshold) changed++;
  }
  return changed / (curr.length / 4);
}

// Motion → confetti (from Confetti Party)
if (motionLevel > MOTION_THRESHOLD) {
  confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
  dc.send(JSON.stringify({ type: 'confetti', colors: PARTY_COLORS }));
}

dc.onmessage = ({ data }) => {
  const { colors } = JSON.parse(data);
  confetti({ particleCount: 80, spread: 70, colors }); // remote confetti!
};`;

const MOTION_THRESHOLD = 0.04;
const COOLDOWN_MS = 2000;
const W = 320, H = 240;

export default function MotionConfetti() {
  const logger = useMemo(() => new Logger(), []);
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [motionLevel, setMotionLevel] = useState(0);
  const [firingCount, setFiringCount] = useState(0);
  const [sensitivity, setSensitivity] = useState(30);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const prevRef = useRef<ImageData | null>(null);
  const lastFireRef = useRef(0);
  const dcRef = useRef<RTCDataChannel | null>(null);

  const COLORS = ['#ff0000','#ff7f00','#ffff00','#00ff00','#0000ff','#8b00ff','#ff69b4'];

  const fire = async (fromRemote = false) => {
    const confetti = (await import('canvas-confetti')).default;
    const hue = Math.random() * 360;
    confetti({
      particleCount: 100,
      spread: 80,
      origin: { x: Math.random() * 0.6 + 0.2, y: 0.6 },
      colors: fromRemote
        ? ['#f87171','#fb923c','#fbbf24']
        : [`hsl(${hue},100%,60%)`,`hsl(${(hue+60)%360},100%,60%)`,`hsl(${(hue+120)%360},100%,60%)`],
    });
    if (!fromRemote) setFiringCount(c => c + 1);
  };

  const processFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) { rafRef.current = requestAnimationFrame(processFrame); return; }
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, W, H);
    const curr = ctx.getImageData(0, 0, W, H);
    if (prevRef.current) {
      const p = prevRef.current.data, c = curr.data;
      let changed = 0;
      for (let i = 0; i < c.length; i += 4) {
        if (Math.abs(c[i]-p[i]) + Math.abs(c[i+1]-p[i+1]) + Math.abs(c[i+2]-p[i+2]) > sensitivity) changed++;
      }
      const level = changed / (W * H);
      setMotionLevel(level);
      const now = Date.now();
      if (level > MOTION_THRESHOLD && now - lastFireRef.current > COOLDOWN_MS) {
        lastFireRef.current = now;
        fire();
        if (dcRef.current?.readyState === 'open') {
          dcRef.current.send(JSON.stringify({ type: 'confetti', colors: COLORS }));
        }
        logger.info(`Motion detected (${(level*100).toFixed(1)}%) → confetti! 🎉`);
      }
    }
    prevRef.current = curr;
    rafRef.current = requestAnimationFrame(processFrame);
  };

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: W, height: H }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      setRunning(true);
      rafRef.current = requestAnimationFrame(processFrame);
      logger.success('Motion confetti active — move in front of the camera! 🎉');
    } catch (e) { logger.error(`Camera error: ${e}`); }
  };

  const stop = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setRunning(false); setMotionLevel(0);
    logger.info('Stopped');
  };

  const connect = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = ev => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = ev => ev.candidate && pcA.addIceCandidate(ev.candidate);
    const dc = pcA.createDataChannel('motion-confetti');
    dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Remote confetti sync connected!'); };
    pcB.ondatachannel = ev => {
      ev.channel.onmessage = async e => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'confetti') { await fire(true); logger.success('Remote confetti triggered!'); }
      };
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  useEffect(() => () => stop(), []);

  const barColor = motionLevel > 0.1 ? 'bg-rose-500' : motionLevel > MOTION_THRESHOLD ? 'bg-amber-500' : 'bg-emerald-500';

  return (
    <DemoLayout
      title="Motion-Triggered Confetti"
      difficulty="beginner"
      description="MASHUP: Motion Detector + Confetti Party — wave at the camera and confetti fires, synced to all peers via DataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This mashup combines two demos into something delightful:{' '}
            <strong>Motion Detector's</strong> frame-differencing engine continuously scans the
            webcam. When pixel change exceeds a threshold, it calls{' '}
            <strong>Confetti Party's</strong> canvas-confetti trigger and broadcasts the event
            over a DataChannel — so the celebration explodes on every connected peer's screen.
          </p>
          <p>
            The 2-second cooldown prevents confetti spam. Each trigger generates a unique
            hue-rotated color palette, while remote triggers appear in warm amber/orange so you
            can tell the difference between local and remote confetti.
          </p>
        </div>
      }
      hints={[
        'Wave your hand in front of the camera to trigger confetti',
        'Adjust sensitivity — lower = more sensitive, more confetti!',
        'Connect Loopback to see remote confetti fire in warm orange',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!running ? (
              <button onClick={start} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">Start Camera</button>
            ) : (
              <button onClick={stop} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg">Stop</button>
            )}
            {running && !connected && (
              <button onClick={connect} className="px-3 py-1.5 bg-violet-700 hover:bg-violet-600 text-white text-xs rounded-lg">Sync Confetti (Loopback)</button>
            )}
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              Sensitivity:
              <input type="range" min={5} max={80} value={sensitivity} onChange={e => setSensitivity(Number(e.target.value))} className="w-24 accent-blue-500" />
              <span className="font-mono w-4">{sensitivity}</span>
            </label>
          </div>

          {running && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-zinc-500">
                <span>Motion Level</span>
                <span>{(motionLevel*100).toFixed(1)}% {motionLevel > MOTION_THRESHOLD ? '🎉' : ''}</span>
              </div>
              <div className="h-3 bg-surface-0 border border-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-100 ${barColor}`} style={{ width: `${Math.min(100, motionLevel * 500)}%` }} />
              </div>
              <div className="h-0.5 bg-zinc-800 relative">
                <div className="absolute h-full bg-amber-500/60 w-0.5" style={{ left: `${MOTION_THRESHOLD * 500}%` }} title="Trigger threshold" />
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <div className="relative">
              <video ref={videoRef} muted playsInline width={W} height={H} className="rounded-xl border border-zinc-800 block" style={{maxWidth:'100%'}} />
              <canvas ref={canvasRef} width={W} height={H} className="hidden" />
            </div>
            {running && (
              <div className="flex flex-col gap-2 text-center">
                <div className="bg-surface-0 border border-zinc-800 rounded-xl p-3">
                  <p className="text-3xl font-bold text-yellow-400">🎉</p>
                  <p className="text-2xl font-bold font-mono text-zinc-300">{firingCount}</p>
                  <p className="text-xs text-zinc-500">confetti bursts</p>
                </div>
              </div>
            )}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Motion Detector + Confetti Party mashup' }}
      mdnLinks={[
        { label: 'canvas-confetti', href: 'https://github.com/catdad/canvas-confetti' },
        { label: 'CanvasRenderingContext2D.getImageData()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData' },
      ]}
    />
  );
}
