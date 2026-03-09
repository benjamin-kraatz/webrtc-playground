import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

type FilterId = 'none' | 'glasses' | 'halo' | 'tears' | 'fire' | 'cat' | 'clown';

interface TearDrop { x: number; y: number; vy: number; life: number }

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'none',    label: '😶 None' },
  { id: 'glasses', label: '🕶️ Glasses' },
  { id: 'halo',    label: '😇 Halo' },
  { id: 'tears',   label: '😂 Tears' },
  { id: 'fire',    label: '🔥 Fire Crown' },
  { id: 'cat',     label: '🐱 Cat Ears' },
  { id: 'clown',   label: '🤡 Clown Nose' },
];

const W = 480, H = 360;

const CODE = `// TensorFlow.js MediaPipe FaceMesh for AR face filters
const faceLandmarksDetection = await import('@tensorflow-models/face-landmarks-detection');
await import('@tensorflow/tfjs-backend-webgl');

const model = await faceLandmarksDetection.createDetector(
  faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
  { runtime: 'tfjs', maxFaces: 1, refineLandmarks: false }
);

// Each frame: detect landmarks, draw filter on canvas
const faces = await model.estimateFaces(videoElement);
if (faces.length) {
  const kp = faces[0].keypoints;
  const leftEye  = avg(kp[33],  kp[133]);
  const rightEye = avg(kp[362], kp[263]);
  drawGlasses(ctx, leftEye, rightEye);
}

// Stream canvas to peer via DataChannel + loopback WebRTC
const stream = canvas.captureStream(20);
dc.send(JSON.stringify({ type: 'filter', filter: selectedFilter }));`;

