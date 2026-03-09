import { useMemo, useRef, useState, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

const CURSOR_COLORS = ['#60a5fa','#f87171','#34d399','#fbbf24','#a78bfa','#fb923c','#38bdf8','#f472b6'];

interface CursorState {
  x: number;
  y: number;
  label: string;
  color: string;
  text: string;
  ts: number;
}

const CODE = `// Shared cursor sync via RTCDataChannel
const THROTTLE_MS = 40; // ~25 Hz
let lastSent = 0;

area.addEventListener('mousemove', (e) => {
  const now = Date.now();
  if (now - lastSent < THROTTLE_MS) return;
  lastSent = now;

  const rect = area.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;  // normalize 0-1
  const y = (e.clientY - rect.top) / rect.height;

  dc.send(JSON.stringify({ type: 'cursor', x, y, label: myName }));
});

// Each peer renders all received cursors
dc.onmessage = ({ data }) => {
  const { peerId, x, y, label, text } = JSON.parse(data);
  cursors.set(peerId, { x, y, label, text });
  renderCursors();
};`;

export default function SharedCursors() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const myColor = useMemo(() => CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)], []);
  const [roomId, setRoomId] = useState('CURSORS01');
  const [myName, setMyName] = useState(`User-${peerId.slice(0, 4)}`);
  const [joined, setJoined] = useState(false);
  const [cursors, setCursors] = useState<Map<string, CursorState>>(new Map());
  const [myText, setMyText] = useState('');
  const areaRef = useRef<HTMLDivElement>(null);
  const lastSentRef = useRef(0);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const dataChannels = useRef(new Map<string, RTCDataChannel>());
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});
  const nameRef = useRef(myName);
  const textRef = useRef(myText);
  nameRef.current = myName;
  textRef.current = myText;

  const broadcast = (msg: object) => {
    const s = JSON.stringify(msg);
    dataChannels.current.forEach((dc) => { if (dc.readyState === 'open') dc.send(s); });
  };

  const setupDc = useCallback((dc: RTCDataChannel, remotePeerId: string) => {
    dataChannels.current.set(remotePeerId, dc);
    dc.onopen = () => {
      logger.success(`Cursor channel open with ${remotePeerId}`);
      broadcast({ type: 'meta', from: peerId, label: nameRef.current, color: myColor });
    };
    dc.onclose = () => {
      setCursors((prev) => { const next = new Map(prev); next.delete(remotePeerId); return next; });
    };
    dc.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'cursor' || msg.type === 'meta') {
        setCursors((prev) => {
          const next = new Map(prev);
          const existing = prev.get(msg.from) ?? { x: 0.5, y: 0.5, label: msg.from, color: CURSOR_COLORS[0], text: '', ts: 0 };
          next.set(msg.from, {
            ...existing,
            x: msg.x ?? existing.x,
            y: msg.y ?? existing.y,
            label: msg.label ?? existing.label,
            color: msg.color ?? existing.color,
            text: msg.text ?? existing.text,
            ts: Date.now(),
          });
          return next;
        });
      }
    };
  }, [peerId, myColor]);

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
            const dc = pc.createDataChannel('cursors');
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
    logger.success(`Joined cursor room ${roomId} as "${myName}"`);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!joined) return;
    const now = Date.now();
    if (now - lastSentRef.current < 40) return;
    lastSentRef.current = now;
    const rect = areaRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    broadcast({ type: 'cursor', from: peerId, x, y, label: nameRef.current, color: myColor, text: textRef.current });
  };

  const handleTextChange = (text: string) => {
    setMyText(text);
    broadcast({ type: 'cursor', from: peerId, label: nameRef.current, color: myColor, text });
  };

  const handleLeave = () => {
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    dataChannels.current.clear();
    setCursors(new Map());
    setJoined(false);
  };

  const cursorList = Array.from(cursors.entries());

  return (
    <DemoLayout
      title="Shared Cursors"
      difficulty="beginner"
      description="See everyone's mouse cursor in real time — position and text broadcast over RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Every <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">mousemove</code> event
            is throttled to ~25 Hz and normalized to 0–1 coordinates, then broadcast over a{' '}
            <strong>RTCDataChannel</strong>. Each peer renders all received cursor positions as
            colored SVG arrows with name labels — exactly how Figma, Miro, and
            Notion's multiplayer mode works.
          </p>
          <p>
            The "typing" field lets you broadcast what you're currently writing — a lightweight
            awareness indicator showing that someone is typing, without sending every keystroke.
            Cursors fade out when a peer disconnects via the{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">dc.onclose</code> event.
          </p>
          <p className="text-amber-400/80">⚡ Open multiple tabs with the same room code for the full effect!</p>
        </div>
      }
      hints={[
        'Open two or more tabs with the same room code',
        'Move your mouse in the area below — other tabs see it move instantly',
        'Type in the text field to show a "typing…" indicator on all peers',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <input value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={joined}
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono w-32 focus:outline-none disabled:opacity-50" />
            <input value={myName} onChange={(e) => setMyName(e.target.value)} disabled={joined}
              placeholder="Your name"
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm w-32 focus:outline-none disabled:opacity-50" />
            <div className="w-5 h-5 rounded-full" style={{ backgroundColor: myColor }} title="Your cursor color" />
            {!joined ? (
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">Join Room</button>
            ) : (
              <button onClick={handleLeave} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">Leave</button>
            )}
          </div>

          {joined && (
            <input
              value={myText}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder="Type something — peers see it next to your cursor…"
              className="w-full bg-surface-0 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          )}

          {/* Cursor playground */}
          <div
            ref={areaRef}
            className="relative bg-zinc-950 border border-zinc-800 rounded-2xl overflow-hidden cursor-none select-none"
            style={{ height: 320 }}
            onMouseMove={handleMouseMove}
          >
            {!joined ? (
              <div className="absolute inset-0 flex items-center justify-center text-zinc-700 text-sm">
                Join a room to see live cursors
              </div>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-zinc-800 text-xs select-none pointer-events-none">
                Move your mouse here · {cursorList.length} peer{cursorList.length !== 1 ? 's' : ''} connected
              </div>
            )}

            {/* Render remote cursors */}
            {cursorList.map(([id, cur]) => (
              <div
                key={id}
                className="absolute pointer-events-none transition-all duration-75"
                style={{ left: `${cur.x * 100}%`, top: `${cur.y * 100}%`, transform: 'translate(-2px,-2px)' }}
              >
                {/* Cursor arrow SVG */}
                <svg width="20" height="24" viewBox="0 0 20 24" style={{ filter: `drop-shadow(0 1px 3px ${cur.color}99)` }}>
                  <path d="M0 0 L0 18 L5 14 L9 22 L11 21 L7 13 L14 13 Z" fill={cur.color} stroke="white" strokeWidth="1" />
                </svg>
                <div
                  className="absolute top-5 left-4 whitespace-nowrap text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: cur.color, color: '#fff', fontSize: 10 }}
                >
                  {cur.label}
                  {cur.text && <span className="ml-1 opacity-80">· {cur.text.slice(0, 30)}{cur.text.length > 30 ? '…' : ''}</span>}
                </div>
              </div>
            ))}
          </div>

          <div className="text-xs text-zinc-600">
            Room: <span className="text-zinc-400">{roomId}</span> ·
            Your ID: <span className="text-zinc-400 font-mono">{peerId}</span> ·
            Peers: <span className="text-zinc-400">{cursorList.length}</span>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Mouse position broadcast via throttled DataChannel' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
        { label: 'mousemove event', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Element/mousemove_event' },
      ]}
    />
  );
}
