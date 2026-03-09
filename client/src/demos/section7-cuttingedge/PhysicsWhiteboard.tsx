import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

interface PhysicsBlob {
  id: number;
  points: { x: number; y: number }[];  // original path (for shape)
  cx: number; cy: number;              // centroid
  vx: number; vy: number;              // velocity
  w: number; h: number;                // bounding box
  color: string;
  rotation: number; angularV: number;
  scale: number;
  alive: boolean;
}

const W = 560, H = 380;
const GRAVITY = 0.35;
const BOUNCE = 0.55;
const FRICTION = 0.98;
const COLORS = ['#f87171','#fb923c','#fbbf24','#34d399','#60a5fa','#a78bfa','#f472b6','#38bdf8'];
let blobId = 0;

const CODE = `// Physics Whiteboard — draw shapes, they fall with gravity and bounce!

// Step 1: Record mouse path while drawing
let drawing = false, currentPath = [];
canvas.onmousedown = (e) => { drawing = true; currentPath = [getPos(e)]; };
canvas.onmousemove = (e) => { if (drawing) currentPath.push(getPos(e)); };

// Step 2: Release → create a physics body
canvas.onmouseup = () => {
  drawing = false;
  const blob = createPhysicsBlob(currentPath);
  blobs.push(blob);
  // Share with peers
  dc.send(JSON.stringify({ type: 'blob', blob }));
};

// Step 3: Physics update loop
function updateBlobs() {
  for (const blob of blobs) {
    blob.vy += GRAVITY;        // gravity
    blob.cx += blob.vx;       // move
    blob.cy += blob.vy;
    blob.rotation += blob.angularV;
    // Floor bounce
    if (blob.cy + blob.h/2 > H - 20) {
      blob.cy = H - 20 - blob.h/2;
      blob.vy *= -BOUNCE;
      blob.vx *= FRICTION;
      blob.angularV *= 0.8;
    }
    // Wall bounce
    if (blob.cx - blob.w/2 < 0 || blob.cx + blob.w/2 > W) {
      blob.vx *= -0.7;
    }
  }
}`;

function centroid(pts: { x: number; y: number }[]): { x: number; y: number } {
  const sx = pts.reduce((s, p) => s + p.x, 0), sy = pts.reduce((s, p) => s + p.y, 0);
  return { x: sx / pts.length, y: sy / pts.length };
}