function avg(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export default function FaceFilterParty() {
  const logger = useMemo(() => new Logger(), []);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [filter, setFilter] = useState<FilterId>('none');
  const [peerFilter, setPeerFilter] = useState<FilterId>('none');
  const [mirrored, setMirrored] = useState(true);
  const [loadProgress, setLoadProgress] = useState('');

  const videoRef     = useRef<HTMLVideoElement>(null);
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const recvRef      = useRef<HTMLVideoElement>(null);
  const streamRef    = useRef<MediaStream | null>(null);
  const modelRef     = useRef<{ estimateFaces: (v: HTMLVideoElement) => Promise<{ keypoints: { x: number; y: number; z?: number; name?: string }[] }[]> } | null>(null);
  const rafRef       = useRef<number>(0);
  const tearsRef     = useRef<{ l: TearDrop[]; r: TearDrop[] }>({ l: [], r: [] });
  const frameRef     = useRef(0);
  const pcRef        = useRef<RTCPeerConnection | null>(null);
  const dcRef        = useRef<RTCDataChannel | null>(null);
  const filterRef    = useRef<FilterId>('none');
  filterRef.current  = filter;

  /* ---------- filter drawing helpers ---------- */

  const drawFilter = useCallback((
    ctx: CanvasRenderingContext2D,
    kp: { x: number; y: number }[],
    fid: FilterId
  ) => {
    if (fid === 'none' || kp.length < 468) return;
    const leftEye  = avg(kp[33],  kp[133]);
    const rightEye = avg(kp[362], kp[263]);
    const eyeDist  = dist(leftEye, rightEye);
    const nose     = kp[1];
    const faceTop  = kp[10];
    const faceL    = kp[234];
    const faceR    = kp[454];
    const faceW    = dist(faceL, faceR);
    const faceH    = dist(faceTop, nose) * 2.2;
    const cx       = (faceL.x + faceR.x) / 2;
    const fy       = faceTop.y;

    ctx.save();
    if (fid === 'glasses') {
      const r = eyeDist * 0.32;
      ctx.strokeStyle = '#c0c0c0';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#888';
      ctx.shadowBlur = 4;
      ctx.beginPath(); ctx.arc(leftEye.x,  leftEye.y,  r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(rightEye.x, rightEye.y, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(leftEye.x + r, leftEye.y);
      ctx.lineTo(rightEye.x - r, rightEye.y);
      ctx.stroke();
      // temples
      ctx.beginPath(); ctx.moveTo(leftEye.x - r, leftEye.y); ctx.lineTo(leftEye.x - r * 1.6, leftEye.y + r * 0.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rightEye.x + r, rightEye.y); ctx.lineTo(rightEye.x + r * 1.6, rightEye.y + r * 0.3); ctx.stroke();
    } else if (fid === 'halo') {
      ctx.strokeStyle = '#ffd700';
      ctx.lineWidth = 6;
      ctx.shadowColor = '#ffd700';
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.ellipse(cx, fy - faceH * 0.18, faceW * 0.35, faceH * 0.07, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (fid === 'tears') {
      const now = frameRef.current;
      if (now % 4 === 0) {
        tearsRef.current.l.push({ x: kp[33].x, y: kp[33].y, vy: 1.5, life: 40 });
        tearsRef.current.r.push({ x: kp[263].x, y: kp[263].y, vy: 1.5, life: 40 });
      }
      const drawDrops = (drops: TearDrop[]) => {
        drops.forEach(d => {
          d.y += d.vy; d.vy += 0.3; d.life--;
          if (d.life <= 0) return;
          ctx.beginPath();
          ctx.arc(d.x, d.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(100,180,255,${d.life / 40})`;
          ctx.fill();
        });
        // remove dead
        const arr = drops.filter(d => d.life > 0);
        drops.length = 0; drops.push(...arr);
      };
      drawDrops(tearsRef.current.l);
      drawDrops(tearsRef.current.r);
    } else if (fid === 'fire') {
      // crown spikes
      const t = frameRef.current / 10;
      const spikes = 5;
      const baseY = fy - faceH * 0.05;
      ctx.save();
      for (let i = 0; i < spikes; i++) {
        const sx = cx - faceW * 0.4 + (i / (spikes - 1)) * faceW * 0.8;
        const height = faceH * 0.25 + Math.sin(t + i * 1.3) * faceH * 0.06;
        const wobble = Math.sin(t * 1.7 + i) * 4;
        const grad = ctx.createLinearGradient(sx, baseY, sx + wobble, baseY - height);
        grad.addColorStop(0, 'rgba(255,60,0,0.9)');
        grad.addColorStop(0.5, 'rgba(255,160,0,0.8)');
        grad.addColorStop(1, 'rgba(255,255,0,0)');
        ctx.beginPath();
        ctx.moveTo(sx - 8, baseY);
        ctx.quadraticCurveTo(sx + wobble - 4, baseY - height * 0.5, sx + wobble, baseY - height);
        ctx.quadraticCurveTo(sx + wobble + 4, baseY - height * 0.5, sx + 8, baseY);
        ctx.fillStyle = grad;
        ctx.fill();
      }
      ctx.restore();
    } else if (fid === 'cat') {
      const earW = faceW * 0.22;
      const earH = faceH * 0.22;
      const drawEar = (ex: number, flip: number) => {
        ctx.beginPath();
        ctx.moveTo(ex, fy);
        ctx.lineTo(ex + flip * earW * 0.5, fy - earH);
        ctx.lineTo(ex + flip * earW, fy);
        ctx.closePath();
        ctx.fillStyle = '#888';
        ctx.fill();
        // inner ear
        ctx.beginPath();
        ctx.moveTo(ex + flip * earW * 0.15, fy - earH * 0.1);
        ctx.lineTo(ex + flip * earW * 0.5, fy - earH * 0.8);
        ctx.lineTo(ex + flip * earW * 0.85, fy - earH * 0.1);
        ctx.closePath();
        ctx.fillStyle = '#ffaac0';
        ctx.fill();
      };
      drawEar(cx - faceW * 0.3, -1);
      drawEar(cx + faceW * 0.1,  1);
    } else if (fid === 'clown') {
      const r = faceW * 0.09;
      ctx.beginPath();
      ctx.arc(nose.x, nose.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#e00';
      ctx.shadowColor = '#f00';
      ctx.shadowBlur = 8;
      ctx.fill();
    }
    ctx.restore();
  }, []);

  /* ---------- animation loop ---------- */

  const loop = useCallback(async () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }
    const ctx = canvas.getContext('2d')!;
    frameRef.current++;

    ctx.save();
    if (mirrored) {
      ctx.translate(W, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, W, H);
    ctx.restore();

    if (modelRef.current) {
      try {
        const faces = await modelRef.current.estimateFaces(video);
        if (faces.length) {
          let kp = faces[0].keypoints as { x: number; y: number }[];
          if (mirrored) kp = kp.map(p => ({ x: W - p.x, y: p.y }));
          drawFilter(ctx, kp, filterRef.current);
        }
      } catch {/* ignore frame errors */}
    }

    rafRef.current = requestAnimationFrame(loop);
  }, [mirrored, drawFilter]);

  /* ---------- start camera + model ---------- */

  const start = useCallback(async () => {
    setLoading(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: W, height: H }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }

      setLoadProgress('Loading TF.js backend…');
      await import('@tensorflow/tfjs-backend-webgl');
      setLoadProgress('Loading FaceMesh model…');
      const fld = await import('@tensorflow-models/face-landmarks-detection');
      const model = await fld.createDetector(fld.SupportedModels.MediaPipeFaceMesh, {
        runtime: 'tfjs' as const,
        maxFaces: 1,
        refineLandmarks: false,
      });
      modelRef.current = model as typeof modelRef.current;
      logger.success('FaceMesh model loaded');
      setLoadProgress('');
      setStarted(true);
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      logger.error(`Start failed: ${e}`);
    }
    setLoading(false);
  }, [logger, loop]);

  /* ---------- loopback WebRTC ---------- */

  const connectLoopback = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stream = canvas.captureStream(20);
    const pc1 = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pc2 = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcRef.current = pc1;

    const dc = pc1.createDataChannel('filters');
    dcRef.current = dc;
    pc2.ondatachannel = ev => {
      ev.channel.onmessage = e => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'filter') { setPeerFilter(msg.filter); logger.info(`Peer wearing: ${msg.filter}`); }
      };
    };

    stream.getTracks().forEach(t => pc1.addTrack(t, stream));
    pc2.ontrack = ev => { if (recvRef.current) recvRef.current.srcObject = ev.streams[0]; };

    pc1.onicecandidate = e => { if (e.candidate) pc2.addIceCandidate(e.candidate); };
    pc2.onicecandidate = e => { if (e.candidate) pc1.addIceCandidate(e.candidate); };

    const offer = await pc1.createOffer();
    await pc1.setLocalDescription(offer);
    await pc2.setRemoteDescription(offer);
    const answer = await pc2.createAnswer();
    await pc2.setLocalDescription(answer);
    await pc1.setRemoteDescription(answer);

    pc1.onconnectionstatechange = () => {
      if (pc1.connectionState === 'connected') { setConnected(true); logger.success('Loopback connected'); }
    };
  }, [logger]);

  /* ---------- sync filter over DC ---------- */

  const selectFilter = useCallback((f: FilterId) => {
    setFilter(f);
    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'filter', filter: f }));
    }
  }, []);

  /* ---------- cleanup ---------- */

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
      pcRef.current?.close();
    };
  }, []);

  /* ---------- restart loop when mirrored changes ---------- */
  useEffect(() => {
    if (started) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(loop);
    }
  }, [mirrored, started, loop]);

  return (
    <DemoLayout
      title="Face Filter Party"
      difficulty="advanced"
      description="AR face filters powered by TF.js MediaPipe FaceMesh — glasses, halo, fire crown, cat ears and more, streamed via WebRTC loopback."
      explanation={
        <div className="space-y-3 text-sm">
          <p>TensorFlow.js MediaPipe FaceMesh detects 468 facial landmarks every frame. Filters are drawn directly on canvas using Canvas 2D geometry — no WebGL shaders needed.</p>
          <p>The canvas output is captured with <code>captureStream()</code> and streamed through a loopback <code>RTCPeerConnection</code>. The active filter name is synced to the remote peer via a <code>RTCDataChannel</code>.</p>
          <p>Landmarks used: eye corners (33, 133, 263, 362), nose tip (1), forehead (10), face width (234↔454).</p>
        </div>
      }
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {!started ? (
              <button
                onClick={start}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
              >
                {loading ? (loadProgress || 'Loading…') : 'Start Camera + Load Model'}
              </button>
            ) : (
              <>
                <button
                  onClick={connectLoopback}
                  disabled={connected}
                  className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
                >
                  {connected ? '✓ Loopback Connected' : 'Connect Loopback'}
                </button>
                <button
                  onClick={() => setMirrored(m => !m)}
                  className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium rounded-lg"
                >
                  {mirrored ? '🪞 Mirror: ON' : '🪞 Mirror: OFF'}
                </button>
              </>
            )}
          </div>

          {started && (
            <div className="flex flex-wrap gap-2">
              {FILTERS.map(f => (
                <button
                  key={f.id}
                  onClick={() => selectFilter(f.id)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                    filter === f.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
              <p className="text-xs text-zinc-400 font-medium">Your Camera (with filter)</p>
              <canvas
                ref={canvasRef}
                width={W}
                height={H}
                className="w-full rounded-lg bg-zinc-950"
              />
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 space-y-2">
              <p className="text-xs text-zinc-400 font-medium">
                Received Stream {peerFilter !== 'none' && <span className="text-blue-400">— peer: {peerFilter}</span>}
              </p>
              <video
                ref={recvRef}
                autoPlay
                playsInline
                muted
                className="w-full rounded-lg bg-zinc-950"
              />
            </div>
          </div>

          {/* hidden raw video for model input */}
          <video ref={videoRef} autoPlay playsInline muted className="hidden" width={W} height={H} />
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'FaceMesh filter pipeline' }}
      hints={[
        'The model loads ~10 MB — expect a few seconds on first run.',
        'Mirroring flips both the canvas draw AND the landmark X coordinates.',
        'Tear drops use a small particle array updated each frame — they naturally fall with gravity.',
        'Fire crown spikes are animated with sin waves tied to a frame counter.',
      ]}
      mdnLinks={[
        { label: 'MediaPipe FaceMesh', href: 'https://github.com/tensorflow/tfjs-models/tree/master/face-landmarks-detection' },
        { label: 'captureStream()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream' },
      ]}
    />
  );
}
