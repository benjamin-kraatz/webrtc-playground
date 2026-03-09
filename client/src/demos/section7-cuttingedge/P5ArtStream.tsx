import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import type p5Type from 'p5';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

interface SketchParams {
  speed: number;
  particleCount: number;
  hueStart: number;
  saturation: number;
}

const CODE = `// p5.js flow field captured via captureStream()
// and streamed over WebRTC loopback

// In p5 instance mode
const sketch = (p: p5) => {
  let particles: Particle[] = [];

  p.setup = () => {
    const canvas = p.createCanvas(640, 480);
    // Capture the p5 canvas as a MediaStream
    const stream = canvas.elt.captureStream(30);
    sendOverWebRTC(stream);
  };

  p.draw = () => {
    particles.forEach((particle) => {
      const angle = p.noise(particle.x * 0.003, particle.y * 0.003) * p.TWO_PI * 2;
      particle.x += p.cos(angle) * speed;
      particle.y += p.sin(angle) * speed;
      p.point(particle.x, particle.y);
    });
  };
};`;

export default function P5ArtStream() {
  const logger = useMemo(() => new Logger(), []);
  const sketchContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const p5InstanceRef = useRef<p5Type | null>(null);
  const pcARef = useRef<RTCPeerConnection | null>(null);
  const pcBRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [params, setParams] = useState<SketchParams>({
    speed: 2,
    particleCount: 600,
    hueStart: 200,
    saturation: 80,
  });
  const paramsRef = useRef(params);
  paramsRef.current = params;

  const initSketchAndStream = useCallback(async () => {
    if (p5InstanceRef.current) return;
    const { default: p5 } = await import('p5');

    const sketch = (p: p5Type) => {
      type Particle = { x: number; y: number; hue: number; life: number };
      let particles: Particle[] = [];
      const W = 640;
      const H = 480;

      const resetParticles = (count: number) => {
        particles = Array.from({ length: count }, () => ({
          x: p.random(W),
          y: p.random(H),
          hue: p.random(360),
          life: p.random(100, 300),
        }));
      };

      p.setup = () => {
        const canvas = p.createCanvas(W, H);
        p.colorMode(p.HSB, 360, 100, 100, 100);
        p.background(0, 0, 5);
        p.strokeWeight(1.2);
        p.noFill();
        resetParticles(paramsRef.current.particleCount);

        // Capture canvas as MediaStream
        const stream = (canvas.elt as HTMLCanvasElement).captureStream(30);
        streamRef.current = stream;
      };

      p.draw = () => {
        const { speed, hueStart, saturation } = paramsRef.current;
        p.noStroke();
        p.fill(0, 0, 5, 8);
        p.rect(0, 0, W, H);
        p.strokeWeight(1.2);

        for (const particle of particles) {
          const nx = particle.x * 0.003;
          const ny = particle.y * 0.003;
          const nt = p.frameCount * 0.003;
          const angle = p.noise(nx, ny, nt) * p.TWO_PI * 2.5;

          particle.x += p.cos(angle) * speed;
          particle.y += p.sin(angle) * speed;
          particle.hue = (particle.hue + 0.3) % 360;
          particle.life--;

          if (
            particle.life <= 0 ||
            particle.x < 0 || particle.x > W ||
            particle.y < 0 || particle.y > H
          ) {
            particle.x = p.random(W);
            particle.y = p.random(H);
            particle.life = p.random(100, 300);
          }

          const h = (hueStart + particle.hue * 0.3) % 360;
          p.stroke(h, saturation, 90, 70);
          p.point(particle.x, particle.y);
        }
      };
    };

    p5InstanceRef.current = new p5(sketch, sketchContainerRef.current!);
    logger.info('p5.js sketch started (Perlin noise flow field)');

    // Wait for stream to be ready
    await new Promise((res) => setTimeout(res, 200));

    if (!streamRef.current) { logger.error('Canvas stream not available'); return; }

    // Loopback WebRTC connection
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcARef.current = pcA;
    pcBRef.current = pcB;

    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);

    streamRef.current.getTracks().forEach((t) => pcA.addTrack(t, streamRef.current!));

    pcB.ontrack = (ev) => {
      if (videoRef.current) {
        videoRef.current.srcObject = ev.streams[0] ?? new MediaStream([ev.track]);
        videoRef.current.play().catch(() => {});
      }
      setStreaming(true);
      logger.success('WebRTC stream received — art flowing through the peer connection!');
    };

    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  }, [logger]);

  const handleStart = () => { initSketchAndStream(); };

  const handleStop = () => {
    p5InstanceRef.current?.remove();
    p5InstanceRef.current = null;
    pcARef.current?.close();
    pcBRef.current?.close();
    setStreaming(false);
    streamRef.current = null;
    logger.info('Sketch stopped');
  };

  useEffect(() => {
    return () => {
      p5InstanceRef.current?.remove();
      pcARef.current?.close();
      pcBRef.current?.close();
    };
  }, []);

  return (
    <DemoLayout
      title="p5.js Art Stream"
      difficulty="advanced"
      description="A p5.js Perlin noise flow field captured via captureStream() and streamed over a WebRTC loopback connection."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>p5.js</strong> renders a generative Perlin-noise flow field on an HTML canvas.
            The canvas is captured as a <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">MediaStream</code> via
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded ml-1">canvas.captureStream(30)</code> and
            fed into a WebRTC peer connection — just like a real camera stream.
          </p>
          <p>
            The <em>Received Stream</em> video on the right shows exactly what a peer would see
            after the stream travels through WebRTC encoding/decoding. Adjust parameters to change
            the art in real time.
          </p>
        </div>
      }
      hints={['Left = raw p5.js canvas, Right = same stream after WebRTC encode/decode', 'Try cranking up particle count for a denser field', 'Hue offset cycles through the color wheel']}
      demo={
        <div className="space-y-4">
          {!p5InstanceRef.current ? (
            <button
              onClick={handleStart}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-lg"
            >
              Start Generative Art
            </button>
          ) : (
            <button
              onClick={handleStop}
              className="px-4 py-2 bg-red-900/40 text-red-400 text-sm font-medium rounded-lg border border-red-800"
            >
              Stop
            </button>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">p5.js Canvas (Source)</p>
              <div
                ref={sketchContainerRef}
                className="rounded-xl overflow-hidden bg-zinc-950 border border-zinc-800"
                style={{ aspectRatio: '4/3' }}
              />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">
                WebRTC Stream (Received)
                {streaming && <span className="ml-2 text-emerald-400">● live</span>}
              </p>
              <div className="aspect-video bg-zinc-950 rounded-xl overflow-hidden flex items-center justify-center border border-zinc-800" style={{ aspectRatio: '4/3' }}>
                <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                {!streaming && <p className="absolute text-xs text-zinc-700">Waiting for stream…</p>}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { key: 'speed' as const, label: 'Speed', min: 0.5, max: 5, step: 0.1 },
              { key: 'particleCount' as const, label: 'Particles', min: 100, max: 2000, step: 100 },
              { key: 'hueStart' as const, label: 'Hue Offset', min: 0, max: 360, step: 1 },
              { key: 'saturation' as const, label: 'Saturation', min: 20, max: 100, step: 5 },
            ].map(({ key, label, min, max, step }) => (
              <div key={key} className="space-y-1">
                <label className="text-xs text-zinc-500 flex justify-between">
                  <span>{label}</span>
                  <span className="text-zinc-400">{params[key]}</span>
                </label>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={params[key]}
                  onChange={(e) => setParams((prev) => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                  className="w-full accent-purple-500"
                />
              </div>
            ))}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'p5.js canvas streamed via WebRTC' }}
      mdnLinks={[
        { label: 'HTMLCanvasElement.captureStream()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/captureStream' },
        { label: 'MediaStream', href: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaStream' },
      ]}
    />
  );
}
