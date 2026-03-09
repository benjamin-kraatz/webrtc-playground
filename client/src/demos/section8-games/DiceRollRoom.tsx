import { useMemo, useRef, useState, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

const FACES = [
  // Each face: array of [cx%, cy%] dot positions
  [],                                        // 0 (unused)
  [[50,50]],                                 // 1
  [[25,25],[75,75]],                         // 2
  [[25,25],[50,50],[75,75]],                 // 3
  [[25,25],[75,25],[25,75],[75,75]],         // 4
  [[25,25],[75,25],[50,50],[25,75],[75,75]], // 5
  [[25,25],[75,25],[25,50],[75,50],[25,75],[75,75]], // 6
];

function DiceFace({ value, size = 80, highlight = false }: { value: number; size?: number; highlight?: boolean }) {
  const dots = FACES[value] ?? FACES[1];
  return (
    <svg width={size} height={size} viewBox="0 0 100 100">
      <rect x="4" y="4" width="92" height="92" rx="16"
        fill={highlight ? '#1e3a8a' : '#1e293b'}
        stroke={highlight ? '#60a5fa' : '#475569'}
        strokeWidth="3" />
      {dots.map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="9"
          fill={highlight ? '#60a5fa' : '#cbd5e1'} />
      ))}
    </svg>
  );
}

interface Roll { id: number; dice: number[]; total: number; from: string; ts: number }
let rollId = 0;

const CODE = `// Dice roll room — synced results over DataChannel
function rollDice(count) {
  return Array.from({ length: count }, () => Math.ceil(Math.random() * 6));
}

// Roll locally and broadcast
button.onclick = () => {
  const dice = rollDice(numDice);
  const total = dice.reduce((a, b) => a + b, 0);
  dc.send(JSON.stringify({ type: 'roll', dice, total, from: peerId }));
  displayRoll(dice, total);
};

// Receive from peers
dc.onmessage = ({ data }) => {
  const { dice, total, from } = JSON.parse(data);
  displayRoll(dice, total, from);
};`;

