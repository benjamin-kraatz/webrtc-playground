import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const CODE = `// Quantum entanglement via WebRTC DataChannel
// When you observe your qubit, the entangled peer qubit collapses instantly

type QubitState =
  | { phase: 'superposition'; phi: number }
  | { phase: 'collapsing'; to: 0|1; progress: number }
  | { phase: 'collapsed'; value: 0|1 };

// Born rule: random collapse, 50/50
const result = Math.random() < 0.5 ? 0 : 1;
setMyState({ phase: 'collapsing', to: result, progress: 0 });

// Send entanglement signal — peer's qubit collapses to OPPOSITE value
dc.send(JSON.stringify({ type: 'entanglement', result }));

// On peer receive:
const opposite = (msg.result === 0 ? 1 : 0) as 0|1;
setPeerState({ phase: 'collapsing', to: opposite, progress: 0 });`;

type QubitState =
  | { phase: 'superposition'; phi: number }
  | { phase: 'collapsing'; to: 0 | 1; progress: number }
  | { phase: 'collapsed'; value: 0 | 1 };

interface MeasurementRecord {
  myValue: 0 | 1;
  peerValue: 0 | 1;
  antiCorrelated: boolean;
}

function buildBlochScene(canvas: HTMLCanvasElement): {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  arrow: THREE.ArrowHelper;
  dispose: () => void;
} {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setSize(240, 240);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);

  // Wireframe sphere
  const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
  const sphereMat = new THREE.MeshBasicMaterial({ color: 0x2dd4bf, wireframe: true, transparent: true, opacity: 0.35 });
  scene.add(new THREE.Mesh(sphereGeo, sphereMat));

  // Axis lines
  const axisMat = new THREE.LineBasicMaterial({ color: 0x52525b, transparent: true, opacity: 0.5 });
  const axisPoints = [
    [new THREE.Vector3(0, -1.3, 0), new THREE.Vector3(0, 1.3, 0)],
    [new THREE.Vector3(-1.3, 0, 0), new THREE.Vector3(1.3, 0, 0)],
    [new THREE.Vector3(0, 0, -1.3), new THREE.Vector3(0, 0, 1.3)],
  ];
  for (const [a, b] of axisPoints) {
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    scene.add(new THREE.Line(geo, axisMat));
  }

  // Equatorial circle
  const eqPoints: THREE.Vector3[] = [];
  for (let i = 0; i <= 64; i++) {
    const angle = (i / 64) * Math.PI * 2;
    eqPoints.push(new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)));
  }
  const eqGeo = new THREE.BufferGeometry().setFromPoints(eqPoints);
  scene.add(new THREE.Line(eqGeo, new THREE.LineBasicMaterial({ color: 0x14b8a6, transparent: true, opacity: 0.4 })));

  // Pole labels (small spheres)
  const poleMat0 = new THREE.MeshBasicMaterial({ color: 0x00ffff });
  const poleMat1 = new THREE.MeshBasicMaterial({ color: 0xff4444 });
  const poleGeo = new THREE.SphereGeometry(0.05, 8, 8);
  scene.add(Object.assign(new THREE.Mesh(poleGeo, poleMat0), { position: new THREE.Vector3(0, 1.05, 0) }));
  scene.add(Object.assign(new THREE.Mesh(poleGeo, poleMat1), { position: new THREE.Vector3(0, -1.05, 0) }));

  // State vector arrow (starts pointing at equator +X)
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 0),
    1.0,
    0x00ffff,
    0.25,
    0.12,
  );
  scene.add(arrow);

  const dispose = () => {
    renderer.dispose();
    sphereGeo.dispose();
    sphereMat.dispose();
    eqGeo.dispose();
    poleGeo.dispose();
    poleMat0.dispose();
    poleMat1.dispose();
  };

  return { renderer, scene, camera, arrow, dispose };
}

function stateToDirection(state: QubitState): { dir: THREE.Vector3; color: number } {
  if (state.phase === 'superposition') {
    const x = Math.cos(state.phi);
    const z = Math.sin(state.phi);
    const hue = ((state.phi / (Math.PI * 2)) * 360) % 360;
    const color = new THREE.Color().setHSL(hue / 360, 1, 0.6);
    return { dir: new THREE.Vector3(x, 0, z), color: color.getHex() };
  }
  if (state.phase === 'collapsing') {
    const t = state.progress;
    const targetTheta = state.to === 0 ? 0 : Math.PI;
    const theta = (Math.PI / 2) * (1 - t) + targetTheta * t;
    const dir = new THREE.Vector3(Math.sin(theta), Math.cos(theta), 0);
    const color = state.to === 0 ? 0x00ffff : 0xff4444;
    return { dir, color };
  }
  // collapsed
  const dir = new THREE.Vector3(0, state.value === 0 ? 1 : -1, 0);
  const color = state.value === 0 ? 0x00ffff : 0xff4444;
  return { dir, color };
}

