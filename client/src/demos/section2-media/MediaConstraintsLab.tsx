import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';

const CODE = `// Apply new constraints to an existing track (no need to restart!)
const videoTrack = stream.getVideoTracks()[0];
await videoTrack.applyConstraints({
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 15, max: 30 },
  facingMode: 'user' // 'environment' for rear camera
});

// Check what the browser actually applied
const applied = videoTrack.getSettings();
console.log(applied.width, applied.height, applied.frameRate);

// See what the hardware supports
const capabilities = videoTrack.getCapabilities();
console.log(capabilities.width, capabilities.height);`;

const RESOLUTIONS = [
  { label: '320×240', width: 320, height: 240 },
  { label: '640×480', width: 640, height: 480 },
  { label: '1280×720 (HD)', width: 1280, height: 720 },
  { label: '1920×1080 (FHD)', width: 1920, height: 1080 },
];

export default function MediaConstraintsLab() {
  const logger = useMemo(() => new Logger(), []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [settings, setSettings] = useState<MediaTrackSettings | null>(null);
  const [resolution, setResolution] = useState(RESOLUTIONS[1]);
  const [fps, setFps] = useState(30);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  const start = async () => {
    stream?.getTracks().forEach((t) => t.stop());
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: resolution.width }, height: { ideal: resolution.height }, frameRate: { ideal: fps }, facingMode },
        audio: false,
      });
      if (videoRef.current) videoRef.current.srcObject = s;
      setStream(s);
      const track = s.getVideoTracks()[0];
      const applied = track.getSettings();
      setSettings(applied);
      logger.success(`Stream started: ${applied.width}×${applied.height}@${applied.frameRate?.toFixed(0)}fps`);
    } catch (e) {
      logger.error(`Failed: ${e}`);
    }
  };

  const applyConstraints = async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    try {
      await track.applyConstraints({
        width: { ideal: resolution.width },
        height: { ideal: resolution.height },
        frameRate: { ideal: fps },
      });
      const applied = track.getSettings();
      setSettings(applied);
      logger.success(`Applied: ${applied.width}×${applied.height}@${applied.frameRate?.toFixed(0)}fps`);
    } catch (e) {
      logger.error(`applyConstraints failed: ${e}`);
    }
  };

  const stop = () => {
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setStream(null);
    setSettings(null);
    logger.info('Stream stopped');
  };

  return (
    <DemoLayout
      title="Media Constraints Lab"
      difficulty="intermediate"
      description="Experiment with resolution, frame rate, and codec constraints in real time."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>Constraints</strong> let you request specific video/audio properties from the
            browser. They use a priority system:
            <code className="ml-1 text-xs bg-surface-2 px-1 py-0.5 rounded">exact</code> (fail if unavailable),
            <code className="ml-1 text-xs bg-surface-2 px-1 py-0.5 rounded">ideal</code> (best effort),
            <code className="ml-1 text-xs bg-surface-2 px-1 py-0.5 rounded">min/max</code> (range).
          </p>
          <p>
            You can update constraints on a live track using
            <code className="ml-1 text-xs bg-surface-2 px-1 py-0.5 rounded">applyConstraints()</code> — no need to restart the stream.
            Check <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">getSettings()</code> to see what the browser actually applied.
          </p>
        </div>
      }
      demo={
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-2">RESOLUTION</p>
              <div className="space-y-1.5">
                {RESOLUTIONS.map((r) => (
                  <label key={r.label} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="res" checked={resolution === r} onChange={() => setResolution(r)} className="accent-blue-400" />
                    <span className="text-sm text-zinc-300">{r.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-2">FRAME RATE: {fps} fps</p>
              <input type="range" min={5} max={60} step={5} value={fps} onChange={(e) => setFps(Number(e.target.value))}
                className="w-full accent-blue-400" />
              <div className="flex justify-between text-xs text-zinc-600 mt-1">
                <span>5</span><span>30</span><span>60</span>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-2">FACING MODE</p>
              <div className="space-y-1.5">
                {(['user', 'environment'] as const).map((f) => (
                  <label key={f} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="facing" checked={facingMode === f} onChange={() => setFacingMode(f)} className="accent-blue-400" />
                    <span className="text-sm text-zinc-300">{f === 'user' ? 'Front (user)' : 'Rear (environment)'}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            {!stream ? (
              <button onClick={start} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Start with Constraints
              </button>
            ) : (
              <>
                <button onClick={applyConstraints} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                  Apply Constraints
                </button>
                <button onClick={stop} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                  Stop
                </button>
              </>
            )}
          </div>

          {settings && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'Width', value: settings.width },
                { label: 'Height', value: settings.height },
                { label: 'Frame Rate', value: settings.frameRate ? `${settings.frameRate.toFixed(1)} fps` : '—' },
                { label: 'Facing', value: settings.facingMode ?? '—' },
              ].map(({ label, value }) => (
                <div key={label} className="bg-surface-0 rounded-lg p-3">
                  <p className="text-xs text-zinc-500">{label} (actual)</p>
                  <p className="text-sm font-mono font-semibold text-zinc-200 mt-1">{value}</p>
                </div>
              ))}
            </div>
          )}

          <div className="aspect-video max-w-md bg-zinc-900 rounded-xl overflow-hidden mx-auto">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Constraints + applyConstraints' }}
      mdnLinks={[
        { label: 'MediaTrackConstraints', href: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints' },
        { label: 'applyConstraints()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/applyConstraints' },
      ]}
    />
  );
}