export default function DiceRollRoom() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [roomId, setRoomId] = useState('DICE01');
  const [joined, setJoined] = useState(false);
  const [numDice, setNumDice] = useState(2);
  const [currentRoll, setCurrentRoll] = useState<number[]>([]);
  const [rolling, setRolling] = useState(false);
  const [history, setHistory] = useState<Roll[]>([]);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const dataChannels = useRef(new Map<string, RTCDataChannel>());
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const broadcast = (msg: object) => {
    const s = JSON.stringify(msg);
    dataChannels.current.forEach((dc) => { if (dc.readyState === 'open') dc.send(s); });
  };

  const setupDc = useCallback((dc: RTCDataChannel, remotePeerId: string) => {
    dataChannels.current.set(remotePeerId, dc);
    dc.onopen = () => logger.success(`Dice channel open with ${remotePeerId}`);
    dc.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'roll') {
        setHistory((h) => [{ id: ++rollId, dice: msg.dice, total: msg.total, from: msg.from, ts: Date.now() }, ...h].slice(0, 30));
        logger.info(`${msg.from} rolled ${msg.dice.join(',')} = ${msg.total}`);
      }
    };
  }, []);

  const createPc = useCallback((remotePeerId: string) => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    peerConnections.current.set(remotePeerId, pc);
    pc.onicecandidate = (ev) => { if (ev.candidate) sendRef.current({ type: 'ice-candidate', from: peerId, to: remotePeerId, candidate: ev.candidate.toJSON() }); };
    pc.ondatachannel = (ev) => setupDc(ev.channel, remotePeerId);
    return pc;
  }, [peerId, setupDc]);

  const { connect, join, send } = useSignaling({
    logger,
    onMessage: useCallback(async (msg: SignalingMessage) => {
      switch (msg.type) {
        case 'peer-list': {
          for (const peer of msg.peers) {
            const pc = createPc(peer.peerId);
            const dc = pc.createDataChannel('dice');
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
    connect();
    setTimeout(() => { join(roomId, peerId); setJoined(true); }, 500);
    logger.success(`Joined dice room ${roomId}`);
  };

  const handleRoll = async () => {
    setRolling(true);
    // Animate for 600ms
    let frames = 0;
    const anim = setInterval(() => {
      setCurrentRoll(Array.from({ length: numDice }, () => Math.ceil(Math.random() * 6)));
      if (++frames > 6) clearInterval(anim);
    }, 80);

    await new Promise((r) => setTimeout(r, 600));
    clearInterval(anim);
    const final = Array.from({ length: numDice }, () => Math.ceil(Math.random() * 6));
    setCurrentRoll(final);
    const total = final.reduce((a, b) => a + b, 0);
    setHistory((h) => [{ id: ++rollId, dice: final, total, from: `${peerId} (you)`, ts: Date.now() }, ...h].slice(0, 30));
    broadcast({ type: 'roll', dice: final, total, from: peerId });
    logger.success(`Rolled: [${final.join(', ')}] = ${total}`);
    setRolling(false);
  };

  const handleLeave = () => {
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    dataChannels.current.clear();
    setJoined(false);
    setCurrentRoll([]);
    setHistory([]);
  };

  return (
    <DemoLayout
      title="Dice Roll Room"
      difficulty="beginner"
      description="Roll dice together — every roll is broadcast to all peers in the room via RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            A shared dice room for tabletop games, board game nights, or any situation where
            everyone needs to see the same roll. Each peer rolls independently (no server
            involved in the RNG!) and broadcasts the result as a JSON message over{' '}
            <strong>RTCDataChannel</strong>.
          </p>
          <p>
            The rolling animation uses repeated{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">Math.random()</code> calls
            to scramble the display, settling on a final value after 600 ms. The SVG dice faces
            are rendered inline — no images needed.
          </p>
          <p className="text-amber-400/80">⚡ Open multiple tabs with the same room code for a shared dice experience!</p>
        </div>
      }
      hints={[
        'Open two tabs with the same room code — rolls appear instantly in both',
        'Use 4 dice for a D&D-style roll',
        'The roll history shows who rolled what and when',
      ]}
      demo={
        <div className="space-y-6">
          <div className="flex flex-wrap gap-3 items-center">
            <input value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={joined}
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono w-28 focus:outline-none disabled:opacity-50" />
            {!joined ? (
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">Join Room</button>
            ) : (
              <button onClick={handleLeave} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">Leave</button>
            )}
          </div>

          {/* Dice display */}
          <div className="space-y-4">
            <div className="flex flex-wrap gap-3 items-center justify-center min-h-24 bg-surface-0 border border-zinc-800 rounded-xl p-4">
              {currentRoll.length === 0 ? (
                <p className="text-zinc-600 text-sm">Your last roll appears here</p>
              ) : (
                currentRoll.map((v, i) => (
                  <div key={i} className={rolling ? 'animate-pulse' : ''}>
                    <DiceFace value={v} size={72} highlight />
                  </div>
                ))
              )}
            </div>
            {currentRoll.length > 0 && !rolling && (
              <p className="text-center text-2xl font-bold font-mono text-blue-400">
                Total: {currentRoll.reduce((a, b) => a + b, 0)}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3 items-center justify-center">
            <label className="flex items-center gap-2 text-xs text-zinc-400">
              Dice:
              {[1,2,3,4,5,6].map((n) => (
                <button key={n} onClick={() => setNumDice(n)}
                  className={`w-8 h-8 rounded-lg border text-xs font-bold transition-colors ${numDice === n ? 'border-blue-500 bg-blue-950/40 text-blue-300' : 'border-zinc-800 text-zinc-500 hover:border-zinc-600'}`}>
                  {n}
                </button>
              ))}
            </label>
            <button onClick={handleRoll} disabled={rolling}
              className="px-6 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white font-bold text-sm rounded-xl transition-all hover:scale-105 active:scale-95">
              {rolling ? '🎲 Rolling…' : '🎲 Roll!'}
            </button>
          </div>

          {/* Roll history */}
          {history.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              <p className="text-xs text-zinc-500 font-semibold">Roll History</p>
              {history.map((r) => (
                <div key={r.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-zinc-900">
                  <div className="flex gap-1">
                    {r.dice.map((v, i) => <DiceFace key={i} value={v} size={28} />)}
                  </div>
                  <span className="font-bold text-zinc-300 font-mono">= {r.total}</span>
                  <span className="text-zinc-600 ml-auto">{r.from} · {new Date(r.ts).toLocaleTimeString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Dice roll broadcast via RTCDataChannel' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
        { label: 'Math.random()', href: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random' },
      ]}
    />
  );
}
