import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';

interface Props {
  stream: MediaStream | null;
  muted?: boolean;
  label?: string;
  className?: string;
  mirror?: boolean;
}

export function VideoPlayer({ stream, muted = false, label, className, mirror = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
  }, [stream]);

  return (
    <div className={clsx('relative bg-zinc-900 rounded-lg overflow-hidden', className)}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={clsx(
          'w-full h-full object-cover',
          mirror && 'scale-x-[-1]'
        )}
      />
      {!stream && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-zinc-600">
            <svg className="w-12 h-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M4 8h8a2 2 0 012 2v4a2 2 0 01-2 2H4a2 2 0 01-2-2v-4a2 2 0 012-2z" />
            </svg>
            <p className="text-sm">No video</p>
          </div>
        </div>
      )}
      {label && (
        <div className="absolute bottom-2 left-2 bg-black/60 text-xs text-zinc-300 px-2 py-0.5 rounded">
          {label}
        </div>
      )}
    </div>
  );
}
