import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const CODE = `// getDisplayMedia — screen capture
const screenStream = await navigator.mediaDevices.getDisplayMedia({
  video: { displaySurface: 'monitor' }, // or 'window', 'browser'
  audio: false // system audio (browser support varies)
});

// Handle user clicking "Stop sharing" in browser UI
screenStream.getVideoTracks()[0].onended = () => {
  console.log('User stopped sharing');
  cleanup();
};

// Inject into WebRTC — replace existing video track
const sender = pc.getSenders().find(s => s.track?.kind === 'video');
await sender.replaceTrack(screenStream.getVideoTracks()[0]);`;

export default function ScreenShare() {
  const logger = useMemo(() => new Logger(), []);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const pcA = useRef<RTCPeerConnection | null>(null);
  const pcB = useRef<RTCPeerConnection | null>(null);

  const handleStart = async () => {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      setScreenStream(screen);
      if (localRef.current) localRef.current.srcObject = screen;
      logger.success('Screen share started');

      // Stop on user's browser button
      screen.getVideoTracks()[0].onended = () => {
        logger.info('Screen share stopped by user');
        setScreenStream(null);
        handleStop();
      };

      // Loopback
      const a = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      const b = new RTCPeerConnection(DEFAULT_PC_CONFIG);
      pcA.current = a;
      pcB.current = b;

      a.onconnectionstatechange = () => {
        setConnectionState(a.connectionState);
        logger.info(`connectionState → ${a.connectionState}`);
      };

      a.onicecandidate = (ev) => ev.candidate && b.addIceCandidate(ev.candidate);
      b.onicecandidate = (ev) => ev.candidate && a.addIceCandidate(ev.candidate);

      b.ontrack = (ev) => {
        const s = ev.streams[0] ?? new MediaStream([ev.track]);
        setRemoteStream(s);
        if (remoteRef.current) remoteRef.current.srcObject = s;
        logger.success('Remote screen track received');
      };

      screen.getTracks().forEach((t) => a.addTrack(t, screen));

      const offer = await a.createOffer();
      await a.setLocalDescription(offer);
      await b.setRemoteDescription(offer);
      const answer = await b.createAnswer();
      await b.setLocalDescription(answer);
      await a.setRemoteDescription(answer);
      logger.success('Loopback negotiated — ICE starting...');
    } catch (e) {
      logger.error(`Failed: ${e}`);
    }
  };

  const handleStop = () => {
    screenStream?.getTracks().forEach((t) => t.stop());
    pcA.current?.close();
    pcB.current?.close();
    setScreenStream(null);
    setRemoteStream(null);
    setConnectionState('closed');
    if (localRef.current) localRef.current.srcObject = null;
    if (remoteRef.current) remoteRef.current.srcObject = null;
    logger.info('Stopped');
  };

  return (
    <DemoLayout
      title="Screen Share"
      difficulty="beginner"
      description="Share your screen or a window and view it through a loopback WebRTC connection."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">navigator.mediaDevices.getDisplayMedia()</code> lets
            users share their entire screen, a specific window, or a browser tab.
          </p>
          <p>
            This demo runs the screen capture through a <strong>loopback WebRTC connection</strong>,
            so you see it twice — the raw source on the left and the WebRTC-transmitted version on the right.
          </p>
          <p className="text-amber-400/80">
            ⚡ Always handle <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">track.onended</code> — it
            fires when the user clicks the browser's "Stop sharing" button.
          </p>
        </div>
      }
      demo={
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <ConnectionStatus state={connectionState} />
            {!screenStream ? (
              <button onClick={handleStart} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Start Screen Share
              </button>
            ) : (
              <button onClick={handleStop} className="px-4 py-2 bg-red-900/50 hover:bg-red-900 text-red-400 text-sm font-medium rounded-lg border border-red-800">
                Stop
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Source (local)</p>
              <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
                <video ref={localRef} autoPlay playsInline muted className="w-full h-full object-contain" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-zinc-500">Via WebRTC loopback</p>
              <div className="aspect-video bg-zinc-900 rounded-lg overflow-hidden">
                <video ref={remoteRef} autoPlay playsInline muted className="w-full h-full object-contain" />
              </div>
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'getDisplayMedia + track replacement' }}
      mdnLinks={[
        { label: 'getDisplayMedia()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia' },
      ]}
    />
  );
}
