import { useRef, useState, useCallback, useEffect } from 'react';
import type { Logger } from '@/lib/logger';

export interface UseMediaStreamOptions {
  logger?: Logger;
}

export function useMediaStream(options: UseMediaStreamOptions = {}) {
  const { logger } = options;
  const stream = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useCallback(async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
    try {
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      // Stop previous tracks
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = s;
      setActive(true);
      setError(null);
      logger?.success('Media stream acquired');
      return s;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      logger?.error(`getUserMedia failed: ${msg}`);
      throw err;
    }
  }, [logger]);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setActive(false);
    logger?.info('Media stream stopped');
  }, [logger]);

  useEffect(() => {
    return () => {
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { stream, active, error, request, stop };
}
