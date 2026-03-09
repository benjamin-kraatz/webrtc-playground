import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

interface Node { id: string; x: number; y: number; color: string }
interface Edge { a: string; b: string }
interface Packet { id: number; edgeIdx: number; t: number; dir: 1 | -1 }

const COLORS = ['#60a5fa','#f87171','#34d399','#fbbf24','#a78bfa','#fb923c','#38bdf8'];
let pktId = 0;
const W = 560, H = 340;

function hashToPos(id: string): [number, number] {
  let h1 = 0, h2 = 0;
  for (let i = 0; i < id.length; i++) { h1 = (h1 * 31 + id.charCodeAt(i)) >>> 0; h2 = (h2 * 37 + id.charCodeAt(i)) >>> 0; }
  return [60 + (h1 % (W - 120)), 60 + (h2 % (H - 120))];
}

const CODE = `// Network topology graph — each peer announces its connections

// On join, broadcast a "hello" with your peerId
dc.onopen = () => {
  dc.send(JSON.stringify({ type: 'hello', from: peerId }));
};

// Receive "hello" → add edge to graph
dc.onmessage = ({ data }) => {
  const { type, from } = JSON.parse(data);
  if (type === 'hello') graph.addEdge(myPeerId, from);
};

// Animate data "packets" flowing along edges every 2s
setInterval(() => {
  for (const edge of graph.edges) {
    packets.push({ edge, t: 0, dir: Math.random() > 0.5 ? 1 : -1 });
  }
}, 2000);`;

