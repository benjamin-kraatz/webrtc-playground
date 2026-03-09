import { useMemo, useRef, useState, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

interface Message { id: number; text: string; self: boolean; ts: number }
let msgId = 0;

const CODE = `// MASHUP: Video Call + Encrypted Chat on ONE RTCPeerConnection
// A single PeerConnection carries both media tracks AND a DataChannel

const pc = new RTCPeerConnection(config);

// Add video + audio tracks (Video Call)
const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
stream.getTracks().forEach(track => pc.addTrack(track, stream));

// Also create a text data channel (P2P Chat)
const dc = pc.createDataChannel('chat', { ordered: true });

// On offer side: negotiate once for both tracks + channel
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);

// On answer side:
pc.ontrack = ({ streams }) => { remoteVideo.srcObject = streams[0]; };
pc.ondatachannel = ({ channel }) => {
  channel.onmessage = ({ data }) => appendMessage(data);
};

// Now you have A/V + text chat on one connection!`;

export default function VideoCallChat() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [roomId, setRoomId] = useState('CALLCHAT01');
  const [joined, setJoined] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [muted, setMuted] = useState(false);
  const [videoOff, setVideoOff] = useState(false);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const dataChannels = useRef(new Map<string, RTCDataChannel>());
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const addMessage = (text: string, self: boolean) => {
    setMessages(m => [...m, { id: ++msgId, text, self, ts: Date.now() }].slice(-50));
  };

  const broadcast = (msg: object) => {
    const s = JSON.stringify(msg);
    dataChannels.current.forEach(dc => { if (dc.readyState === 'open') dc.send(s); });
  };

  const setupDc = useCallback((dc: RTCDataChannel, remotePeerId: string) => {
    dataChannels.current.set(remotePeerId, dc);
    dc.onopen = () => { logger.success(`Chat channel open with ${remotePeerId}`); };
    dc.onmessage = ev => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'chat') { addMessage(msg.text, false); }
    };
  }, []);

  const createPc = useCallback((remotePeerId: string) => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    peerConnections.current.set(remotePeerId, pc);
    pc.onicecandidate = ev => { if (ev.candidate) sendRef.current({ type: 'ice-candidate', from: peerId, to: remotePeerId, candidate: ev.candidate.toJSON() }); };
    pc.ondatachannel = ev => setupDc(ev.channel, remotePeerId);
    // Add local video/audio tracks
    localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current!));
    pc.ontrack = ev => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      setCallActive(true);
      logger.success(`Receiving video from ${remotePeerId}`);
    };
    pc.onconnectionstatechange = () => logger.info(`Connection: ${pc.connectionState}`);
    return pc;
  }, [peerId, setupDc]);

  const { connect, join, send } = useSignaling({
    logger,
    onMessage: useCallback(async (msg: SignalingMessage) => {
      switch (msg.type) {
        case 'peer-list': {
          for (const peer of msg.peers) {
            const pc = createPc(peer.peerId);
            const dc = pc.createDataChannel('chat', { ordered: true });
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

  const handleJoin = async () => {
    try {
      logger.info('Getting camera + mic...');
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) { localVideoRef.current.srcObject = stream; }
      connect();
      setTimeout(() => { join(roomId, peerId); setJoined(true); }, 500);
      logger.success(`Joined room ${roomId} — waiting for peer…`);
    } catch (e) { logger.error(`Camera/mic error: ${e}`); }
  };

  const sendMessage = () => {
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    addMessage(text, true);
    broadcast({ type: 'chat', text });
    setChatInput('');
    logger.info(`Sent: "${text}"`);
  };

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = muted; });
    setMuted(!muted);
    logger.info(muted ? 'Mic unmuted' : 'Mic muted');
  };

  const toggleVideo = () => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = videoOff; });
    setVideoOff(!videoOff);
    logger.info(videoOff ? 'Camera on' : 'Camera off');
  };

  const handleLeave = () => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    peerConnections.current.forEach(pc => pc.close());
    peerConnections.current.clear(); dataChannels.current.clear();
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    setJoined(false); setCallActive(false); setMessages([]);
  };

  return (
    <DemoLayout
      title="Video Call + Chat"
      difficulty="intermediate"
      description="MASHUP: Video Call + P2P Chat — one RTCPeerConnection carries both A/V tracks and a text DataChannel simultaneously."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            WebRTC's superpower: <strong>one peer connection can carry multiple media tracks AND
            data channels simultaneously</strong>. This mashup demonstrates exactly that — a
            single <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">RTCPeerConnection</code> handles
            video + audio tracks (from <strong>Video Call</strong>) alongside an{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">RTCDataChannel</code> for
            text chat (from <strong>P2P Chat</strong>).
          </p>
          <p>
            No extra negotiation is needed — the data channel is created before the offer, so it's
            included in the SDP alongside the media tracks. This is exactly how every major video
            call app (Zoom, Meet, Teams) layers real-time reactions, polls, and chat
            over the same WebRTC connection.
          </p>
          <p className="text-amber-400/80">⚡ Requires signaling server. Open two tabs with the same room code.</p>
        </div>
      }
      hints={[
        'Open two tabs — one tab sees the other\'s video immediately',
        'Type in the chat while on the call — both run over the same connection',
        'Notice a single RTCPeerConnection carries everything',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <input value={roomId} onChange={e => setRoomId(e.target.value)} disabled={joined}
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono w-36 focus:outline-none disabled:opacity-50" />
            {!joined ? (
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">📹 Join Call</button>
            ) : (
              <button onClick={handleLeave} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg">Leave</button>
            )}
            {joined && (
              <>
                <button onClick={toggleMute} className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${muted ? 'border-rose-500 bg-rose-950/40 text-rose-300' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}>
                  {muted ? '🔇 Muted' : '🎤 Mic On'}
                </button>
                <button onClick={toggleVideo} className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${videoOff ? 'border-rose-500 bg-rose-950/40 text-rose-300' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}>
                  {videoOff ? '📵 Video Off' : '📹 Video On'}
                </button>
              </>
            )}
          </div>

          {joined && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Videos */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-xs text-zinc-500 mb-1">You</p>
                    <video ref={localVideoRef} muted autoPlay playsInline className="rounded-xl border border-zinc-800 w-full" style={{ aspectRatio: '4/3', background: '#000', transform: 'scaleX(-1)' }} />
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500 mb-1">Peer {callActive ? '🔴 Live' : '(waiting…)'}</p>
                    <video ref={remoteVideoRef} autoPlay playsInline className="rounded-xl border border-zinc-800 w-full" style={{ aspectRatio: '4/3', background: '#111' }} />
                  </div>
                </div>
              </div>

              {/* Chat */}
              <div className="flex flex-col gap-2">
                <p className="text-xs text-zinc-500">Live Chat (same connection)</p>
                <div className="flex-1 bg-surface-0 border border-zinc-800 rounded-xl p-3 overflow-y-auto space-y-1.5" style={{ height: 160 }}>
                  {messages.length === 0 && <p className="text-zinc-700 text-xs">Messages appear here…</p>}
                  {messages.map(m => (
                    <div key={m.id} className={`flex ${m.self ? 'justify-end' : 'justify-start'}`}>
                      <span className={`max-w-xs text-xs px-3 py-1.5 rounded-2xl ${m.self ? 'bg-blue-600 text-white' : 'bg-surface-2 text-zinc-200'}`}>{m.text}</span>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendMessage()}
                    placeholder="Type a message…"
                    className="flex-1 bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500" />
                  <button onClick={sendMessage} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg">Send</button>
                </div>
              </div>
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Video Call + DataChannel on a single RTCPeerConnection' }}
      mdnLinks={[
        { label: 'RTCPeerConnection', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
