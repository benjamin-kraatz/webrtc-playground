import { useMemo, useRef, useState, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import type { SignalingMessage } from '@/types/signaling';
import { v4 as uuidv4 } from 'uuid';

const W = 320, H = 240;

function pixelSort(imageData: ImageData, threshold: number, sortBy: 'luminance' | 'hue') {
  const d = imageData.data;
  const W = imageData.width, H = imageData.height;
  for (let y = 0; y < H; y++) {
    const row: { r: number; g: number; b: number; a: number; val: number }[] = [];
    let inGlitch = false;
    let start = 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const above = luma > threshold * 255;
      if (above && !inGlitch) { inGlitch = true; start = x; }
      if ((!above || x === W - 1) && inGlitch) {
        inGlitch = false;
        const seg = row.slice(start);
        seg.sort((a, b) => a.val - b.val);
        seg.forEach((px, j) => {
          const ii = (y * W + (start + j)) * 4;
          d[ii] = px.r; d[ii+1] = px.g; d[ii+2] = px.b; d[ii+3] = px.a;
        });
      }
      const val = sortBy === 'luminance' ? luma : (Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b) + Math.PI) / (Math.PI * 2) * 255;
      row.push({ r, g, b, a, val });
    }
  }
  return imageData;
}

const CODE = `// MASHUP: VideoCall + PixelSortGlitch
// Pixel-sort each video frame before display

function pixelSort(imageData, threshold) {
  const { data, width, height } = imageData;
  for (let y = 0; y < height; y++) {
    // Find "glitch runs" — rows of pixels above luminance threshold
    let inRun = false; let start = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const luma = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
      if (luma > threshold && !inRun) { inRun = true; start = x; }
      if ((luma <= threshold || x === width-1) && inRun) {
        inRun = false;
        // Sort the run by luminance — creates the glitch effect
        sortPixelRun(data, y, start, x, width);
      }
    }
  }
  return imageData;
}

// Glitch intensity and sort mode synced via DataChannel
dc.send(JSON.stringify({ type: 'glitch', threshold, sortBy }));`;

