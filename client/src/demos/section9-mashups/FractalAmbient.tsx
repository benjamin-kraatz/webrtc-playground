import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const W = 560, H = 340;

interface Viewport { cx: number; cy: number; zoom: number; maxIter: number; }

function mandelbrot(cx: number, cy: number, maxIter: number): number {
  let x = 0, y = 0;
  for (let i = 0; i < maxIter; i++) {
    const xn = x * x - y * y + cx;
    y = 2 * x * y + cy; x = xn;
    if (x * x + y * y > 4) return i + 1 - Math.log2(Math.log2(Math.sqrt(x * x + y * y)));
  }
  return maxIter;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1); };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

const CODE = `// MASHUP: FractalExplorer + WebAudioSynth
// Fractal viewport state drives Tone.js ambient synthesizer

const { centerX, centerY, zoom } = viewport;

// Zoom level → reverb decay (deep zoom = long reverb)
const reverbDecay = Math.log10(zoom + 1) * 2 + 0.5;
reverb.decay = reverbDecay;

// Horizontal position → oscillator frequency (left = low, right = high)
const baseFreq = 200 * Math.pow(4, (centerX + 2.5) / 3.5);
osc1.frequency.rampTo(baseFreq, 0.5);

// Vertical position → detuning
const detune = centerY * 400;
osc2.detune.rampTo(detune, 0.5);

// Sync viewport to peer
dc.send(JSON.stringify({ type: 'viewport', cx, cy, zoom, maxIter }));`;

