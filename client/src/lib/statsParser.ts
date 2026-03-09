import type { DerivedStats } from '@/types/stats';

// TypeScript's lib.dom.d.ts doesn't include RTCIceCandidateStats, use a loose type
interface RtcCandidateStat extends RTCStats {
  candidateType?: string;
}

interface Snapshot {
  bytesReceived: number;
  bytesSent: number;
  packetsReceived: number;
  packetsLost: number;
  timestamp: number;
}

let prev: Snapshot | null = null;

export function parseStats(report: RTCStatsReport): DerivedStats {
  let inbound: RTCInboundRtpStreamStats | null = null;
  let outbound: RTCOutboundRtpStreamStats | null = null;
  let pair: RTCIceCandidatePairStats | null = null;
  let localCandidate: RtcCandidateStat | null = null;
  let remoteCandidate: RtcCandidateStat | null = null;

  report.forEach((stat) => {
    if (stat.type === 'inbound-rtp' && (stat as RTCInboundRtpStreamStats).kind === 'video') {
      inbound = stat as RTCInboundRtpStreamStats;
    } else if (stat.type === 'outbound-rtp') {
      outbound = stat as RTCOutboundRtpStreamStats;
    } else if (stat.type === 'candidate-pair' && (stat as RTCIceCandidatePairStats).state === 'succeeded') {
      pair = stat as RTCIceCandidatePairStats;
    } else if (stat.type === 'local-candidate') {
      localCandidate = stat as RtcCandidateStat;
    } else if (stat.type === 'remote-candidate') {
      remoteCandidate = stat as RtcCandidateStat;
    }
  });

  const now = Date.now();
  const ib = inbound as RTCInboundRtpStreamStats | null;
  const ob = outbound as RTCOutboundRtpStreamStats | null;

  const bytesReceived = ib?.bytesReceived ?? 0;
  const bytesSent = ob?.bytesSent ?? 0;
  const packetsReceived = ib?.packetsReceived ?? 0;
  const packetsLost = ib?.packetsLost ?? 0;

  let bitrateInKbps = 0;
  let bitrateOutKbps = 0;

  if (prev) {
    const dtMs = now - prev.timestamp;
    if (dtMs > 0) {
      bitrateInKbps = ((bytesReceived - prev.bytesReceived) * 8) / dtMs;
      bitrateOutKbps = ((bytesSent - prev.bytesSent) * 8) / dtMs;
    }
  }

  prev = { bytesReceived, bytesSent, packetsReceived, packetsLost, timestamp: now };

  const totalPackets = packetsReceived + packetsLost;
  const packetLossPercent = totalPackets > 0 ? (packetsLost / totalPackets) * 100 : 0;

  const p = pair as RTCIceCandidatePairStats | null;
  const lc = localCandidate as RtcCandidateStat | null;
  const rc = remoteCandidate as RtcCandidateStat | null;

  return {
    timestamp: now,
    bytesReceived,
    packetsReceived,
    packetsLost,
    jitter: ib?.jitter ?? 0,
    frameWidth: ib?.frameWidth,
    frameHeight: ib?.frameHeight,
    framesPerSecond: ib?.framesPerSecond,
    bytesSent,
    packetsSent: ob?.packetsSent ?? 0,
    bitrateInKbps: Math.round(bitrateInKbps * 10) / 10,
    bitrateOutKbps: Math.round(bitrateOutKbps * 10) / 10,
    packetLossPercent: Math.round(packetLossPercent * 10) / 10,
    currentRoundTripTime: p?.currentRoundTripTime,
    localCandidateType: lc?.candidateType,
    remoteCandidateType: rc?.candidateType,
  };
}

export function resetStatsParser(): void {
  prev = null;
}