export default function GlitchVideoCall() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [roomId, setRoomId] = useState('glitch-room');
  const [joined, setJoined] = useState(false);
  const [threshold, setThreshold] = useState(0.5);
  const [sortBy, setSortBy] = useState<'luminance' | 'hue'>('luminance');
  const thresholdRef = useRef(threshold);
  const sortByRef = useRef(sortBy);
  thresholdRef.current = threshold;
  sortByRef.current = sortBy;

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteCanvasRef = useRef<HTMLCanvasElement>(null);
  const localCanvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const sendRef = useRef<((msg: SignalingMessage) => void)>(() => {});
  const rafRef = useRef<number>(0);
  const remoteStreamRef = useRef<MediaStream | null>(null);

  const applyGlitch = useCallback((srcVideo: HTMLVideoElement, dstCanvas: HTMLCanvasElement) => {
    if (srcVideo.readyState < 2 || !srcVideo.videoWidth) return;
    const ctx = dstCanvas.getContext('2d')!;
    ctx.drawImage(srcVideo, 0, 0, W, H);
    if (thresholdRef.current < 1.0) {
      const imgData = ctx.getImageData(0, 0, W, H);
      pixelSort(imgData, thresholdRef.current, sortByRef.current);
      ctx.putImageData(imgData, 0, 0);
    }
  }, []);

  const renderLoop = useCallback(() => {
    if (localVideoRef.current && localCanvasRef.current) applyGlitch(localVideoRef.current, localCanvasRef.current);
    if (hiddenVideoRef.current && remoteCanvasRef.current) applyGlitch(hiddenVideoRef.current, remoteCanvasRef.current);
    rafRef.current = requestAnimationFrame(renderLoop);
  }, [applyGlitch]);

  const onMessage = useCallback(async (msg: SignalingMessage) => {
    const pc = pcRef.current!;
    if (msg.type === 'peer-joined') {
      const dc = pc.createDataChannel('glitch'); dcRef.current = dc;
      dc.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'glitch') { setThreshold(m.threshold); setSortBy(m.sortBy); } };
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      sendRef.current({ type: 'offer', from: peerId, to: msg.peerId, sdp: offer });
    } else if (msg.type === 'offer') {
      await pc.setRemoteDescription(msg.sdp);
      const dc = pc.createDataChannel('glitch'); dcRef.current = dc;
      dc.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'glitch') { setThreshold(m.threshold); setSortBy(m.sortBy); } };
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      sendRef.current({ type: 'answer', from: peerId, to: msg.from, sdp: answer });
    } else if (msg.type === 'answer') {
      await pc.setRemoteDescription(msg.sdp);
    } else if (msg.type === 'ice-candidate') {
      await pc.addIceCandidate(msg.candidate);
    }
  }, [peerId]);

  const { status, connect, join, send } = useSignaling({ logger, onMessage });
  sendRef.current = send;

  const handleJoin = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: W, height: H }, audio: false });
    localVideoRef.current!.srcObject = stream; await localVideoRef.current!.play();

    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pcRef.current = pc;
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    pc.onicecandidate = e => e.candidate && sendRef.current({ type: 'ice-candidate', from: peerId, to: '', candidate: e.candidate });
    pc.ondatachannel = ev => { dcRef.current = ev.channel; ev.channel.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'glitch') { setThreshold(m.threshold); setSortBy(m.sortBy); } }; };
    pc.ontrack = e => {
      remoteStreamRef.current = e.streams[0];
      hiddenVideoRef.current!.srcObject = e.streams[0];
      hiddenVideoRef.current!.play();
    };

    connect(); join(roomId, peerId);
    setJoined(true);
    rafRef.current = requestAnimationFrame(renderLoop);
    logger.success(`Joined room "${roomId}" — open another tab and join the same room!`);
  };

  const syncGlitch = () => {
    dcRef.current?.send(JSON.stringify({ type: 'glitch', threshold: thresholdRef.current, sortBy: sortByRef.current }));
  };

  return (
    <DemoLayout
      title="Glitch Video Call"
      difficulty="advanced"
      description="MASHUP: VideoCall + PixelSortGlitch — peer-to-peer video call where both streams are processed through real-time pixel-sort glitch art. Glitch intensity syncs via DataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This mashup layers <strong>pixel-sort glitch art</strong> onto a live peer-to-peer video call.
            After each video frame is received, pixel rows are analyzed for luminance above a threshold —
            pixels in those runs are sorted by brightness, creating the iconic glitch aesthetic.
          </p>
          <p>
            The <strong>threshold slider</strong> controls how much glitching occurs: 0% = total chaos,
            100% = no effect. Drag it during a call for dramatic visual effects. The threshold syncs to
            your peer via DataChannel.
          </p>
        </div>
      }
      hints={[
        'Open two tabs and join the same room name',
        'Low threshold = extreme glitch; high threshold = subtle effect',
        'Try "Hue" sort mode for psychedelic color banding',
        'Move quickly in front of the camera for more interesting glitch patterns',
      ]}
      demo={
        <div className="space-y-4">
          {!joined && (
            <div className="flex gap-2 items-center">
              <input value={roomId} onChange={e => setRoomId(e.target.value)} placeholder="Room ID"
                className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-100 w-36" />
              <button onClick={handleJoin} className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg">📡 Join Call</button>
              <span className="text-xs text-zinc-500">Status: {status}</span>
            </div>
          )}
          {joined && (
            <div className="flex flex-wrap gap-3 items-center">
              <span className="text-xs text-zinc-500">Status: {status}</span>
              <div className="flex items-center gap-2 ml-auto">
                <label className="text-xs text-zinc-400">Glitch</label>
                <input type="range" min={0} max={100} value={Math.round((1 - threshold) * 100)}
                  onChange={e => { const v = 1 - e.target.valueAsNumber / 100; setThreshold(v); thresholdRef.current = v; syncGlitch(); }}
                  className="w-28 accent-red-500" />
                <span className="text-xs text-zinc-400 w-8">{Math.round((1 - threshold) * 100)}%</span>
              </div>
              <div className="flex gap-1">
                {(['luminance', 'hue'] as const).map(m => (
                  <button key={m} onClick={() => { setSortBy(m); sortByRef.current = m; syncGlitch(); }}
                    className={`px-2.5 py-1 text-xs rounded-lg border ${sortBy === m ? 'border-red-500 bg-red-950/40 text-red-300' : 'border-zinc-700 text-zinc-400'}`}>{m}</button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-zinc-500 mb-1.5 text-center">You (glitched)</p>
              <canvas ref={localCanvasRef} width={W} height={H} className="rounded-xl border border-zinc-800 w-full" style={{ background: '#09090b' }} />
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1.5 text-center">Peer (glitched)</p>
              <canvas ref={remoteCanvasRef} width={W} height={H} className="rounded-xl border border-zinc-800 w-full" style={{ background: '#09090b' }} />
            </div>
          </div>
          <video ref={localVideoRef} className="hidden" muted playsInline />
          <video ref={hiddenVideoRef} className="hidden" muted playsInline />
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Pixel-sort glitch applied to WebRTC video frames' }}
      mdnLinks={[
        { label: 'RTCPeerConnection', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection' },
        { label: 'CanvasRenderingContext2D.getImageData', href: 'https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/getImageData' },
      ]}
    />
  );
}