export default function NetworkGraph() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const myColor = useMemo(() => COLORS[Math.floor(Math.random() * COLORS.length)], []);
  const [roomId, setRoomId] = useState('GRAPH01');
  const [joined, setJoined] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Map<string, Node>>(new Map());
  const edgesRef = useRef<Edge[]>([]);
  const packetsRef = useRef<Packet[]>([]);
  const rafRef = useRef<number>(0);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const dataChannels = useRef(new Map<string, RTCDataChannel>());
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const addEdge = (a: string, b: string) => {
    const exists = edgesRef.current.some(e => (e.a===a&&e.b===b)||(e.a===b&&e.b===a));
    if (!exists) edgesRef.current = [...edgesRef.current, { a, b }];
  };

  const broadcast = (msg: object) => {
    const s = JSON.stringify(msg);
    dataChannels.current.forEach(dc => { if (dc.readyState === 'open') dc.send(s); });
  };

  const setupDc = useCallback((dc: RTCDataChannel, remotePeerId: string) => {
    dataChannels.current.set(remotePeerId, dc);
    dc.onopen = () => {
      addEdge(peerId, remotePeerId);
      dc.send(JSON.stringify({ type: 'hello', from: peerId, color: myColor }));
      logger.success(`Connected to ${remotePeerId}`);
    };
    dc.onclose = () => {
      edgesRef.current = edgesRef.current.filter(e => e.a !== remotePeerId && e.b !== remotePeerId);
      nodesRef.current.delete(remotePeerId);
    };
    dc.onmessage = ev => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'hello') {
        const [x, y] = hashToPos(msg.from);
        nodesRef.current.set(msg.from, { id: msg.from, x, y, color: msg.color ?? COLORS[0] });
        addEdge(peerId, msg.from);
        logger.info(`${msg.from} joined`);
      }
    };
  }, [peerId, myColor]);

  const createPc = useCallback((remotePeerId: string) => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    peerConnections.current.set(remotePeerId, pc);
    pc.onicecandidate = ev => { if (ev.candidate) sendRef.current({ type: 'ice-candidate', from: peerId, to: remotePeerId, candidate: ev.candidate.toJSON() }); };
    pc.ondatachannel = ev => setupDc(ev.channel, remotePeerId);
    return pc;
  }, [peerId, setupDc]);

  const { connect, join, send } = useSignaling({
    logger,
    onMessage: useCallback(async (msg: SignalingMessage) => {
      switch (msg.type) {
        case 'peer-list': {
          for (const peer of msg.peers) {
            const pc = createPc(peer.peerId);
            const dc = pc.createDataChannel('graph');
            setupDc(dc, peer.peerId);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendRef.current({ type: 'offer', from: peerId, to: peer.peerId, sdp: offer });
          }
          break;
        }
        case 'offer': {
          const pc = createPc(msg.from);
          await pc.setRemoteDescription(msg.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendRef.current({ type: 'answer', from: peerId, to: msg.from, sdp: answer });
          break;
        }
        case 'answer': await peerConnections.current.get(msg.from)?.setRemoteDescription(msg.sdp); break;
        case 'ice-candidate': await peerConnections.current.get(msg.from)?.addIceCandidate(msg.candidate).catch(console.warn); break;
      }
    }, [createPc, setupDc, peerId]),
  });
  sendRef.current = send;

  const handleJoin = () => {
    const [x, y] = hashToPos(peerId);
    nodesRef.current.set(peerId, { id: peerId, x, y, color: myColor });
    connect();
    setTimeout(() => { join(roomId, peerId); setJoined(true); }, 500);
    logger.success(`Joined as ${peerId}`);
  };

  // Spawn packets periodically
  useEffect(() => {
    if (!joined) return;
    const t = setInterval(() => {
      edgesRef.current.forEach((_, i) => {
        packetsRef.current.push({ id: ++pktId, edgeIdx: i, t: 0, dir: Math.random() > 0.5 ? 1 : -1 });
      });
    }, 1500);
    return () => clearInterval(t);
  }, [joined]);

  const drawLoop = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) { rafRef.current = requestAnimationFrame(drawLoop); return; }
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, W, H);

    const nodes = nodesRef.current;
    const edges = edgesRef.current;

    // Draw edges
    ctx.lineWidth = 1.5;
    for (const edge of edges) {
      const a = nodes.get(edge.a), b = nodes.get(edge.b);
      if (!a || !b) continue;
      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, a.color + '60');
      grad.addColorStop(1, b.color + '60');
      ctx.strokeStyle = grad;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // Update and draw packets
    packetsRef.current = packetsRef.current.filter(p => {
      const edge = edges[p.edgeIdx];
      if (!edge) return false;
      const a = nodes.get(edge.a), b = nodes.get(edge.b);
      if (!a || !b) return false;
      p.t += 0.012;
      if (p.t > 1) return false;
      const t = p.dir === 1 ? p.t : 1 - p.t;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2); ctx.fill();
      return true;
    });

    // Draw nodes
    for (const node of nodes.values()) {
      // Glow
      const grd = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, 30);
      grd.addColorStop(0, node.color + '40');
      grd.addColorStop(1, node.color + '00');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(node.x, node.y, 30, 0, Math.PI*2); ctx.fill();
      // Node
      ctx.fillStyle = node.color;
      ctx.beginPath(); ctx.arc(node.x, node.y, 12, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(node.x, node.y, 12, 0, Math.PI*2); ctx.stroke();
      // Label
      ctx.fillStyle = 'white';
      ctx.font = 'bold 10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(node.id.slice(0,6), node.x, node.y + 26);
      // "You" label
      if (node.id === peerId) {
        ctx.fillStyle = node.color;
        ctx.font = 'bold 9px monospace';
        ctx.fillText('YOU', node.x, node.y + 37);
      }
    }
    rafRef.current = requestAnimationFrame(drawLoop);
  }, [peerId]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(drawLoop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawLoop]);

  const handleLeave = () => {
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear(); dataChannels.current.clear();
    nodesRef.current.clear(); edgesRef.current = []; packetsRef.current = [];
    setJoined(false);
  };

  return (
    <DemoLayout
      title="Live Network Graph"
      difficulty="intermediate"
      description="Watch your WebRTC peer-to-peer topology emerge as a live graph with animated data packets flying between nodes."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            When peers join the same room, each new connection broadcasts a{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">hello</code> message over its
            DataChannel. Each peer maintains a local map of nodes and edges, drawn to a canvas in
            real time. Node positions are derived deterministically from the peerId using a simple
            hash — so the same peer always appears at the same location across tabs.
          </p>
          <p>
            Animated "data packets" (white dots) travel along edges every 1.5 seconds, visualizing
            the flow of DataChannel messages through the mesh. This is exactly the topology a{' '}
            <strong>full-mesh WebRTC network</strong> creates — O(n²) connections.
          </p>
        </div>
      }
      hints={[
        'Open 3–4 tabs with the same room code to see the mesh grow',
        'Each node glows in a unique color derived from its peer ID',
        'White dots = simulated DataChannel "packets" flowing between peers',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <input value={roomId} onChange={e => setRoomId(e.target.value)} disabled={joined}
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono w-32 focus:outline-none disabled:opacity-50" />
            {!joined ? (
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">Join Room</button>
            ) : (
              <button onClick={handleLeave} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">Leave</button>
            )}
            {joined && <span className="text-xs text-zinc-500">You: <span className="font-mono" style={{ color: myColor }}>{peerId}</span></span>}
          </div>
          <canvas ref={canvasRef} width={W} height={H}
            className="rounded-xl border border-zinc-800 w-full max-w-2xl block"
            style={{ background: '#09090b' }} />
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Peer topology graph with animated packet simulation' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
        { label: 'CanvasRenderingContext2D', href: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D' },
      ]}
    />
  );
}
