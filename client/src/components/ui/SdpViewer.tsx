import { useState } from 'react';
import { clsx } from 'clsx';
import { parseSdp } from '@/lib/sdpParser';
import type { SdpMedia } from '@/lib/sdpParser';

const TYPE_COLORS: Record<string, string> = {
  audio: 'text-blue-400',
  video: 'text-violet-400',
  application: 'text-emerald-400',
};

const CAND_COLORS: Record<string, string> = {
  host: 'text-ice-host',
  srflx: 'text-ice-srflx',
  relay: 'text-ice-relay',
};

function MediaSection({ media, idx }: { media: SdpMedia; idx: number }) {
  const [open, setOpen] = useState(true);
  const typeColor = TYPE_COLORS[media.type] ?? 'text-zinc-400';

  return (
    <div className="border border-zinc-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-surface-2 hover:bg-surface-3 transition-colors text-left"
      >
        <svg
          className={clsx('w-4 h-4 text-zinc-500 transition-transform', open && 'rotate-90')}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span className={clsx('text-sm font-mono font-semibold', typeColor)}>
          m={media.type}
        </span>
        <span className="text-xs text-zinc-500">mid={media.mid ?? idx}</span>
        {media.direction && (
          <span className="text-xs text-zinc-500 ml-auto">{media.direction}</span>
        )}
      </button>

      {open && (
        <div className="p-3 space-y-3 bg-surface-1">
          {/* Codecs */}
          {media.codecs.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">Codecs</p>
              <div className="flex flex-wrap gap-1.5">
                {media.codecs.map((c) => (
                  <span key={c.payloadType} className="text-xs bg-surface-2 border border-zinc-700 rounded px-2 py-0.5 font-mono">
                    <span className="text-amber-400">{c.name}</span>
                    {c.clockRate && <span className="text-zinc-500">/{c.clockRate}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* ICE Candidates */}
          {media.candidates.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">ICE Candidates ({media.candidates.length})</p>
              <div className="space-y-1">
                {media.candidates.map((c, i) => (
                  <div key={i} className="text-xs font-mono flex gap-2">
                    <span className={clsx('shrink-0', CAND_COLORS[c.type] ?? 'text-zinc-400')}>{c.type}</span>
                    <span className="text-zinc-400">{c.protocol.toUpperCase()}</span>
                    <span className="text-zinc-300">{c.ip}:{c.port}</span>
                    <span className="text-zinc-600">priority={c.priority}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* RTP extensions */}
          {media.extmap.length > 0 && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">RTP Extensions</p>
              <div className="space-y-0.5">
                {media.extmap.map((e) => (
                  <div key={e.id} className="text-xs font-mono text-zinc-400">
                    <span className="text-zinc-500">{e.id}: </span>{e.uri}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface Props {
  sdp: string;
  className?: string;
}

export function SdpViewer({ sdp, className }: Props) {
  const parsed = parseSdp(sdp);

  return (
    <div className={clsx('space-y-2', className)}>
      {/* Session info */}
      <div className="bg-surface-1 border border-zinc-800 rounded-lg p-3 text-xs font-mono space-y-1">
        <p><span className="text-zinc-500">v=</span><span className="text-zinc-300">{parsed.version}</span></p>
        <p><span className="text-zinc-500">o=</span><span className="text-zinc-300">{parsed.origin}</span></p>
        {parsed.groups.map((g, i) => (
          <p key={i}><span className="text-zinc-500">group=</span><span className="text-zinc-300">{g}</span></p>
        ))}
        {parsed.fingerprint && (
          <p className="break-all">
            <span className="text-zinc-500">fingerprint=</span>
            <span className="text-zinc-300">{parsed.fingerprint}</span>
          </p>
        )}
      </div>

      {/* Media sections */}
      {parsed.media.map((m, i) => (
        <MediaSection key={i} media={m} idx={i} />
      ))}
    </div>
  );
}
