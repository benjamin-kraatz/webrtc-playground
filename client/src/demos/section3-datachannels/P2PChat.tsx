import { useMemo, useRef, useState, useEffect } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

interface Message {
  id: number;
  text: string;
  self: boolean;
  ts: number;
}

const CODE = `// Sender side — create data channel before offer
const dc = pc.createDataChannel('chat', { ordered: true });
dc.onopen = () => console.log('Channel open!');

// Receiver side — listen for ondatachannel
pc.ondatachannel = (event) => {
  const channel = event.channel;
  channel.onmessage = (ev) => {
    console.log('Received:', ev.data); // string, ArrayBuffer, or Blob
  };
};

// Send a message
dc.send(JSON.stringify({ type: 'chat', text: 'Hello!' }));`;

let msgId = 0;

export default function P2PChat() {
  const logger = useMemo(() => new Logger(), []);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [channelState, setChannelState] = useState<string>('closed');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [localSdp, setLocalSdp] = useState('');
  const [remoteSdpInput, setRemoteSdpInput] = useState('');
  const [role, setRole] = useState<'offer' | 'answer' | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addMessage = (text: string, self: boolean) => {
    setMessages((m) => [...m, { id: ++msgId, text, self, ts: Date.now() }]);
  };

  const setupDc = (dc: RTCDataChannel) => {
    dcRef.current = dc;
    dc.onopen = () => { setChannelState('open'); logger.success('Data channel open — ready to chat!'); };
    dc.onclose = () => { setChannelState('closed'); logger.info('Data channel closed'); };
    dc.onmessage = (ev) => { addMessage(ev.data as string, false); };
  };

  const gatherComplete = (pc: RTCPeerConnection): Promise<string> =>
    new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(pc.localDescription!.sdp); return; }
      const check = () => {
        if (pc.iceGatheringState === 'complete') { resolve(pc.localDescription!.sdp); pc.removeEventListener('icegatheringstatechange', check); }
      };
      pc.addEventListener('icegatheringstatechange', check);
    });

  const startOffer = async () => {
    setRole('offer');
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcRef.current = pc;
    pc.onconnectionstatechange = () => { setConnectionState(pc.connectionState); logger.info(`connectionState → ${pc.connectionState}`); };
    const dc = pc.createDataChannel('chat', { ordered: true });
    setupDc(dc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    logger.info('Gathering ICE...');
    const sdp = await gatherComplete(pc);
    setLocalSdp(sdp);
    logger.success('Offer ready — copy to Tab 2');
  };

  const startAnswer = async () => {
    setRole('answer');
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcRef.current = pc;
    pc.onconnectionstatechange = () => { setConnectionState(pc.connectionState); logger.info(`connectionState → ${pc.connectionState}`); };
    pc.ondatachannel = (ev) => { setupDc(ev.channel); logger.success('Data channel received!'); };
    await pc.setRemoteDescription({ type: 'offer', sdp: remoteSdpInput });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    logger.info('Gathering ICE...');
    const sdp = await gatherComplete(pc);
    setLocalSdp(sdp);
    logger.success('Answer ready — copy back to Tab 1');
  };

  const applyAnswer = async () => {
    await pcRef.current!.setRemoteDescription({ type: 'answer', sdp: remoteSdpInput });
    logger.success('Answer applied! ICE negotiating...');
  };

  const send = () => {
    if (!input.trim() || dcRef.current?.readyState !== 'open') return;
    dcRef.current.send(input.trim());
    addMessage(input.trim(), true);
    setInput('');
  };

  const reset = () => {
    pcRef.current?.close();
    dcRef.current = null;
    setRole(null);
    setConnectionState('new');
    setChannelState('closed');
    setMessages([]);
    setLocalSdp('');
    setRemoteSdpInput('');
  };

  return (
    <DemoLayout
      title="P2P Chat"
      difficulty="intermediate"
      description="Send text messages directly between two browser tabs via an RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>RTCDataChannel</strong> is WebRTC's data transport — similar to WebSocket but
            peer-to-peer (no server in the message path). Messages can be strings or binary data.
          </p>
          <p>
            The channel is created by the <em>offerer</em> using
            <code className="mx-1 text-xs bg-surface-2 px-1 py-0.5 rounded">pc.createDataChannel()</code>,
            and the answerer receives it via
            <code className="mx-1 text-xs bg-surface-2 px-1 py-0.5 rounded">pc.ondatachannel</code>.
          </p>
        </div>
      }
      hints={['Open two tabs', 'Tab 1 is the Offerer, Tab 2 the Answerer', 'Copy-paste SDP between tabs to connect']}
      demo={
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <ConnectionStatus state={connectionState} />
            <span className="text-xs px-2 py-1 rounded bg-surface-2 text-zinc-400">
              channel: {channelState}
            </span>
          </div>

          {role === null && (
            <div className="flex flex-col gap-3">
              <button onClick={startOffer} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg w-fit">
                Start as Offerer (Tab 1)
              </button>
              <div>
                <p className="text-xs text-zinc-500 mb-1">Paste offer SDP from Tab 1:</p>
                <textarea value={remoteSdpInput} onChange={(e) => setRemoteSdpInput(e.target.value)}
                  className="w-full h-20 bg-surface-0 border border-zinc-700 rounded-lg p-2 text-xs font-mono text-zinc-300 resize-none focus:outline-none focus:border-blue-500" />
                <button onClick={startAnswer} disabled={!remoteSdpInput.trim()}
                  className="mt-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg w-full">
                  Start as Answerer (Tab 2)
                </button>
              </div>
            </div>
          )}

          {role === 'offer' && localSdp && (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-zinc-500 mb-1">Copy this offer → Tab 2:</p>
                <textarea value={localSdp} readOnly
                  className="w-full h-20 bg-surface-0 border border-zinc-700 rounded-lg p-2 text-xs font-mono text-zinc-300 resize-none"
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()} />
              </div>
              {connectionState !== 'connected' && (
                <div>
                  <p className="text-xs text-zinc-500 mb-1">Paste answer from Tab 2:</p>
                  <textarea value={remoteSdpInput} onChange={(e) => setRemoteSdpInput(e.target.value)}
                    className="w-full h-16 bg-surface-0 border border-zinc-700 rounded-lg p-2 text-xs font-mono text-zinc-300 resize-none focus:outline-none focus:border-blue-500" />
                  <button onClick={applyAnswer} disabled={!remoteSdpInput.trim()}
                    className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                    Apply Answer
                  </button>
                </div>
              )}
            </div>
          )}

          {role === 'answer' && localSdp && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">Copy this answer → Tab 1:</p>
              <textarea value={localSdp} readOnly
                className="w-full h-20 bg-surface-0 border border-zinc-700 rounded-lg p-2 text-xs font-mono text-zinc-300 resize-none"
                onClick={(e) => (e.target as HTMLTextAreaElement).select()} />
            </div>
          )}

          {/* Chat UI */}
          {channelState === 'open' && (
            <div className="space-y-3">
              <div className="h-48 bg-surface-0 border border-zinc-800 rounded-lg p-3 overflow-y-auto space-y-2">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.self ? 'justify-end' : 'justify-start'}`}>
                    <span className={`max-w-xs text-sm px-3 py-1.5 rounded-2xl ${
                      m.self ? 'bg-blue-600 text-white' : 'bg-surface-2 text-zinc-200'
                    }`}>{m.text}</span>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <div className="flex gap-2">
                <input
                  value={input} onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder="Type a message..."
                  className="flex-1 bg-surface-0 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-300 focus:outline-none focus:border-blue-500"
                />
                <button onClick={send} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">Send</button>
              </div>
            </div>
          )}

          {role && (
            <button onClick={reset} className="text-xs text-zinc-500 hover:text-zinc-300">Reset</button>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'RTCDataChannel setup' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
