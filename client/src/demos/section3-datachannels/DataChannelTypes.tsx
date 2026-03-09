import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const CODE = `// Ordered + reliable (like TCP) — default
const reliable = pc.createDataChannel('reliable', {
  ordered: true
});

// Unordered + unreliable (like UDP) — low latency for games
const unreliable = pc.createDataChannel('unreliable', {
  ordered: false,
  maxRetransmits: 0  // drop packets immediately
});

// Ordered + limited retransmits
const partial = pc.createDataChannel('partial', {
  ordered: true,
  maxRetransmits: 2
});

// Ordered + time-limited
const timed = pc.createDataChannel('timed', {
  ordered: true,
  maxPacketLifeTime: 100 // ms
});`;

interface ChannelConfig {
  label: string;
  opts: RTCDataChannelInit;
  description: string;
}

const CONFIGS: ChannelConfig[] = [
  { label: 'reliable', opts: { ordered: true }, description: 'Ordered + reliable (TCP-like). All messages arrive in order, no drops.' },
  { label: 'unreliable', opts: { ordered: false, maxRetransmits: 0 }, description: 'Unordered + unreliable (UDP-like). Fastest, but messages may drop or arrive out of order.' },
  { label: 'partial', opts: { ordered: true, maxRetransmits: 2 }, description: 'Ordered + max 2 retransmits. Balances reliability and latency.' },
  { label: 'timed', opts: { ordered: true, maxPacketLifeTime: 100 }, description: 'Ordered, but drops messages older than 100ms. Good for real-time data.' },
];

export default function DataChannelTypes() {
  const logger = useMemo(() => new Logger(), []);
  const [results, setResults] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);

  const handleTest = async () => {
    setRunning(true);
    setResults({});
    logger.info('Testing all data channel configurations...');

    for (const config of CONFIGS) {
      const received: string[] = [];
      const sent: string[] = [];

      await new Promise<void>((resolve) => {
        const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
        const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
        pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
        pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);

        const dc = pcA.createDataChannel(config.label, config.opts);
        pcB.ondatachannel = (ev) => {
          ev.channel.onmessage = (e) => received.push(e.data as string);
        };

        const cleanup = () => { pcA.close(); pcB.close(); };

        dc.onopen = async () => {
          logger.info(`[${config.label}] Channel open — sending 10 messages`);
          for (let i = 0; i < 10; i++) {
            const msg = `msg-${i}`;
            sent.push(msg);
            dc.send(msg);
          }
          // Wait for delivery
          await new Promise((r) => setTimeout(r, 500));
          setResults((prev) => ({
            ...prev,
            [config.label]: `Sent ${sent.length}, Received ${received.length}${
              JSON.stringify(received) === JSON.stringify(sent) ? ' (in order ✓)' : ' (reordered ⚠)'
            }`,
          }));
          logger.success(`[${config.label}] sent=${sent.length} received=${received.length}`);
          cleanup();
          resolve();
        };

        (async () => {
          const offer = await pcA.createOffer();
          await pcA.setLocalDescription(offer);
          await pcB.setRemoteDescription(offer);
          const answer = await pcB.createAnswer();
          await pcB.setLocalDescription(answer);
          await pcA.setRemoteDescription(answer);
        })().catch(console.error);
      });
    }

    setRunning(false);
    logger.success('All tests complete');
  };

  return (
    <DemoLayout
      title="Data Channel Types"
      difficulty="intermediate"
      description="Compare ordered vs unordered, reliable vs unreliable data channel modes."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>RTCDataChannel</strong> is extremely flexible — you can tune it like a dial
            between TCP (ordered, reliable) and UDP (unordered, unreliable). The right setting depends
            on your use case.
          </p>
          <div className="grid grid-cols-2 gap-3 mt-2">
            {[
              { label: 'Chat / File Transfer', opts: 'ordered + reliable', reason: 'Every message must arrive in order' },
              { label: 'Multiplayer Games', opts: 'unordered + unreliable', reason: 'Latest position matters, not old ones' },
              { label: 'Video Streaming', opts: 'ordered + timed', reason: 'Drop stale frames, keep timing' },
              { label: 'Telemetry', opts: 'unordered + partial', reason: 'Some retransmits, low latency' },
            ].map(({ label, opts, reason }) => (
              <div key={label} className="bg-surface-0 rounded-lg p-3">
                <p className="text-xs font-semibold text-zinc-300">{label}</p>
                <p className="text-xs text-blue-400 font-mono mt-0.5">{opts}</p>
                <p className="text-xs text-zinc-500 mt-1">{reason}</p>
              </div>
            ))}
          </div>
        </div>
      }
      demo={
        <div className="space-y-5">
          <button
            onClick={handleTest}
            disabled={running}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
          >
            {running ? 'Testing...' : 'Run All Tests'}
          </button>

          <div className="space-y-3">
            {CONFIGS.map((c) => (
              <div key={c.label} className="bg-surface-0 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold font-mono text-zinc-200">{c.label}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{c.description}</p>
                    <p className="text-xs font-mono text-blue-400 mt-1">
                      {JSON.stringify(c.opts).replace(/[{}"]/g, '').replace(/,/g, ', ')}
                    </p>
                  </div>
                  {results[c.label] && (
                    <span className="text-xs text-emerald-400 font-mono shrink-0">{results[c.label]}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'All four channel modes' }}
      mdnLinks={[
        { label: 'RTCDataChannelInit', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
