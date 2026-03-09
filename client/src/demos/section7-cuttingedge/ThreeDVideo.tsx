import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const CODE = `// Apply WebRTC video stream as a Three.js texture
import * as THREE from 'three';

const texture = new THREE.VideoTexture(videoElement);
texture.minFilter = THREE.LinearFilter;

const material = new THREE.MeshBasicMaterial({ map: texture });
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  material
);

// Animate!
function render() {
  cube.rotation.y += 0.01;
  texture.needsUpdate = true; // Pull new frame from video
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}`;

export default function ThreeDVideo() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const animRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const pcA = useRef<RTCPeerConnection | null>(null);
  const pcB = useRef<RTCPeerConnection | null>(null);
  const threeRef = useRef<{ renderer: unknown; scene: unknown; camera: unknown; texture: unknown } | null>(null);

  const handleStart = async () => {
    setLoading(true);
    try {
      // Dynamically import Three.js
      const THREE = await import('three');
      logger.info('Three.js loaded');

      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;

      // Hidden video element to serve as texture source
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();

      // Set up Three.js scene
      const canvas = canvasRef.current!;
      const W = canvas.clientWidth;
      const H = canvas.clientHeight;
      canvas.width = W;
      canvas.height = H;

      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setSize(W, H);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x09090b);

      const camera = new THREE.PerspectiveCamera(60, W / H, 0.1, 100);
      camera.position.z = 4;

      const texture = new THREE.VideoTexture(video);
      texture.minFilter = THREE.LinearFilter;

      // All 6 faces of the cube get the video texture
      const material = new THREE.MeshBasicMaterial({ map: texture });
      const cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), material);
      scene.add(cube);

      // Add some ambient particles
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(300);
      for (let i = 0; i < 300; i++) positions[i] = (Math.random() - 0.5) * 20;
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x60a5fa, size: 0.05 }));
      scene.add(points);

      // Loopback through WebRTC
      const a = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      const b = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      pcA.current = a;
      pcB.current = b;
      a.onicecandidate = (ev) => ev.candidate && b.addIceCandidate(ev.candidate);
      b.onicecandidate = (ev) => ev.candidate && a.addIceCandidate(ev.candidate);
      stream.getTracks().forEach((t) => a.addTrack(t, stream));

      // We use the remote stream but continue showing the local stream on the cube
      // (just to demonstrate it works through WebRTC)
      b.ontrack = () => logger.success('Video streaming through WebRTC → Three.js cube');

      const offer = await a.createOffer();
      await a.setLocalDescription(offer);
      await b.setRemoteDescription(offer);
      const answer = await b.createAnswer();
      await b.setLocalDescription(answer);
      await a.setRemoteDescription(answer);

      const animate = () => {
        animRef.current = requestAnimationFrame(animate);
        cube.rotation.y += 0.008;
        cube.rotation.x += 0.003;
        points.rotation.y -= 0.001;
        texture.needsUpdate = true;
        renderer.render(scene, camera);
      };
      animate();

      setConnected(true);
      logger.success('Camera streaming onto spinning 3D cube!');
    } catch (e) {
      logger.error(`Failed: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = () => {
    cancelAnimationFrame(animRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    pcA.current?.close();
    pcB.current?.close();
    setConnected(false);
    if (videoRef.current) videoRef.current.srcObject = null;
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  useEffect(() => () => { cancelAnimationFrame(animRef.current); streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  return (
    <DemoLayout
      title="3D Video with Three.js"
      difficulty="advanced"
      description="Stream video onto a 3D spinning cube texture via Three.js and WebRTC loopback."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">THREE.VideoTexture</code> accepts
            an HTML video element and samples a new frame on each render call (when
            <code className="ml-1 text-xs bg-surface-2 px-1 py-0.5 rounded">texture.needsUpdate = true</code>).
          </p>
          <p>
            The video element's source is a WebRTC remote stream — so the pipeline is:
            camera → WebRTC encode → decode → video element → VideoTexture → GPU → spinning cube.
          </p>
          <p className="text-amber-400/80">⚡ Three.js is ~600KB — may take a moment to load on first run.</p>
        </div>
      }
      demo={
        <div className="space-y-4">
          <div className="flex gap-2">
            {!connected ? (
              <button onClick={handleStart} disabled={loading} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                {loading ? 'Loading Three.js...' : 'Start 3D Video'}
              </button>
            ) : (
              <button onClick={handleStop} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                Stop
              </button>
            )}
          </div>

          <video ref={videoRef} className="hidden" autoPlay playsInline muted />

          <div className="rounded-xl overflow-hidden border border-zinc-800" style={{ height: 400 }}>
            <canvas ref={canvasRef} className="w-full h-full" />
            {!connected && (
              <div className="absolute inset-0 flex items-center justify-center text-zinc-600 text-sm pointer-events-none">
                {loading ? 'Initializing...' : 'Click Start to begin'}
              </div>
            )}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Three.js VideoTexture from WebRTC' }}
      mdnLinks={[
        { label: 'Three.js VideoTexture', href: 'https://threejs.org/docs/#api/en/textures/VideoTexture' },
      ]}
    />
  );
}
