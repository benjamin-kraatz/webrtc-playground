import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';

interface Device {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

const CODE = `// Labels are empty until permission is granted!
// Step 1: Request permission to unlock device labels
const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
stream.getTracks().forEach(t => t.stop()); // Release immediately

// Step 2: Now enumerate with real labels
const devices = await navigator.mediaDevices.enumerateDevices();
const cameras = devices.filter(d => d.kind === 'videoinput');
const mics    = devices.filter(d => d.kind === 'audioinput');

// Step 3: Use specific device by deviceId
const stream2 = await navigator.mediaDevices.getUserMedia({
  video: { deviceId: { exact: selectedCameraId } },
  audio: { deviceId: { exact: selectedMicId } }
});`;

export default function DevicePicker() {
  const logger = useMemo(() => new Logger(), []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedMic, setSelectedMic] = useState('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const cameras = devices.filter((d) => d.kind === 'videoinput');
  const mics = devices.filter((d) => d.kind === 'audioinput');
  const speakers = devices.filter((d) => d.kind === 'audiooutput');

  const enumerate = async () => {
    // First request permission to unlock labels
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      s.getTracks().forEach((t) => t.stop());
      setPermissionGranted(true);
      logger.success('Permission granted — enumerating devices...');
    } catch {
      logger.warn('Permission denied — devices will have empty labels');
    }
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices(all.map((d) => ({ deviceId: d.deviceId, label: d.label || `${d.kind} (${d.deviceId.slice(0, 8)}...)`, kind: d.kind })));
    logger.info(`Found ${all.length} devices`);
    all.forEach((d) => logger.debug(`${d.kind}: ${d.label || '(no label)'}`));
  };

  const applySelection = async () => {
    stream?.getTracks().forEach((t) => t.stop());
    try {
      const constraints: MediaStreamConstraints = {
        video: selectedCamera ? { deviceId: { exact: selectedCamera } } : true,
        audio: selectedMic ? { deviceId: { exact: selectedMic } } : true,
      };
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      if (videoRef.current) videoRef.current.srcObject = s;
      setStream(s);
      logger.success(`Switched to selected devices`);
      s.getTracks().forEach((t) => logger.info(`Active: ${t.kind} — ${t.label}`));
    } catch (e) {
      logger.error(`Failed: ${e}`);
    }
  };

  return (
    <DemoLayout
      title="Device Picker"
      difficulty="beginner"
      description="Enumerate all cameras and microphones and switch between them."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">navigator.mediaDevices.enumerateDevices()</code> returns
            all available media devices, but labels are intentionally hidden until the user grants
            camera/mic permission — this is a privacy protection.
          </p>
          <p>
            Once permission is granted, you can select a specific device using its
            <code className="mx-1 text-xs bg-surface-2 px-1 py-0.5 rounded">deviceId</code> in the
            constraints object.
          </p>
        </div>
      }
      demo={
        <div className="space-y-5">
          <button onClick={enumerate} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
            {permissionGranted ? 'Re-enumerate Devices' : 'Grant Permission & Enumerate'}
          </button>

          {devices.length > 0 && (
            <div className="space-y-4">
              {cameras.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-500 mb-2">CAMERAS ({cameras.length})</p>
                  <div className="space-y-1.5">
                    {cameras.map((d) => (
                      <label key={d.deviceId} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="camera"
                          value={d.deviceId}
                          checked={selectedCamera === d.deviceId}
                          onChange={() => setSelectedCamera(d.deviceId)}
                          className="accent-blue-400"
                        />
                        <span className="text-sm text-zinc-300">{d.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {mics.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-500 mb-2">MICROPHONES ({mics.length})</p>
                  <div className="space-y-1.5">
                    {mics.map((d) => (
                      <label key={d.deviceId} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="mic"
                          value={d.deviceId}
                          checked={selectedMic === d.deviceId}
                          onChange={() => setSelectedMic(d.deviceId)}
                          className="accent-blue-400"
                        />
                        <span className="text-sm text-zinc-300">{d.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {speakers.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-zinc-500 mb-2">SPEAKERS ({speakers.length})</p>
                  <div className="space-y-1">
                    {speakers.map((d) => (
                      <p key={d.deviceId} className="text-sm text-zinc-400">{d.label}</p>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={applySelection} className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg">
                Apply Selection
              </button>
            </div>
          )}

          <div className="aspect-video max-w-lg bg-zinc-900 rounded-xl overflow-hidden mx-auto">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Enumerate then select a device' }}
      mdnLinks={[
        { label: 'enumerateDevices()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices' },
      ]}
    />
  );
}
