import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';

const CODE = `// Request camera + microphone
const stream = await navigator.mediaDevices.getUserMedia({
  video: { width: { ideal: 1280 }, height: { ideal: 720 } },
  audio: true
});

// Attach to a video element
videoElement.srcObject = stream;

// Stop when done (releases hardware lock)
stream.getTracks().forEach(track => track.stop());`;

export default function CameraMicPreview() {
  const logger = useMemo(() => new Logger(), []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [tracks, setTracks] = useState<MediaStreamTrack[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleRequest = async (video: boolean, audio: boolean) => {
    // Stop existing
    stream?.getTracks().forEach((t) => t.stop());
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video, audio });
      if (videoRef.current) videoRef.current.srcObject = s;
      setStream(s);
      setTracks(s.getTracks());
      logger.success(`Stream acquired: ${s.getTracks().map((t) => t.kind).join(', ')}`);
      s.getTracks().forEach((t) => {
        logger.info(`Track: ${t.kind} — ${t.label} (enabled: ${t.enabled})`);
        const settings = t.getSettings();
        logger.debug(`Settings: ${JSON.stringify(settings)}`);
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      logger.error(`getUserMedia failed: ${msg}`);
    }
  };

  const handleStop = () => {
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setStream(null);
    setTracks([]);
    logger.info('Stream stopped — hardware released');
  };

  const toggleTrack = (track: MediaStreamTrack) => {
    track.enabled = !track.enabled;
    setTracks([...tracks]);
    logger.info(`${track.kind} track ${track.enabled ? 'enabled' : 'disabled'}`);
  };

  return (
    <DemoLayout
      title="Camera & Mic Preview"
      difficulty="beginner"
      description="Request camera and microphone access and preview the stream locally."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">navigator.mediaDevices.getUserMedia()</code> is
            the gateway to accessing a user's camera and microphone. The browser shows a permission
            prompt the first time — on subsequent visits it remembers the choice.
          </p>
          <p>
            The returned <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">MediaStream</code> contains
            one or more <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">MediaStreamTrack</code> objects.
            Each track can be individually enabled/disabled (mute) or stopped (releases the hardware).
          </p>
          <p className="text-amber-400/80">
            ⚡ Setting <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">track.enabled = false</code> mutes
            it (sends silence/black). Calling <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">track.stop()</code> fully
            releases the device — the camera light turns off.
          </p>
        </div>
      }
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            <button onClick={() => handleRequest(true, true)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
              Camera + Mic
            </button>
            <button onClick={() => handleRequest(true, false)} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
              Camera only
            </button>
            <button onClick={() => handleRequest(false, true)} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
              Mic only
            </button>
            {stream && (
              <button onClick={handleStop} className="px-4 py-2 bg-red-900/50 hover:bg-red-900 text-red-400 text-sm font-medium rounded-lg border border-red-800">
                Stop & Release
              </button>
            )}
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="aspect-video max-w-lg bg-zinc-900 rounded-xl overflow-hidden mx-auto">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
          </div>

          {tracks.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-2">TRACKS</p>
              <div className="space-y-2">
                {tracks.map((t, i) => (
                  <div key={i} className="bg-surface-0 border border-zinc-800 rounded-lg p-3 flex items-center justify-between gap-3">
                    <div>
                      <span className={`text-xs font-semibold mr-2 ${t.kind === 'video' ? 'text-violet-400' : 'text-blue-400'}`}>
                        {t.kind}
                      </span>
                      <span className="text-xs text-zinc-400 truncate">{t.label || 'unnamed'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${t.readyState === 'live' ? 'text-emerald-400' : 'text-zinc-500'}`}>
                        {t.readyState}
                      </span>
                      <button
                        onClick={() => toggleTrack(t)}
                        className={`text-xs px-2 py-1 rounded border transition-colors ${
                          t.enabled
                            ? 'border-emerald-700 text-emerald-400 hover:bg-emerald-900/30'
                            : 'border-zinc-700 text-zinc-500 hover:bg-surface-2'
                        }`}
                      >
                        {t.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'getUserMedia basics' }}
      mdnLinks={[
        { label: 'getUserMedia()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia' },
        { label: 'MediaStreamTrack', href: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack' },
      ]}
    />
  );
}
