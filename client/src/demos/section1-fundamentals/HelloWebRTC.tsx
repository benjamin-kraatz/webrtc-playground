import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { PcStateDiagram } from '@/components/ui/PcStateDiagram';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const CODE = `// Two RTCPeerConnections on the same page — no network needed!
const pcA = new RTCPeerConnection(config);
const pcB = new RTCPeerConnection(config);

// Wire ICE candidates between them
pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);

// Negotiate
const offer = await pcA.createOffer();
await pcA.setLocalDescription(offer);
await pcB.setRemoteDescription(offer);

const answer = await pcB.createAnswer();
await pcB.setLocalDescription(answer);
await pcA.setRemoteDescription(answer);
// ICE takes over from here → connected!`;

export default function HelloWebRTC() {
  const logger = useMemo(() => new Logger(), []);
  const [stateA, setStateA] = useState<RTCPeerConnectionState>('new');
  const [stateB, setStateB] = useState<RTCPeerConnectionState>('new');
  const [connected, setConnected] = useState(false);
  const pcA = useRef<RTCPeerConnection | null>(null);
  const pcB = useRef<RTCPeerConnection | null>(null);

  const handleConnect = async () => {
    // Close previous
    pcA.current?.close();
    pcB.current?.close();
    setConnected(false);

    const a = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const b = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.current = a;
    pcB.current = b;

    a.onconnectionstatechange = () => {
      setStateA(a.connectionState);
      logger.info(`[A] connectionState → ${a.connectionState}`);
      if (a.connectionState === 'connected') setConnected(true);
    };
    b.onconnectionstatechange = () => {
      setStateB(b.connectionState);
      logger.info(`[B] connectionState → ${b.connectionState}`);
    };
    a.oniceconnectionstatechange = () => logger.info(`[A] iceState → ${a.iceConnectionState}`);
    b.oniceconnectionstatechange = () => logger.info(`[B] iceState → ${b.iceConnectionState}`);

    // Create a dummy data channel so ICE actually negotiates
    a.createDataChannel('ping');
    logger.info('Data channel created on A');

    a.onicecandidate = (ev) => {
      if (ev.candidate) {
        b.addIceCandidate(ev.candidate);
        logger.debug(`[A→B] ICE: ${ev.candidate.type} ${ev.candidate.address ?? ''}`);
      }
    };
    b.onicecandidate = (ev) => {
      if (ev.candidate) {
        a.addIceCandidate(ev.candidate);
        logger.debug(`[B→A] ICE: ${ev.candidate.type}`);
      }
    };

    logger.info('Creating offer...');
    const offer = await a.createOffer();
    await a.setLocalDescription(offer);
    await b.setRemoteDescription(offer);
    logger.success('Offer set on both sides');

    const answer = await b.createAnswer();
    await b.setLocalDescription(answer);
    await a.setRemoteDescription(answer);
    logger.success('Answer set on both sides — ICE negotiating...');
  };

  const handleDisconnect = () => {
    pcA.current?.close();
    pcB.current?.close();
    setStateA('closed');
    setStateB('closed');
    setConnected(false);
    logger.info('Connections closed');
  };

  return (
    <DemoLayout
      title="Hello WebRTC"
      difficulty="beginner"
      description="Your first RTCPeerConnection — connect two peers on the same page via loopback."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>WebRTC</strong> (Web Real-Time Communication) lets browsers exchange media and data
            directly, peer-to-peer — without any server in the media path.
          </p>
          <p>
            Every WebRTC connection starts with <strong>signaling</strong>: exchanging SDP offers and
            answers to agree on codecs, network addresses, and security keys. In this demo, both peers
            are on the same page so signaling is just function calls.
          </p>
          <p>
            After signaling, <strong>ICE</strong> (Interactive Connectivity Establishment) gathers
            network candidates and finds a path between the peers. Once ICE succeeds, the
            <code className="mx-1 text-xs bg-surface-2 px-1 py-0.5 rounded">connectionState</code>
            reaches <span className="text-emerald-400">"connected"</span>.
          </p>
        </div>
      }
      demo={
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-surface-0 rounded-lg p-4 space-y-2">
              <p className="text-xs font-semibold text-zinc-500">PEER A</p>
              <ConnectionStatus state={stateA} />
              <PcStateDiagram current={stateA} />
            </div>
            <div className="bg-surface-0 rounded-lg p-4 space-y-2">
              <p className="text-xs font-semibold text-zinc-500">PEER B</p>
              <ConnectionStatus state={stateB} />
              <PcStateDiagram current={stateB} />
            </div>
          </div>

          {connected && (
            <div className="text-center py-4 bg-emerald-900/20 border border-emerald-800 rounded-lg">
              <p className="text-emerald-400 font-semibold text-lg">🎉 Connected!</p>
              <p className="text-sm text-zinc-400 mt-1">Two RTCPeerConnections are talking directly, peer-to-peer.</p>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={handleConnect}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Connect
            </button>
            <button
              onClick={handleDisconnect}
              className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Loopback negotiation' }}
      mdnLinks={[
        { label: 'RTCPeerConnection', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection' },
        { label: 'createOffer()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/createOffer' },
      ]}
    />
  );
}
