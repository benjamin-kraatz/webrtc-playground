import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

type Role = 'offer' | 'answer' | null;

const CODE = `// Tab 1 (Offerer):
const pc = new RTCPeerConnection(config);
pc.addTransceiver('video'); pc.addTransceiver('audio');
const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
// Wait for ICE to complete, then copy offer SDP to Tab 2

// Tab 2 (Answerer):
const pc2 = new RTCPeerConnection(config);
await pc2.setRemoteDescription({ type: 'offer', sdp: pastedOfferSdp });
const answer = await pc2.createAnswer();
await pc2.setLocalDescription(answer);
// Copy answer SDP back to Tab 1

// Tab 1 again:
await pc.setRemoteDescription({ type: 'answer', sdp: pastedAnswerSdp });
// ICE negotiates → connected!`;

export default function ManualSignaling() {
  const logger = useMemo(() => new Logger(), []);
  const [role, setRole] = useState<Role>(null);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [localSdp, setLocalSdp] = useState('');
  const [remoteSdpInput, setRemoteSdpInput] = useState('');
  const [step, setStep] = useState(0);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const setupPc = () => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcRef.current = pc;
    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      logger.info(`connectionState → ${pc.connectionState}`);
    };
    pc.ontrack = (ev) => {
      logger.success('Remote track received!');
      const s = ev.streams[0] ?? new MediaStream([ev.track]);
      setRemoteStream(s);
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = s;
    };
    return pc;
  };

  // Wait for complete ICE gathering then return full SDP
  const gatherCompleteSdp = (pc: RTCPeerConnection): Promise<string> => {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve(pc.localDescription!.sdp);
        return;
      }
      const check = () => {
        if (pc.iceGatheringState === 'complete') {
          resolve(pc.localDescription!.sdp);
          pc.removeEventListener('icegatheringstatechange', check);
        }
      };
      pc.addEventListener('icegatheringstatechange', check);
    });
  };

  const handleStartOffer = async () => {
    setRole('offer');
    setStep(1);
    const pc = setupPc();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      logger.success('Camera/mic acquired');
    } catch {
      pc.addTransceiver('video');
      pc.addTransceiver('audio');
      logger.warn('No camera/mic — using transceivers only');
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    logger.info('Gathering ICE candidates (please wait)...');
    const fullSdp = await gatherCompleteSdp(pc);
    setLocalSdp(fullSdp);
    setStep(2);
    logger.success('Offer ready! Copy the SDP below to Tab 2');
  };

  const handlePasteAnswer = async () => {
    const pc = pcRef.current!;
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: remoteSdpInput });
      setStep(3);
      logger.success('Answer set! ICE negotiating...');
    } catch (e) {
      logger.error(`Failed to set answer: ${e}`);
    }
  };

  const handleStartAnswer = async () => {
    setRole('answer');
    setStep(1);
    const pc = setupPc();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      logger.success('Camera/mic acquired');
    } catch {
      logger.warn('No camera/mic');
    }
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: remoteSdpInput });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      logger.info('Gathering ICE...');
      const fullSdp = await gatherCompleteSdp(pc);
      setLocalSdp(fullSdp);
      setStep(2);
      logger.success('Answer ready! Copy the SDP below back to Tab 1');
    } catch (e) {
      logger.error(`Failed: ${e}`);
    }
  };

  const reset = () => {
    pcRef.current?.close();
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    setRole(null);
    setStep(0);
    setLocalSdp('');
    setRemoteSdpInput('');
    setConnectionState('new');
    setRemoteStream(null);
  };

  return (
    <DemoLayout
      title="Manual Signaling"
      difficulty="beginner"
      description="Copy-paste offer and answer SDP between two browser tabs — no server needed."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This demo shows the raw signaling process. <strong>Signaling</strong> is how two peers
            exchange SDP — it's intentionally left out of the WebRTC spec so you can use any channel
            (WebSocket, HTTP, carrier pigeon...).
          </p>
          <p>
            Open this page in <strong>two browser tabs</strong>. In Tab 1, click "I'm the Offerer"
            and copy the offer SDP. In Tab 2, click "I'm the Answerer", paste the offer, then copy
            the answer back to Tab 1.
          </p>
        </div>
      }
      hints={[
        'Open a second tab with this same URL',
        'Tab 1 is the Offerer, Tab 2 is the Answerer',
        'Wait for ICE gathering to complete before copying',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <ConnectionStatus state={connectionState} />
            {step > 0 && (
              <span className="text-xs text-zinc-500">Role: <span className="text-zinc-300 font-semibold">{role}</span></span>
            )}
          </div>

          {/* Video grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="relative aspect-video bg-zinc-900 rounded-lg overflow-hidden">
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              <div className="absolute bottom-2 left-2 text-xs bg-black/60 text-zinc-300 px-1.5 py-0.5 rounded">Local</div>
            </div>
            <div className="relative aspect-video bg-zinc-900 rounded-lg overflow-hidden">
              <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />
              <div className="absolute bottom-2 left-2 text-xs bg-black/60 text-zinc-300 px-1.5 py-0.5 rounded">Remote</div>
            </div>
          </div>

          {role === null && (
            <div className="flex gap-3">
              <button onClick={handleStartOffer} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                I'm the Offerer (Tab 1)
              </button>
              <div className="flex-1">
                <textarea
                  value={remoteSdpInput}
                  onChange={(e) => setRemoteSdpInput(e.target.value)}
                  placeholder="Paste Offer SDP from Tab 1 here, then click Answerer"
                  className="w-full h-20 bg-surface-0 border border-zinc-700 rounded-lg p-2 text-xs font-mono text-zinc-300 resize-none focus:outline-none focus:border-blue-500"
                />
                <button
                  onClick={handleStartAnswer}
                  disabled={!remoteSdpInput.trim()}
                  className="mt-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg w-full"
                >
                  I'm the Answerer (Tab 2)
                </button>
              </div>
            </div>
          )}

          {role === 'offer' && step >= 2 && (
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-zinc-400 mb-1">Step 1: Copy this offer → Tab 2</p>
                <textarea
                  value={localSdp}
                  readOnly
                  className="w-full h-28 bg-surface-0 border border-zinc-700 rounded-lg p-2 text-xs font-mono text-zinc-300 resize-none"
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                />
              </div>
              {step === 2 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-400 mb-1">Step 2: Paste answer from Tab 2</p>
                  <textarea
                    value={remoteSdpInput}
                    onChange={(e) => setRemoteSdpInput(e.target.value)}
                    placeholder="Paste answer SDP from Tab 2..."
                    className="w-full h-20 bg-surface-0 border border-zinc-700 rounded-lg p-2 text-xs font-mono text-zinc-300 resize-none focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handlePasteAnswer}
                    disabled={!remoteSdpInput.trim()}
                    className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
                  >
                    Apply Answer
                  </button>
                </div>
              )}
            </div>
          )}

          {role === 'answer' && step >= 2 && (
            <div>
              <p className="text-xs font-semibold text-zinc-400 mb-1">Copy this answer → Tab 1</p>
              <textarea
                value={localSdp}
                readOnly
                className="w-full h-28 bg-surface-0 border border-zinc-700 rounded-lg p-2 text-xs font-mono text-zinc-300 resize-none"
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
              />
            </div>
          )}

          {step > 0 && (
            <button onClick={reset} className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 text-zinc-400 text-sm rounded-lg">
              Reset
            </button>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'The manual signaling dance' }}
      mdnLinks={[
        { label: 'WebRTC connectivity', href: 'https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity' },
      ]}
    />
  );
}
