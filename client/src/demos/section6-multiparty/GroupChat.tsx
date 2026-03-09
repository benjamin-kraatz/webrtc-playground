import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

interface ChatMessage {
  id: number;
  from: string;
  text: string;
  ts: number;
}

let msgId = 0;

const CODE = `// Group chat via mesh data channels
// Each peer connects to all others with a data channel
const dc = pc.createDataChannel('chat');
dc.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  displayMessage(msg);
};

function broadcast(text) {
  dataChannels.forEach(dc => dc.send(JSON.stringify({ from, text })));
}`;

export default function GroupChat() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [roomId, setRoomId] = useState('CHAT01');
  const [joined, setJoined] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const dataChannels = useRef(new Map<string, RTCDataChannel>());
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const addMessage = (from: string, text: string) => {
    setMessages((m) => [...m, { id: ++msgId, from, text, ts: Date.now() }]);
  };

  const setupDc = (dc: RTCDataChannel, remotePeerId: string) => {
    dataChannels.current.set(remotePeerId, dc);
    dc.onopen = () => logger.success(`Chat channel open with ${remotePeerId}`);
    dc.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      addMessage(msg.from, msg.text);
    };
    dc.onclose = () => {
      dataChannels.current.delete(remotePeerId);
      logger.info(`Channel with ${remotePeerId} closed`);
    };
  };

  const createPc = useCallback((remotePeerId: string, sendFn: (msg: import('@/types/signaling').SignalingMessage) => void) => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    peerConnections.current.set(remotePeerId, pc);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) sendFn({ type: 'ice-candidate', from: peerId, to: remotePeerId, candidate: ev.candidate.toJSON() });
    };
    pc.ondatachannel = (ev) => setupDc(ev.channel, remotePeerId);
    return pc;
  }, [peerId]);

  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const { status, connect, join, send } = useSignaling({
    logger,
    onMessage: useCallback(async (msg: import('@/types/signaling').SignalingMessage) => {
      switch (msg.type) {
        case 'peer-list': {
          for (const peer of msg.peers) {
            const pc = createPc(peer.peerId, sendRef.current);
            const dc = pc.createDataChannel('chat', { ordered: true });
            setupDc(dc, peer.peerId);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendRef.current({ type: 'offer', from: peerId, to: peer.peerId, sdp: offer });
          }
          break;
        }
        case 'offer': {
          const pc = createPc(msg.from, sendRef.current);
          await pc.setRemoteDescription(msg.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendRef.current({ type: 'answer', from: peerId, to: msg.from, sdp: answer });
          break;
        }
        case 'answer': {
          const pc = peerConnections.current.get(msg.from);
          if (pc) await pc.setRemoteDescription(msg.sdp);
          break;
        }
        case 'ice-candidate': {
          const pc = peerConnections.current.get(msg.from);
          if (pc) await pc.addIceCandidate(msg.candidate).catch(console.warn);
          break;
        }
        case 'peer-left': {
          peerConnections.current.get(msg.peerId)?.close();
          peerConnections.current.delete(msg.peerId);
          dataChannels.current.delete(msg.peerId);
          addMessage('system', `${msg.peerId} left`);
          break;
        }
      }
    }, [createPc, peerId]),
  });
  sendRef.current = send;

  const handleJoin = () => {
    connect();
    setTimeout(() => { join(roomId, peerId); setJoined(true); addMessage('system', `You joined as ${peerId}`); }, 500);
  };

  const handleLeave = () => {
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    dataChannels.current.clear();
    setJoined(false);
    setMessages([]);
  };

  const handleSend = () => {
    if (!input.trim()) return;
    const text = input.trim();
    setInput('');
    addMessage(peerId, text);
    dataChannels.current.forEach((dc) => {
      if (dc.readyState === 'open') {
        dc.send(JSON.stringify({ from: peerId, text }));
      }
    });
  };

  return (
    <DemoLayout
      title="Group Chat"
      difficulty="advanced"
      description="Multi-peer text chat over RTCDataChannels — no server relay for messages."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            A group chat built on a mesh of RTCDataChannels. Each peer connects to every other peer,
            and messages are sent directly — the signaling server is only used for connection setup.
          </p>
          <p className="text-amber-400/80">⚡ Requires signaling server. Open multiple tabs with the same room code.</p>
        </div>
      }
      demo={
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">Signaling: <span className={status === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{status}</span></span>
            <span className="text-xs font-mono text-zinc-500">You: <span className="text-zinc-300">{peerId}</span></span>
          </div>

          <div className="flex gap-2">
            <input value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={joined}
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-zinc-200 w-28 focus:outline-none disabled:opacity-50" />
            {!joined ? (
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">Join</button>
            ) : (
              <button onClick={handleLeave} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">Leave</button>
            )}
          </div>

          <div className="h-64 bg-surface-0 border border-zinc-800 rounded-lg p-3 overflow-y-auto space-y-2">
            {messages.map((m) => (
              <div key={m.id} className={`flex gap-2 ${m.from === peerId ? 'justify-end' : m.from === 'system' ? 'justify-center' : 'justify-start'}`}>
                {m.from === 'system' ? (
                  <span className="text-xs text-zinc-600 italic">{m.text}</span>
                ) : (
                  <div className={`max-w-xs ${m.from === peerId ? 'text-right' : ''}`}>
                    <p className="text-[10px] text-zinc-500 mb-0.5 font-mono">{m.from}</p>
                    <span className={`inline-block text-sm px-3 py-1.5 rounded-2xl ${m.from === peerId ? 'bg-blue-600 text-white' : 'bg-surface-2 text-zinc-200'}`}>
                      {m.text}
                    </span>
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="flex gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              disabled={!joined}
              placeholder="Type a message..."
              className="flex-1 bg-surface-0 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-blue-500 disabled:opacity-50" />
            <button onClick={handleSend} disabled={!joined || !input.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              Send
            </button>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Mesh group chat' }}
      mdnLinks={[{ label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' }]}
    />
  );
}