export default function FractalAmbient() {
  const logger = useMemo(() => new Logger(), []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [viewport, setViewport] = useState<Viewport>({ cx: -0.5, cy: 0, zoom: 1, maxIter: 80 });
  const vpRef = useRef(viewport);
  vpRef.current = viewport;
  const [playing, setPlaying] = useState(false);
  const [connected, setConnected] = useState(false);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const oscRef = useRef<{ frequency: { rampTo: (f: number, t: number) => void } } | null>(null);
  const osc2Ref = useRef<{ detune: { rampTo: (d: number, t: number) => void } } | null>(null);
  const reverbRef = useRef<{ decay: number } | null>(null);
  const renderWorker = useRef<Worker | null>(null);
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, cx: 0, cy: 0 });

  const renderFractal = useCallback((vp: Viewport) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(W, H);
    const { cx, cy, zoom, maxIter } = vp;
    const scale = 3.5 / zoom;
    for (let px = 0; px < W; px++) {
      for (let py = 0; py < H; py++) {
        const fx = cx + (px / W - 0.5) * scale;
        const fy = cy + (py / H - 0.5) * scale * (H / W);
        const v = mandelbrot(fx, fy, maxIter);
        const i = (py * W + px) * 4;
        if (v >= maxIter) { imageData.data[i] = 0; imageData.data[i+1] = 0; imageData.data[i+2] = 0; }
        else {
          const t = v / maxIter;
          const [r, g, b] = hslToRgb(240 + t * 200, 0.8, 0.1 + t * 0.6);
          imageData.data[i] = r; imageData.data[i+1] = g; imageData.data[i+2] = b;
        }
        imageData.data[(py * W + px) * 4 + 3] = 255;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    // Draw center crosshair
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W/2 - 10, H/2); ctx.lineTo(W/2 + 10, H/2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(W/2, H/2 - 10); ctx.lineTo(W/2, H/2 + 10); ctx.stroke();
  }, []);

  const updateSynth = useCallback(async (vp: Viewport) => {
    if (!oscRef.current) return;
    const baseFreq = 150 * Math.pow(4, (vp.cx + 2.5) / 3.5);
    const safeFreq = Math.max(80, Math.min(1200, baseFreq));
    oscRef.current.frequency.rampTo(safeFreq, 0.6);
    if (osc2Ref.current) osc2Ref.current.detune.rampTo(vp.cy * 300, 0.6);
    if (reverbRef.current) reverbRef.current.decay = Math.max(0.1, Math.min(10, Math.log10(vp.zoom + 1) * 3 + 0.5));
  }, []);

  useEffect(() => { renderFractal(viewport); }, [viewport, renderFractal]);

  const startMusic = async () => {
    const Tone = await import('tone');
    await Tone.start();
    const reverb = new Tone.Reverb(2).toDestination();
    await reverb.ready;
    const osc = new Tone.Oscillator(200, 'sine').connect(reverb);
    const osc2 = new Tone.Oscillator(200, 'triangle').connect(reverb);
    const vol = new Tone.Volume(-20);
    osc.connect(vol); osc2.connect(vol); vol.toDestination();
    osc.start(); osc2.start();
    oscRef.current = osc as unknown as typeof oscRef.current;
    osc2Ref.current = osc2 as unknown as typeof osc2Ref.current;
    reverbRef.current = reverb as unknown as typeof reverbRef.current;
    setPlaying(true);
    updateSynth(vpRef.current);
    logger.success('Ambient music started — navigate the fractal to change the sound!');
  };

  const stopMusic = async () => {
    const Tone = await import('tone');
    (oscRef.current as unknown as { stop?: () => void })?.stop?.();
    (osc2Ref.current as unknown as { stop?: () => void })?.stop?.();
    oscRef.current = null; osc2Ref.current = null;
    setPlaying(false); logger.info('Music stopped');
  };

  const connectLoopback = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG), pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = e => e.candidate && pcB.addIceCandidate(e.candidate);
    pcB.onicecandidate = e => e.candidate && pcA.addIceCandidate(e.candidate);
    const dc = pcA.createDataChannel('fractal'); dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Fractal viewport synced!'); };
    pcB.ondatachannel = ev => {
      ev.channel.onmessage = e => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'viewport') { setViewport(msg.vp); updateSynth(msg.vp); }
      };
    };
    const offer = await pcA.createOffer(); await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer(); await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  const syncViewport = useCallback((vp: Viewport) => {
    if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'viewport', vp }));
    if (playing) updateSynth(vp);
  }, [playing, updateSynth]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;
    const scale = 3.5 / vpRef.current.zoom;
    const fx = vpRef.current.cx + (mx - 0.5) * scale;
    const fy = vpRef.current.cy + (my - 0.5) * scale * (H / W);
    const factor = e.deltaY < 0 ? 1.4 : 1 / 1.4;
    const newZoom = Math.max(0.5, Math.min(1e8, vpRef.current.zoom * factor));
    const newScale = 3.5 / newZoom;
    const newVp: Viewport = { cx: fx - (mx - 0.5) * newScale, cy: fy - (my - 0.5) * newScale * (H / W), zoom: newZoom, maxIter: Math.min(200, Math.round(80 + Math.log2(newZoom) * 8)) };
    setViewport(newVp); syncViewport(newVp);
  };

  const handleMouseDown = (e: React.MouseEvent) => { dragging.current = true; dragStart.current = { x: e.clientX, y: e.clientY, cx: vpRef.current.cx, cy: vpRef.current.cy }; };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return;
    const scale = 3.5 / vpRef.current.zoom;
    const dx = (e.clientX - dragStart.current.x) / W * scale;
    const dy = (e.clientY - dragStart.current.y) / H * scale * (H / W);
    const newVp: Viewport = { ...vpRef.current, cx: dragStart.current.cx - dx, cy: dragStart.current.cy - dy };
    setViewport(newVp);
  };
  const handleMouseUp = () => { if (dragging.current) { dragging.current = false; syncViewport(vpRef.current); } };

  return (
    <DemoLayout
      title="Fractal Ambient"
      difficulty="intermediate"
      description="MASHUP: FractalExplorer + WebAudioSynth — navigate the Mandelbrot set and let the fractal compose ambient music. Zoom controls reverb, position controls pitch. Share journeys with peers."
      explanation={
        <div className="space-y-3 text-sm">
          <p>Explore the Mandelbrot set while the fractal parameters drive a live ambient synthesizer:</p>
          <ul className="list-disc list-inside space-y-1 pl-2">
            <li><strong>Zoom level</strong> → reverb decay time (deep zoom = long, cavernous reverb)</li>
            <li><strong>Horizontal position</strong> → oscillator frequency (left = low, right = high)</li>
            <li><strong>Vertical position</strong> → second oscillator detune (creates tension)</li>
          </ul>
          <p>Connect loopback and navigate together — both peers hear the same fractal soundscape.</p>
        </div>
      }
      hints={[
        'Scroll to zoom, drag to pan',
        'Try zooming into the Mandelbrot boundary for maximum reverb',
        'The spiral at (-0.77, 0.1) produces beautiful drone sounds',
        'Connect loopback to share your sonic journey with a "peer"',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 items-center">
            {!playing ? <button onClick={startMusic} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg">🎵 Start Music</button>
              : <button onClick={stopMusic} className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-white text-sm font-medium rounded-lg">⏹ Stop</button>}
            {!connected && <button onClick={connectLoopback} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg">🔗 Sync Loopback</button>}
            {connected && <span className="px-2 py-1 bg-blue-900/40 border border-blue-700 text-blue-300 text-xs rounded-lg">🔗 Synced</span>}
            <button onClick={() => { const vp: Viewport = { cx: -0.5, cy: 0, zoom: 1, maxIter: 80 }; setViewport(vp); syncViewport(vp); }} className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs rounded-lg">Reset</button>
            <div className="ml-auto text-xs text-zinc-500">
              zoom {vpRef.current.zoom.toFixed(1)}× · ({vpRef.current.cx.toFixed(4)}, {vpRef.current.cy.toFixed(4)})
            </div>
          </div>
          <canvas ref={canvasRef} width={W} height={H}
            className="rounded-xl border border-zinc-800 w-full cursor-crosshair"
            onWheel={handleWheel} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp}
          />
          <p className="text-xs text-zinc-500">Scroll to zoom • Drag to pan • Music adapts to your position</p>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Fractal viewport → Tone.js parameters' }}
      mdnLinks={[
        { label: 'Tone.js Oscillator', href: 'https://tonejs.github.io/docs/latest/classes/Oscillator' },
        { label: 'Tone.js Reverb', href: 'https://tonejs.github.io/docs/latest/classes/Reverb' },
      ]}
    />
  );
}
