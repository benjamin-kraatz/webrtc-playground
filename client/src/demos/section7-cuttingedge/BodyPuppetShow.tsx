import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

interface Keypoint { x: number; y: number; s: number; }

const SKELETON_PAIRS = [
  [0,1],[0,2],[1,3],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],
  [5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16],
];
const KP_COLORS = ['#f87171','#fb923c','#fbbf24','#34d399','#60a5fa','#a78bfa','#f472b6'];

const W = 280, H = 360;

const CODE = `// Body Puppet Show — zero-video telepresence
// MoveNet extracts 17 keypoints, we transmit only coordinates
// ~340 bytes/frame vs ~30KB+ for video!

import * as poseDetection from '@tensorflow-models/pose-detection';

const detector = await poseDetection.createDetector(
  poseDetection.SupportedModels.MoveNet,
  { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
);

// Inference loop
const poses = await detector.estimatePoses(videoEl);
const keypoints = poses[0].keypoints.map(kp => ({
  x: kp.x / videoEl.videoWidth,
  y: kp.y / videoEl.videoHeight,
  s: kp.score ?? 0,
}));

// Send only 17 keypoints — ~340 bytes per frame
dc.send(JSON.stringify({ type: 'pose', pts: keypoints }));

// Receiver draws skeleton from coordinates — NO video!
function drawPuppet(ctx, pts, W, H) {
  SKELETON_PAIRS.forEach(([a, b]) => {
    if (pts[a].s > 0.3 && pts[b].s > 0.3) {
      ctx.beginPath();
      ctx.moveTo(pts[a].x * W, pts[a].y * H);
      ctx.lineTo(pts[b].x * W, pts[b].y * H);
      ctx.stroke();
    }
  });
}`;

type StyleMode = 'neon' | 'robot' | 'shadow';

function drawPuppet(ctx: CanvasRenderingContext2D, pts: Keypoint[], style: StyleMode, trail: boolean) {
  if (pts.length < 17) return;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const limb = (a: number, b: number, color: string, width: number) => {
    if (pts[a].s < 0.25 || pts[b].s < 0.25) return;
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(pts[a].x * W, pts[a].y * H); ctx.lineTo(pts[b].x * W, pts[b].y * H); ctx.stroke();
  };
  const dot = (i: number, color: string, r: number) => {
    if (pts[i].s < 0.25) return;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(pts[i].x * W, pts[i].y * H, r, 0, Math.PI * 2); ctx.fill();
  };

  if (style === 'neon') {
    ctx.shadowBlur = 10;
    SKELETON_PAIRS.forEach(([a, b], i) => {
      ctx.shadowColor = KP_COLORS[i % KP_COLORS.length];
      limb(a, b, KP_COLORS[i % KP_COLORS.length], 3);
    });
    ctx.shadowBlur = 0;
    for (let i = 0; i < 17; i++) dot(i, '#fff', 4);
  } else if (style === 'robot') {
    const segW = 8, jointR = 6;
    SKELETON_PAIRS.forEach(([a, b], i) => { limb(a, b, KP_COLORS[i % KP_COLORS.length], segW); });
    for (let i = 0; i < 17; i++) { dot(i, '#e2e8f0', jointR); }
  } else {
    // shadow silhouette
    ctx.fillStyle = '#1e293b';
    const bounds = { minX: 1, maxX: 0, minY: 1, maxY: 0 };
    for (const pt of pts) { if (pt.s > 0.3) { bounds.minX = Math.min(bounds.minX, pt.x); bounds.maxX = Math.max(bounds.maxX, pt.x); bounds.minY = Math.min(bounds.minY, pt.y); bounds.maxY = Math.max(bounds.maxY, pt.y); } }
    SKELETON_PAIRS.forEach(([a, b]) => { limb(a, b, 'rgba(100,150,255,0.8)', 14); });
    for (let i = 0; i < 17; i++) dot(i, 'rgba(150,200,255,0.9)', 7);
  }
}

