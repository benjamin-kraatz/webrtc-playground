export interface DerivedStats {
  timestamp: number;
  // Inbound
  bytesReceived: number;
  packetsReceived: number;
  packetsLost: number;
  jitter: number;
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
  // Outbound
  bytesSent: number;
  packetsSent: number;
  // Derived deltas (per second)
  bitrateInKbps: number;
  bitrateOutKbps: number;
  packetLossPercent: number;
  // Round-trip
  currentRoundTripTime?: number;
  // Candidates
  localCandidateType?: string;
  remoteCandidateType?: string;
}
