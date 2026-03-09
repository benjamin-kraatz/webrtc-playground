import { useState, useCallback } from 'react';

export interface DeviceInfo {
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

export function useDevices() {
  const [devices, setDevices] = useState<DeviceInfo>({
    cameras: [],
    microphones: [],
    speakers: [],
  });

  const enumerate = useCallback(async () => {
    // Labels are empty until permission is granted — caller should request media first
    const allDevices = await navigator.mediaDevices.enumerateDevices();
    setDevices({
      cameras: allDevices.filter((d) => d.kind === 'videoinput'),
      microphones: allDevices.filter((d) => d.kind === 'audioinput'),
      speakers: allDevices.filter((d) => d.kind === 'audiooutput'),
    });
    return allDevices;
  }, []);

  return { devices, enumerate };
}
