import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { PcStateDiagram } from '@/components/ui/PcStateDiagram';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

interface StateSnapshot {
  label: string;
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  iceGatheringState: RTCIceGatheringState;
  signalingState: RTCSignalingState;
}

const CODE = `// Every state machine you need to watch:
pc.onconnectionstatechange = () =>
  console.log('connectionState:', pc.connectionState);
  // 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed'

pc.oniceconnectionstatechange = () =>
  console.log('iceConnectionState:', pc.iceConnectionState);
  // 'new' | 'checking' | 'connected' | 'completed' | 'failed' | 'disconnected' | 'closed'

pc.onicegatheringstatechange = () =>
  console.log('iceGatheringState:', pc.iceGatheringState);
  // 'new' | 'gathering' | 'complete'

pc.onsignalingstatechange = () =>
  console.log('signalingState:', pc.signalingState);
  // 'stable' | 'have-local-offer' | 'have-remote-offer' | 'have-local-pranswer' | ...`;

export default function ConnectionStates() {
  const logger = useMemo(() => new Logger(), []);
  const [snapshots, setSnapshots] = useState<StateSnapshot[]>([]);
  const pcA = useRef<RTCPeerConnection | null>(null);
  const pcB = useRef<RTCPeerConnection | null>(null);

  const [liveA, setLiveA] = useState<Omit<StateSnapshot, 'label'>>({
    connectionState: 'new',
    iceConnectionState: 'new',
    iceGatheringState: 'new',
    signalingState: 'stable',
  });

  const snapshot = (label: string, pc: RTCPeerConnection) => {
    const s: StateSnapshot = {
      label,
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      iceGatheringState: pc.iceGatheringState,
      signalingState: pc.signalingState,
    };
    setSnapshots((prev) => [...prev, s]);
  };

  const handleStart = async () => {
    pcA.current?.close();
    pcB.current?.close();
    setSnapshots([]);

    const a = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const b = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.current = a;
    pcB.current = b;

    const updateLive = () =>
      setLiveA({
        connectionState: a.connectionState,
        iceConnectionState: a.iceConnectionState,
        iceGatheringState: a.iceGatheringState,
        signalingState: a.signalingState,
      });

    a.onconnectionstatechange = () => { updateLive(); logger.info(`[A] connection → ${a.connectionState}`); };
    a.oniceconnectionstatechange = () => { updateLive(); logger.info(`[A] ice → ${a.iceConnectionState}`); };
    a.onicegatheringstatechange = () => { updateLive(); logger.info(`[A] gathering → ${a.iceGatheringState}`); };
    a.onsignalingstatechange = () => { updateLive(); logger.info(`[A] signaling → ${a.signalingState}`); };

    a.onicecandidate = (ev) => ev.candidate && b.addIceCandidate(ev.candidate);
    b.onicecandidate = (ev) => ev.candidate && a.addIceCandidate(ev.candidate);
    a.createDataChannel('ping');

    snapshot('Initial', a);

    const offer = await a.createOffer();
    snapshot('After createOffer()', a);

    await a.setLocalDescription(offer);
    snapshot('After setLocalDescription(offer)', a);

    await b.setRemoteDescription(offer);
    const answer = await b.createAnswer();
    await b.setLocalDescription(answer);
    await a.setRemoteDescription(answer);
    snapshot('After setRemoteDescription(answer)', a);

    logger.success('Negotiation complete — watching ICE...');
  };

  const handleClose = () => {
    pcA.current?.close();
    pcB.current?.close();
    setLiveA({ connectionState: 'closed', iceConnectionState: 'closed', iceGatheringState: 'complete', signalingState: 'closed' });
    logger.info('Connections closed');
  };

  return (
    <DemoLayout
      title="Connection States"
      difficulty="beginner"
      description="Watch the RTCPeerConnection state machine animate through every state transition."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            A single <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">RTCPeerConnection</code> exposes
            <strong> four separate state machines</strong>, each progressing independently:
          </p>
          <ul className="list-disc list-inside space-y-1 text-zinc-300 ml-2">
            <li><strong>connectionState</strong> — the high-level connection health</li>
            <li><strong>iceConnectionState</strong> — ICE-specific negotiation progress</li>
            <li><strong>iceGatheringState</strong> — how many candidates have been gathered</li>
            <li><strong>signalingState</strong> — where we are in the offer/answer exchange</li>
          </ul>
          <p>This demo records a snapshot of all four states at each step of negotiation.</p>
        </div>
      }
      demo={
        <div className="space-y-5">
          {/* Live states for Peer A */}
          <div>
            <p className="text-xs font-semibold text-zinc-500 mb-3">PEER A — LIVE STATE</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <p className="text-xs text-zinc-600">connectionState</p>
                <ConnectionStatus state={liveA.connectionState} />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-zinc-600">iceConnectionState</p>
                <ConnectionStatus state={liveA.iceConnectionState} />
              </div>
              <div className="space-y-1">
                <p className="text-xs text-zinc-600">iceGatheringState</p>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-surface-2 text-zinc-300">
                  {liveA.iceGatheringState}
                </span>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-zinc-600">signalingState</p>
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-surface-2 text-zinc-300">
                  {liveA.signalingState}
                </span>
              </div>
            </div>
          </div>

          {/* State history */}
          {snapshots.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-2">STATE HISTORY</p>
              <div className="space-y-1.5">
                {snapshots.map((s, i) => (
                  <div key={i} className="bg-surface-0 border border-zinc-800 rounded-lg px-3 py-2 flex flex-wrap gap-3 text-xs font-mono">
                    <span className="text-blue-400 font-semibold min-w-44">{s.label}</span>
                    <span className="text-zinc-500">conn=<span className="text-zinc-300">{s.connectionState}</span></span>
                    <span className="text-zinc-500">ice=<span className="text-zinc-300">{s.iceConnectionState}</span></span>
                    <span className="text-zinc-500">sig=<span className="text-zinc-300">{s.signalingState}</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleStart}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Start Negotiation
            </button>
            <button
              onClick={handleClose}
              className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Watching all four state machines' }}
      mdnLinks={[
        { label: 'connectionState', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionState' },
        { label: 'iceConnectionState', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/iceConnectionState' },
      ]}
    />
  );
}