export default function BodyPuppetShow() {
  const logger = useMemo(() => new Logger(), []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const youCanvasRef = useRef<HTMLCanvasElement>(null);
  const puppetCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const detectorRef = useRef<{ estimatePoses: (v: HTMLVideoElement) => Promise<{ keypoints: Array<{x:number;y:number;score?:number}> }[]> } | null>(null);
  const latestPtsRef = useRef<Keypoint[]>([]);
  const prevPuppetPts = useRef<Keypoint[]>([]);
  const [style, setStyle] = useState<StyleMode>('neon');
  const styleRef = useRef<StyleMode>('neon');
  styleRef.current = style;
  const [running, setRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);
  const [fps, setFps] = useState(0);
  const [bytesPerFrame, setBytesPerFrame] = useState(0);

  const inferLoop = useCallback(async () => {
    const video = videoRef.current; const detector = detectorRef.current;
    if (!video || !detector || video.readyState < 2) { rafRef.current = requestAnimationFrame(inferLoop); return; }

    const poses = await detector.estimatePoses(video);
    if (poses.length > 0) {
      const vw = video.videoWidth || W, vh = video.videoHeight || H;
      const pts: Keypoint[] = poses[0].keypoints.map(kp => ({ x: kp.x / vw, y: kp.y / vh, s: kp.score ?? 0 }));
      latestPtsRef.current = pts;

      const payload = JSON.stringify({ type: 'pose', pts });
      setBytesPerFrame(payload.length);
      if (dcRef.current?.readyState === 'open') dcRef.current.send(payload);
    }

    // Draw "You" canvas — webcam + overlay
    const yCtx = youCanvasRef.current?.getContext('2d');
    if (yCtx && video.videoWidth > 0) {
      yCtx.drawImage(video, 0, 0, W, H);
      drawPuppet(yCtx, latestPtsRef.current, styleRef.current, false);
    }

    rafRef.current = requestAnimationFrame(inferLoop);
  }, []);

  // Puppet render loop (smooth interpolation)
  useEffect(() => {
    let fpsCounter = 0, fpsTimer = performance.now();
    const puppetLoop = () => {
      const ctx = puppetCanvasRef.current?.getContext('2d');
      if (ctx) {
        ctx.fillStyle = 'rgba(9,9,11,0.25)'; ctx.fillRect(0, 0, W, H);
        // Lerp towards latest received pts
        const target = latestPtsRef.current;
        if (target.length === 17) {
          const lerped = prevPuppetPts.current.length === 17
            ? target.map((t, i) => ({ x: prevPuppetPts.current[i].x + (t.x - prevPuppetPts.current[i].x) * 0.3, y: prevPuppetPts.current[i].y + (t.y - prevPuppetPts.current[i].y) * 0.3, s: t.s }))
            : target;
          prevPuppetPts.current = lerped;
          drawPuppet(ctx, lerped, styleRef.current, true);
        }
      }
      fpsCounter++;
      if (performance.now() - fpsTimer > 1000) { setFps(fpsCounter); fpsCounter = 0; fpsTimer = performance.now(); }
      requestAnimationFrame(puppetLoop);
    };
    const id = requestAnimationFrame(puppetLoop);
    return () => cancelAnimationFrame(id);
  }, []);

  const start = async () => {
    setLoadingModel(true);
    logger.info('Loading MoveNet Lightning model…');
    try {
      await import('@tensorflow/tfjs');
      const pd = await import('@tensorflow-models/pose-detection');
      const detector = await pd.createDetector(pd.SupportedModels.MoveNet, {
        modelType: (pd.movenet as { modelType: { SINGLEPOSE_LIGHTNING: string } }).modelType.SINGLEPOSE_LIGHTNING,
      });
      detectorRef.current = detector as typeof detectorRef.current;

      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: W, height: H } });
      const video = videoRef.current!;
      video.srcObject = stream; await video.play();

      setLoadingModel(false); setRunning(true);
      logger.success('MoveNet ready — move around to see your skeleton!');
      rafRef.current = requestAnimationFrame(inferLoop);
    } catch (err) {
      setLoadingModel(false);
      logger.error(`Failed to start: ${err}`);
    }
  };

  const connectLoopback = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = e => e.candidate && pcB.addIceCandidate(e.candidate);
    pcB.onicecandidate = e => e.candidate && pcA.addIceCandidate(e.candidate);
    const dc = pcA.createDataChannel('puppet'); dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Puppet synced!'); };
    pcB.ondatachannel = ev => {
      ev.channel.onmessage = e => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'pose') latestPtsRef.current = msg.pts;
      };
    };
    const offer = await pcA.createOffer(); await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer(); await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    (videoRef.current?.srcObject as MediaStream)?.getTracks().forEach(t => t.stop());
  }, []);

  return (
    <DemoLayout
      title="Body Puppet Show"
      difficulty="advanced"
      description="TF.js MoveNet extracts 17 body keypoints from your webcam — only the coordinates (~340 bytes/frame) are sent over RTCDataChannel. The puppet is rendered from data alone. Zero video bandwidth telepresence."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Traditional video calls send 30+ KB per frame. This demo transmits only{' '}
            <strong>17 XY coordinates</strong> (~340 bytes) — a <strong>100× reduction</strong> in
            bandwidth. TensorFlow.js MoveNet runs entirely in your browser.
          </p>
          <p>
            The <strong>left canvas</strong> shows your webcam with skeleton overlay.
            The <strong>right canvas</strong> shows the puppet — reconstructed purely from keypoint data.
            The puppet uses smooth lerp interpolation between received frames.
          </p>
          <p>Three puppet styles: Neon Skeleton, Robot (rectangular segments), and Shadow Silhouette.</p>
        </div>
      }
      hints={[
        'Stand 1-2 meters from the camera for best full-body detection',
        'MoveNet Lightning is the fastest model — loads in ~3 seconds',
        'The puppet canvas receives NO video — only coordinate data!',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            {!running
              ? <button onClick={start} disabled={loadingModel} className="px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                  {loadingModel ? '⏳ Loading model…' : '🎭 Start Puppet Show'}
                </button>
              : <span className="px-3 py-1 bg-violet-900/40 border border-violet-700 text-violet-300 text-xs rounded-lg">🟢 Running</span>
            }
            {running && !connected && <button onClick={connectLoopback} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg">🔗 Connect Loopback</button>}
            {connected && <span className="px-2 py-1 bg-blue-900/40 border border-blue-700 text-blue-300 text-xs rounded-lg">🔗 Connected</span>}
            <div className="flex gap-1 ml-auto">
              {(['neon','robot','shadow'] as StyleMode[]).map(s => (
                <button key={s} onClick={() => setStyle(s)} className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${style === s ? 'border-violet-500 bg-violet-950/40 text-violet-300' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}>{s}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-zinc-500 mb-1.5 text-center">📷 You (webcam + overlay)</p>
              <canvas ref={youCanvasRef} width={W} height={H} className="rounded-xl border border-zinc-800 w-full" style={{ background: '#09090b' }} />
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1.5 text-center">🤖 Puppet (data only!)</p>
              <canvas ref={puppetCanvasRef} width={W} height={H} className="rounded-xl border border-zinc-800 w-full" style={{ background: '#09090b' }} />
            </div>
          </div>

          <div className="flex gap-4 text-xs text-zinc-500">
            <span>⚡ {fps} fps</span>
            <span>📦 {bytesPerFrame} bytes/frame</span>
            {bytesPerFrame > 0 && <span className="text-green-500">≈{Math.round(30000 / bytesPerFrame)}× smaller than video</span>}
          </div>

          <video ref={videoRef} className="hidden" muted playsInline />
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'MoveNet keypoint extraction + DataChannel transmission' }}
      mdnLinks={[
        { label: 'TF.js Pose Detection', href: 'https://github.com/tensorflow/tfjs-models/tree/master/pose-detection' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
