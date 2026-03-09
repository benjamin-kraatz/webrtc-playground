import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { IceCandidateCard } from '@/components/ui/IceCandidateCard';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const CODE = `// ICE candidates arrive asynchronously via onicecandidate
const pc = new RTCPeerConnection({ iceServers: [
  { urls: 'stun:stun.l.google.com:19302' }
]});

pc.onicecandidate = (event) => {
  if (event.candidate === null) {
    // null means ICE gathering is complete
    console.log('All candidates gathered');
  } else {
    const c = event.candidate;
    console.log(\`type=\${c.type} protocol=\${c.protocol} ip=\${c.address}:\${c.port}\`);
    // type: 'host' | 'srflx' (STUN) | 'relay' (TURN)
    sendToRemotePeer(c.toJSON());
  }
};`;

export default function IceCandidateExplorer() {
  const logger = useMemo(() => new Logger(), []);
  const [candidates, setCandidates] = useState<RTCIceCandidate[]>([]);
  const [gathering, setGathering] = useState(false);
  const [gatheringDone, setGatheringDone] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const handleGather = async () => {
    pcRef.current?.close();
    setCandidates([]);
    setGathering(true);
    setGatheringDone(false);

    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcRef.current = pc;

    pc.onicegatheringstatechange = () => {
      logger.info(`gathering state → ${pc.iceGatheringState}`);
      if (pc.iceGatheringState === 'complete') {
        setGathering(false);
        setGatheringDone(true);
        logger.success('ICE gathering complete');
      }
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        const c = ev.candidate;
        setCandidates((prev) => [...prev, c]);
        logger.info(`${c.type?.toUpperCase()} candidate: ${c.protocol?.toUpperCase()} ${c.address ?? '?'}:${c.port}`);
      } else {
        logger.info('null candidate — gathering complete signal');
      }
    };

    // Need a transceiver to trigger ICE gathering
    pc.addTransceiver('audio');

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    logger.info('Offer set — ICE gathering started...');
  };

  const grouped = {
    host: candidates.filter((c) => c.type === 'host'),
    srflx: candidates.filter((c) => c.type === 'srflx'),
    relay: candidates.filter((c) => c.type === 'relay'),
    prflx: candidates.filter((c) => c.type === 'prflx'),
  };

  return (
    <DemoLayout
      title="ICE Candidate Explorer"
      difficulty="beginner"
      description="See every ICE candidate as it arrives — host, server reflexive, and relay types."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>ICE</strong> (Interactive Connectivity Establishment) is how WebRTC finds a network
            path between two peers. It works by gathering <em>candidates</em> — possible network
            addresses the peer could be reached at.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            {[
              { type: 'host', color: 'text-ice-host', desc: 'Local network interfaces (LAN IP, loopback). Fastest if peers are on same network.' },
              { type: 'srflx', color: 'text-ice-srflx', desc: 'Your public IP as seen by a STUN server. Works when both peers are behind NAT.' },
              { type: 'relay', color: 'text-ice-relay', desc: 'Traffic routed via a TURN relay server. Works in all NAT scenarios but adds latency.' },
            ].map(({ type, color, desc }) => (
              <div key={type} className="bg-surface-0 rounded-lg p-3">
                <p className={`text-sm font-semibold font-mono mb-1 ${color}`}>{type}</p>
                <p className="text-xs text-zinc-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      }
      demo={
        <div className="space-y-5">
          <div className="flex gap-3 items-center">
            <button
              onClick={handleGather}
              disabled={gathering}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {gathering ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                  Gathering...
                </span>
              ) : 'Gather ICE Candidates'}
            </button>
            {gatheringDone && (
              <span className="text-sm text-emerald-400">✓ {candidates.length} candidates gathered</span>
            )}
          </div>

          {/* Summary */}
          {candidates.length > 0 && (
            <div className="flex gap-3 flex-wrap">
              {Object.entries(grouped).map(([type, list]) => list.length > 0 && (
                <div key={type} className="bg-surface-0 rounded-lg px-3 py-2 text-center">
                  <p className="text-lg font-bold text-zinc-100">{list.length}</p>
                  <p className="text-xs font-mono text-zinc-500">{type}</p>
                </div>
              ))}
            </div>
          )}

          {/* Candidate cards by type */}
          {Object.entries(grouped).map(([type, list]) => list.length > 0 && (
            <div key={type}>
              <p className="text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wider">{type} candidates</p>
              <div className="space-y-2">
                {list.map((c, i) => (
                  <IceCandidateCard key={i} candidate={c} />
                ))}
              </div>
            </div>
          ))}

          {candidates.length === 0 && !gathering && (
            <p className="text-sm text-zinc-600 italic">Click "Gather ICE Candidates" to start</p>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Listening for ICE candidates' }}
      mdnLinks={[
        { label: 'RTCIceCandidate', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCIceCandidate' },
        { label: 'onicecandidate', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/icecandidate_event' },
      ]}
    />
  );
}