export default function QuantumEntanglement() {
  const logger = useMemo(() => new Logger(), []);

  const myCanvasRef = useRef<HTMLCanvasElement>(null);
  const peerCanvasRef = useRef<HTMLCanvasElement>(null);

  const mySceneRef = useRef<ReturnType<typeof buildBlochScene> | null>(null);
  const peerSceneRef = useRef<ReturnType<typeof buildBlochScene> | null>(null);

  const animRef = useRef<number>(0);
  const myStateRef = useRef<QubitState>({ phase: 'superposition', phi: 0 });
  const peerStateRef = useRef<QubitState>({ phase: 'superposition', phi: Math.PI / 3 });

  const [myStateDisplay, setMyStateDisplay] = useState<QubitState>({ phase: 'superposition', phi: 0 });
  const [peerStateDisplay, setPeerStateDisplay] = useState<QubitState>({ phase: 'superposition', phi: Math.PI / 3 });

  const pcARef = useRef<RTCPeerConnection | null>(null);
  const pcBRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const [history, setHistory] = useState<MeasurementRecord[]>([]);

  // Initialize Three.js scenes
  useEffect(() => {
    if (!myCanvasRef.current || !peerCanvasRef.current) return;

    mySceneRef.current = buildBlochScene(myCanvasRef.current);
    peerSceneRef.current = buildBlochScene(peerCanvasRef.current);

    let lastTime = performance.now();

    const loop = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      // Update my state
      const my = myStateRef.current;
      if (my.phase === 'superposition') {
        const newPhi = my.phi + dt * 1.8;
        myStateRef.current = { phase: 'superposition', phi: newPhi };
        setMyStateDisplay({ phase: 'superposition', phi: newPhi });
      } else if (my.phase === 'collapsing') {
        const newProg = Math.min(1, my.progress + dt / 0.5);
        if (newProg >= 1) {
          myStateRef.current = { phase: 'collapsed', value: my.to };
          setMyStateDisplay({ phase: 'collapsed', value: my.to });
        } else {
          myStateRef.current = { phase: 'collapsing', to: my.to, progress: newProg };
          setMyStateDisplay({ phase: 'collapsing', to: my.to, progress: newProg });
        }
      }

      // Update peer state
      const peer = peerStateRef.current;
      if (peer.phase === 'superposition') {
        const newPhi = peer.phi + dt * 2.1;
        peerStateRef.current = { phase: 'superposition', phi: newPhi };
        setPeerStateDisplay({ phase: 'superposition', phi: newPhi });
      } else if (peer.phase === 'collapsing') {
        const newProg = Math.min(1, peer.progress + dt / 0.5);
        if (newProg >= 1) {
          peerStateRef.current = { phase: 'collapsed', value: peer.to };
          setPeerStateDisplay({ phase: 'collapsed', value: peer.to });
        } else {
          peerStateRef.current = { phase: 'collapsing', to: peer.to, progress: newProg };
          setPeerStateDisplay({ phase: 'collapsing', to: peer.to, progress: newProg });
        }
      }

      // Render my sphere
      if (mySceneRef.current) {
        const { dir, color } = stateToDirection(myStateRef.current);
        mySceneRef.current.arrow.setDirection(dir.normalize());
        mySceneRef.current.arrow.setColor(new THREE.Color(color));
        mySceneRef.current.renderer.render(mySceneRef.current.scene, mySceneRef.current.camera);
      }

      // Render peer sphere
      if (peerSceneRef.current) {
        const { dir, color } = stateToDirection(peerStateRef.current);
        peerSceneRef.current.arrow.setDirection(dir.normalize());
        peerSceneRef.current.arrow.setColor(new THREE.Color(color));
        peerSceneRef.current.renderer.render(peerSceneRef.current.scene, peerSceneRef.current.camera);
      }

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animRef.current);
      mySceneRef.current?.dispose();
      peerSceneRef.current?.dispose();
    };
  }, []);

  const handleEntangle = useCallback(async () => {
    setConnecting(true);
    logger.info('Setting up entanglement (loopback DataChannel)...');

    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcARef.current = pcA;
    pcBRef.current = pcB;

    const dc = pcA.createDataChannel('entanglement');
    dcRef.current = dc;

    dc.onopen = () => {
      setConnected(true);
      setConnecting(false);
      logger.info('Quantum entanglement established! Qubits are now entangled.');
    };
    dc.onmessage = (e) => {
      const msg = JSON.parse(e.data) as { type: string; result?: 0 | 1; reset?: boolean };
      if (msg.type === 'entanglement' && msg.result !== undefined) {
        const opposite = (msg.result === 0 ? 1 : 0) as 0 | 1;
        logger.info(`Entanglement signal received! Peer qubit collapsing to |${opposite}⟩`);
        peerStateRef.current = { phase: 'collapsing', to: opposite, progress: 0 };
      }
      if (msg.type === 'reset') {
        peerStateRef.current = { phase: 'superposition', phi: Math.random() * Math.PI * 2 };
        logger.info('Peer qubit reset to superposition |+⟩');
      }
    };

    pcB.ondatachannel = (e) => {
      e.channel.onmessage = dc.onmessage;
    };

    pcA.onicecandidate = (e) => { if (e.candidate) pcB.addIceCandidate(e.candidate); };
    pcB.onicecandidate = (e) => { if (e.candidate) pcA.addIceCandidate(e.candidate); };

    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);

    logger.info('ICE negotiation complete');
  }, [logger]);

  const handleObserve = useCallback(() => {
    if (!connected || !dcRef.current) return;
    const myState = myStateRef.current;
    if (myState.phase !== 'superposition') return;

    const result = (Math.random() < 0.5 ? 0 : 1) as 0 | 1;
    logger.info(`Observing qubit... collapsed to |${result}⟩`);
    myStateRef.current = { phase: 'collapsing', to: result, progress: 0 };

    dcRef.current.send(JSON.stringify({ type: 'entanglement', result }));

    // Record measurement after collapse animation (500ms)
    setTimeout(() => {
      const peerFinal = peerStateRef.current;
      const peerValue = peerFinal.phase === 'collapsed' ? peerFinal.value
        : peerFinal.phase === 'collapsing' ? peerFinal.to
        : null;
      if (peerValue !== null) {
        const antiCorrelated = result !== peerValue;
        setHistory(h => [{ myValue: result, peerValue, antiCorrelated }, ...h].slice(0, 10));
        logger.info(`Pair recorded: my=${result}, peer=${peerValue}, anti-correlated=${antiCorrelated}`);
      }
    }, 600);
  }, [connected, logger]);

  const handleReset = useCallback(() => {
    myStateRef.current = { phase: 'superposition', phi: 0 };
    peerStateRef.current = { phase: 'superposition', phi: Math.PI / 4 };
    logger.info('Both qubits reset to superposition |+⟩');
    if (dcRef.current?.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'reset' }));
    }
  }, [logger]);

  const antiCorrelatedCount = history.filter(r => r.antiCorrelated).length;
  const myPhase = myStateDisplay.phase;
  const peerPhase = peerStateDisplay.phase;

  function stateBadge(state: QubitState) {
    if (state.phase === 'superposition') {
      return <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-teal-900 text-teal-300 border border-teal-700">|+⟩ superposition</span>;
    }
    if (state.phase === 'collapsing') {
      return <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-yellow-900 text-yellow-300 border border-yellow-700 animate-pulse">collapsing...</span>;
    }
    return state.value === 0
      ? <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-cyan-900 text-cyan-300 border border-cyan-700">|0⟩ north pole</span>
      : <span className="px-2 py-0.5 rounded-full text-xs font-mono bg-red-900 text-red-300 border border-red-700">|1⟩ south pole</span>;
  }

  const canObserve = connected && myPhase === 'superposition';
  const canReset = myPhase !== 'superposition' || peerPhase !== 'superposition';

  return (
    <DemoLayout
      title="Quantum Entanglement"
      difficulty="advanced"
      description="Bloch sphere visualization of entangled qubits collapsing via WebRTC DataChannel"
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Two virtual qubits start in quantum superposition — the equatorial belt of the Bloch sphere. Each qubit's state vector spins, representing phase precession of the |+⟩ state. When you <strong>Observe</strong> your qubit, the Born rule randomly collapses it to |0⟩ (north pole, cyan) or |1⟩ (south pole, red).
          </p>
          <p>
            Thanks to <strong>quantum entanglement</strong> (simulated via an RTCDataChannel message), the peer qubit instantly collapses to the <em>opposite</em> state. This demonstrates EPR-style anti-correlation: 100% of entangled pairs show perfect anti-correlation.
          </p>
          <p className="text-zinc-500 italic text-xs">
            Note: Real quantum entanglement cannot transmit information faster than light. This simulation uses a WebRTC DataChannel — which is very much limited by the speed of light.
          </p>
        </div>
      }
      demo={
        <div className="space-y-4">
          {/* Spheres */}
          <div className="flex gap-6 justify-center flex-wrap">
            {/* My qubit */}
            <div className="flex flex-col items-center gap-2">
              <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Your Qubit</div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden" style={{ width: 240, height: 240 }}>
                <canvas ref={myCanvasRef} width={240} height={240} />
              </div>
              <div className="mt-1">{stateBadge(myStateDisplay)}</div>
            </div>

            {/* Entanglement symbol */}
            <div className="flex items-center text-teal-500 text-2xl font-bold select-none" style={{ marginTop: 80 }}>
              ⟺
            </div>

            {/* Peer qubit */}
            <div className="flex flex-col items-center gap-2">
              <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Peer's Qubit</div>
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden" style={{ width: 240, height: 240 }}>
                <canvas ref={peerCanvasRef} width={240} height={240} />
              </div>
              <div className="mt-1">{stateBadge(peerStateDisplay)}</div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex flex-wrap gap-3 justify-center">
            <button
              onClick={handleEntangle}
              disabled={connected || connecting}
              className="px-4 py-2 bg-teal-700 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              {connecting ? 'Entangling...' : connected ? 'Entangled' : 'Entangle Qubits'}
            </button>
            <button
              onClick={handleObserve}
              disabled={!canObserve}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              Observe Your Qubit
            </button>
            <button
              onClick={handleReset}
              disabled={!canReset}
              className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              Reset to Superposition
            </button>
          </div>

          {/* Status */}
          {!connected && (
            <p className="text-center text-zinc-500 text-sm">Click "Entangle Qubits" to link the two qubits via a loopback RTCDataChannel.</p>
          )}

          {/* Measurement history */}
          {history.length > 0 && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-300">Measurement History</span>
                <span className="text-xs text-teal-400 font-mono">
                  {antiCorrelatedCount}/{history.length} anti-correlated ({Math.round(antiCorrelatedCount / history.length * 100)}%)
                </span>
              </div>
              <div className="space-y-1">
                {history.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs font-mono">
                    <span className="text-zinc-500">#{history.length - i}</span>
                    <span className={r.myValue === 0 ? 'text-cyan-400' : 'text-red-400'}>Me: |{r.myValue}⟩</span>
                    <span className={r.peerValue === 0 ? 'text-cyan-400' : 'text-red-400'}>Peer: |{r.peerValue}⟩</span>
                    <span className={r.antiCorrelated ? 'text-green-400' : 'text-yellow-400'}>
                      {r.antiCorrelated ? 'anti-correlated' : 'correlated (anomaly)'}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-xs text-zinc-500 italic">
                WebRTC was faster than the speed of light* (*just kidding, this is simulated)
              </p>
            </div>
          )}

          {/* Legend */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <div className="text-xs font-semibold text-zinc-400 mb-2">Bloch Sphere Legend</div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-zinc-500">
              <div><span className="text-teal-400">●</span> Teal wireframe — Bloch sphere surface</div>
              <div><span className="text-cyan-400">●</span> Cyan dot — |0⟩ north pole</div>
              <div><span className="text-teal-300">→</span> Arrow — current state vector</div>
              <div><span className="text-red-400">●</span> Red dot — |1⟩ south pole</div>
              <div><span className="text-teal-300">○</span> Equatorial ring — superposition belt</div>
              <div><span className="text-zinc-400">---</span> Axis lines — X, Y, Z axes</div>
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Quantum Collapse via DataChannel' }}
      hints={[
        'The Born rule gives each |0⟩ or |1⟩ outcome equal 50% probability during observation.',
        'In real quantum mechanics, entanglement cannot be used to send information — the correlation is only apparent after classical communication.',
        'The Bloch sphere is the standard representation for a single qubit: north pole = |0⟩, south pole = |1⟩, equator = superposition.',
        'The WebRTC DataChannel message is the "classical channel" that reveals the anti-correlation — mimicking how real EPR experiments work.',
      ]}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
        { label: 'Bloch sphere (Wikipedia)', href: 'https://en.wikipedia.org/wiki/Bloch_sphere' },
      ]}
    />
  );
}
