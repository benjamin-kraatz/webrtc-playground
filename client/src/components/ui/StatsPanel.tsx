import type { DerivedStats } from '@/types/stats';

interface Props {
  stats: DerivedStats | null;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-surface-2 rounded-lg p-3">
      <p className="text-xs text-zinc-500 mb-1">{label}</p>
      <p className="text-sm font-mono font-semibold text-zinc-200">{value}</p>
    </div>
  );
}

export function StatsPanel({ stats }: Props) {
  if (!stats) {
    return (
      <div className="text-sm text-zinc-600 italic">No stats yet — connect first</div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
      <Stat label="Bitrate In" value={`${stats.bitrateInKbps} kbps`} />
      <Stat label="Bitrate Out" value={`${stats.bitrateOutKbps} kbps`} />
      <Stat label="Packet Loss" value={`${stats.packetLossPercent}%`} />
      {stats.currentRoundTripTime !== undefined && (
        <Stat label="RTT" value={`${(stats.currentRoundTripTime * 1000).toFixed(0)} ms`} />
      )}
      {stats.jitter !== undefined && (
        <Stat label="Jitter" value={`${(stats.jitter * 1000).toFixed(1)} ms`} />
      )}
      {stats.framesPerSecond !== undefined && (
        <Stat label="FPS" value={stats.framesPerSecond} />
      )}
      {stats.frameWidth && stats.frameHeight && (
        <Stat label="Resolution" value={`${stats.frameWidth}×${stats.frameHeight}`} />
      )}
      {stats.localCandidateType && (
        <Stat label="ICE Type" value={`${stats.localCandidateType} / ${stats.remoteCandidateType}`} />
      )}
    </div>
  );
}
