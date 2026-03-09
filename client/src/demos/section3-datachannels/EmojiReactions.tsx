import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useLoopback } from '@/hooks/useLoopback';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

interface Reaction {
  id: number;
  emoji: string;
  x: number;
  self: boolean;
}

const EMOJIS = ['🎉', '❤️', '😂', '👍', '🔥', '🚀', '😮', '👏', '🎊', '💯'];

const CODE = `// Peer A creates the data channel
const dc = pc.createDataChannel('reactions', { ordered: true });

// Send an emoji reaction
function sendReaction(emoji) {
  dc.send(JSON.stringify({ type: 'reaction', emoji }));
  spawnLocalAnimation(emoji);
}

// Peer B receives it
pc.ondatachannel = (ev) => {
  ev.channel.onmessage = ({ data }) => {
    const { emoji } = JSON.parse(data);
    spawnFloatingAnimation(emoji); // CSS keyframe animation
  };
};`;

let reactionId = 0;

export default function EmojiReactions() {
  const logger = useMemo(() => new Logger(), []);
  const loopback = useLoopback(logger);
  const [connected, setConnected] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const pcBRef = useRef<RTCPeerConnection | null>(null);

  const spawnReaction = (emoji: string, self: boolean) => {
    const id = ++reactionId;
    const x = 5 + Math.random() * 82;
    setReactions((prev) => [...prev, { id, emoji, x, self }]);
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.id !== id)), 2800);
  };

  const connect = async () => {
    logger.info('Setting up loopback connection...');
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcBRef.current = pcB;

    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);

    const dc = pcA.createDataChannel('reactions', { ordered: true });
    dcRef.current = dc;

    dc.onopen = () => {
      setConnected(true);
      logger.success('Data channel open — fire away! 🎉');
    };

    pcB.ondatachannel = (ev) => {
      ev.channel.onmessage = (e) => {
        const { emoji } = JSON.parse(e.data as string);
        spawnReaction(emoji, false);
        logger.info(`Peer B received: ${emoji}`);
      };
    };

    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  const send = (emoji: string) => {
    if (!dcRef.current || dcRef.current.readyState !== 'open') return;
    dcRef.current.send(JSON.stringify({ type: 'reaction', emoji }));
    spawnReaction(emoji, true);
    logger.info(`Peer A sent: ${emoji}`);
  };

  const reset = () => {
    dcRef.current?.close();
    setConnected(false);
    setReactions([]);
  };

  return (
    <DemoLayout
      title="Emoji Reaction Burst"
      difficulty="beginner"
      description="Send emoji reactions over a WebRTC DataChannel and watch them float up the screen in real time."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>RTCDataChannel</strong> can carry any data — strings, JSON, binary blobs — with
            the same low-latency peer-to-peer path that video and audio use. This demo
            encodes each reaction as a tiny JSON string and fires it through a loopback
            connection, simulating a real cross-tab send/receive.
          </p>
          <p>
            The animation uses a CSS <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">@keyframes floatUp</code> rule.
            Blue-glowing emojis are <em>sent</em> by Peer A; purple-glowing ones are <em>received</em> by Peer B.
            In a real application you'd swap the loopback for a cross-device connection — the
            DataChannel API is identical.
          </p>
        </div>
      }
      hints={[
        'Click Connect, then tap any emoji to fire a reaction',
        'Blue glow = sent by you  ·  Purple glow = received from peer',
        'Watch the log panel to see each message crossing the channel',
      ]}
      demo={
        <div className="space-y-4">
          {!connected ? (
            <button
              onClick={connect}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Connect Loopback
            </button>
          ) : (
            <div className="space-y-4">
              {/* Floating reaction stage */}
              <div className="relative h-52 bg-surface-0 border border-zinc-800 rounded-xl overflow-hidden select-none">
                <p className="absolute inset-0 flex items-center justify-center text-xs text-zinc-700 pointer-events-none">
                  Reactions float up here ↑
                </p>
                {reactions.map((r) => (
                  <span
                    key={r.id}
                    className="absolute text-3xl pointer-events-none"
                    style={{
                      left: `${r.x}%`,
                      bottom: '12px',
                      animation: 'floatUp 2.8s ease-out forwards',
                      filter: r.self
                        ? 'drop-shadow(0 0 10px rgba(59,130,246,0.9))'
                        : 'drop-shadow(0 0 10px rgba(139,92,246,0.9))',
                    }}
                  >
                    {r.emoji}
                  </span>
                ))}
              </div>

              {/* Emoji picker */}
              <div className="grid grid-cols-5 gap-2">
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    onClick={() => send(e)}
                    className="h-14 text-3xl rounded-xl bg-surface-2 hover:bg-surface-3 hover:scale-110 active:scale-95 transition-all duration-100 cursor-pointer"
                  >
                    {e}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-xs text-zinc-500">
                  🔵 Blue = sent · 🟣 Purple = received via DataChannel
                </p>
                <button onClick={reset} className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors">
                  Disconnect
                </button>
              </div>
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Emoji reactions via RTCDataChannel' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
        { label: 'RTCDataChannel.send()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/send' },
      ]}
    />
  );
}
