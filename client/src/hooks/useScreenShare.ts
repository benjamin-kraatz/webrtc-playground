import { useRef, useState, useCallback, useEffect } from 'react';
import type { Logger } from '@/lib/logger';

export function useScreenShare(logger?: Logger) {
  const stream = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async (options?: DisplayMediaStreamOptions): Promise<MediaStream> => {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
        ...options,
      });

      // Handle user clicking browser's "Stop sharing" button
      s.getVideoTracks()[0].onended = () => {
        stream.current = null;
        setActive(false);
        logger?.info('Screen share stopped by user');
      };

      stream.current = s;
      setActive(true);
      setError(null);
      logger?.success('Screen share started');
      return s;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      logger?.error(`getDisplayMedia failed: ${msg}`);
      throw err;
    }
  }, [logger]);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setActive(false);
    logger?.info('Screen share stopped');
  }, [logger]);

  useEffect(() => {
    return () => {
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { stream, active, error, start, stop };
}