function bbox(pts: { x: number; y: number }[]): { w: number; h: number } {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function samplePath(pts: { x: number; y: number }[], n: number) {
  if (pts.length <= n) return pts;
  return Array.from({ length: n }, (_, i) => pts[Math.floor(i * pts.length / n)]);
}

export default function PhysicsWhiteboard() {
  const logger = useMemo(() => new Logger(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const blobsRef = useRef<PhysicsBlob[]>([]);
  const drawingRef = useRef<{ x: number; y: number }[]>([]);
  const isDrawing = useRef(false);
  const rafRef = useRef<number>(0);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const [connected, setConnected] = useState(false);
  const [blobCount, setBlobCount] = useState(0);
  const [selectedColor, setSelectedColor] = useState(COLORS[0]);
  const colorRef = useRef(selectedColor);
  colorRef.current = selectedColor;

  const addBlob = (raw: { x: number; y: number }[], color: string, fromRemote = false) => {
    const pts = samplePath(raw, 80);
    if (pts.length < 3) return;
    const c = centroid(pts);
    const b = bbox(pts);
    const localPts = pts.map(p => ({ x: p.x - c.x, y: p.y - c.y }));
    const blob: PhysicsBlob = {
      id: ++blobId, points: localPts, cx: c.x, cy: c.y,
      vx: (Math.random()-0.5)*4, vy: -2 - Math.random()*3,
      w: Math.max(20, b.w), h: Math.max(20, b.h),
      color, rotation: 0, angularV: (Math.random()-0.5)*0.08,
      scale: 1, alive: true,
    };
    blobsRef.current.push(blob);
    setBlobCount(blobsRef.current.length);
    if (!fromRemote && dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'blob', blob: { ...blob, points: localPts } }));
    }
    logger.info(`${fromRemote ? 'Remote' : 'Local'} shape added (${pts.length} pts)`);
  };

  const physicsLoop = () => {
    const canvas = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(physicsLoop); return; }
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, W, H);

    // Floor
    ctx.fillStyle = '#1e3a5f';
    ctx.beginPath(); ctx.roundRect(0, H-20, W, 20, [8,8,0,0]); ctx.fill();
    ctx.fillStyle = '#334155'; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillText('▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬', W/2, H-8);

    // Current stroke preview
    if (isDrawing.current && drawingRef.current.length > 1) {
      ctx.strokeStyle = colorRef.current;
      ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(drawingRef.current[0].x, drawingRef.current[0].y);
      for (const p of drawingRef.current) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Update and draw blobs
    for (const blob of blobsRef.current) {
      blob.vy += GRAVITY;
      blob.cx += blob.vx; blob.cy += blob.vy;
      blob.rotation += blob.angularV;

      const floor = H - 20 - blob.h / 2;
      if (blob.cy > floor) {
        blob.cy = floor;
        blob.vy *= -BOUNCE;
        blob.vx *= FRICTION;
        blob.angularV *= 0.8;
        if (Math.abs(blob.vy) < 0.5) blob.vy = 0;
      }
      if (blob.cx - blob.w/2 < 0) { blob.cx = blob.w/2; blob.vx = Math.abs(blob.vx) * 0.7; }
      if (blob.cx + blob.w/2 > W) { blob.cx = W - blob.w/2; blob.vx = -Math.abs(blob.vx) * 0.7; }

      // Draw blob
      ctx.save();
      ctx.translate(blob.cx, blob.cy);
      ctx.rotate(blob.rotation);
      ctx.fillStyle = blob.color + 'cc';
      ctx.strokeStyle = blob.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (blob.points.length > 0) {
        ctx.moveTo(blob.points[0].x, blob.points[0].y);
        for (const p of blob.points) ctx.lineTo(p.x, p.y);
        ctx.closePath();
      }
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }

    rafRef.current = requestAnimationFrame(physicsLoop);
  };

  useEffect(() => {
    rafRef.current = requestAnimationFrame(physicsLoop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const getPos = (e: React.MouseEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) };
  };

  const connect = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = ev => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = ev => ev.candidate && pcA.addIceCandidate(ev.candidate);
    const dc = pcA.createDataChannel('physics', { ordered: true }); dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Physics sync connected!'); };
    pcB.ondatachannel = ev => {
      ev.channel.onmessage = e => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'blob') {
          const b = msg.blob as PhysicsBlob;
          blobsRef.current.push({ ...b, id: ++blobId });
          setBlobCount(blobsRef.current.length);
        }
        if (msg.type === 'clear') { blobsRef.current = []; setBlobCount(0); }
      };
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  const clearAll = () => {
    blobsRef.current = []; setBlobCount(0);
    if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'clear' }));
    logger.info('Cleared all shapes');
  };

  return (
    <DemoLayout
      title="Physics Whiteboard"
      difficulty="intermediate"
      description="Draw shapes — they fall, bounce, and tumble under gravity. Drawings sync to peers via RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            When you release the mouse after drawing, the stroke is converted into a{' '}
            <strong>physics body</strong>: its centroid becomes the position, the bounding
            box determines collision extent, and it's given a random initial velocity and
            angular spin. A simple Euler integrator adds gravity each frame and reflects
            velocity on floor/wall contact with damping.
          </p>
          <p>
            Each shape is serialized as its original point path (sampled to 80 points to
            keep messages small) and broadcast over a{' '}
            <strong>DataChannel</strong>. The receiver reconstructs the same shape and
            starts its own physics simulation from the same initial state.
          </p>
          <p>
            Draw lots of overlapping scribbles for satisfying chaos. Circles bounce best;
            flat strokes slide and tumble along the floor.
          </p>
        </div>
      }
      hints={[
        'Draw quickly and chaotically for the most satisfying result',
        'Connect Loopback and draw — your shapes appear on the "remote" canvas too',
        'Try drawing a circle — it\'ll bounce perfectly!',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!connected && <button onClick={connect} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg">Sync (Loopback)</button>}
            <button onClick={clearAll} className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-xs rounded-lg">Clear All</button>
            <div className="flex gap-1.5">
              {COLORS.map(c => (
                <button key={c} onClick={() => setSelectedColor(c)}
                  className="w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
                  style={{ backgroundColor: c, borderColor: selectedColor === c ? 'white' : 'transparent' }} />
              ))}
            </div>
            <span className="text-xs text-zinc-600 ml-auto">{blobCount} shapes</span>
          </div>
          <canvas ref={canvasRef} width={W} height={H}
            className="rounded-2xl border border-zinc-800 w-full max-w-2xl block"
            style={{ background: '#0f172a', cursor: 'crosshair', touchAction: 'none' }}
            onMouseDown={e => { isDrawing.current = true; drawingRef.current = [getPos(e)]; }}
            onMouseMove={e => { if (isDrawing.current) drawingRef.current.push(getPos(e)); }}
            onMouseUp={() => { isDrawing.current = false; addBlob(drawingRef.current, colorRef.current); drawingRef.current = []; }}
            onMouseLeave={() => { if (isDrawing.current) { isDrawing.current = false; addBlob(drawingRef.current, colorRef.current); drawingRef.current = []; } }}
          />
          <p className="text-xs text-zinc-500">Draw anything — release to launch it into the physics world ✏️</p>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Draw-to-physics bodies + DataChannel shape sync' }}
      mdnLinks={[
        { label: 'CanvasRenderingContext2D', href: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
