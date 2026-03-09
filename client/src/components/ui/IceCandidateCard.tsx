import { clsx } from 'clsx';

const TYPE_STYLES: Record<string, { label: string; cls: string }> = {
  host: { label: 'Host', cls: 'border-ice-host text-ice-host bg-blue-950/30' },
  srflx: { label: 'Server Reflexive', cls: 'border-ice-srflx text-ice-srflx bg-violet-950/30' },
  relay: { label: 'Relay (TURN)', cls: 'border-ice-relay text-ice-relay bg-pink-950/30' },
  prflx: { label: 'Peer Reflexive', cls: 'border-amber-500 text-amber-400 bg-amber-950/30' },
};

interface Props {
  candidate: RTCIceCandidate;
  className?: string;
}

export function IceCandidateCard({ candidate, className }: Props) {
  const type = candidate.type ?? 'host';
  const style = TYPE_STYLES[type] ?? TYPE_STYLES.host;

  return (
    <div className={clsx('border rounded-lg p-3 text-xs font-mono space-y-1', style.cls, className)}>
      <div className="flex items-center justify-between">
        <span className="font-semibold text-sm">{style.label}</span>
        <span className="text-zinc-500">{candidate.protocol?.toUpperCase()}</span>
      </div>
      <p>
        <span className="text-zinc-500">address: </span>
        <span>{candidate.address ?? '—'}:{candidate.port}</span>
      </p>
      {candidate.relatedAddress && (
        <p>
          <span className="text-zinc-500">related: </span>
          <span className="text-zinc-400">{candidate.relatedAddress}:{candidate.relatedPort}</span>
        </p>
      )}
      <p className="text-zinc-600 break-all">{candidate.candidate}</p>
    </div>
  );
}
