export interface PeerInfo {
  peerId: string;
  role?: 'broadcaster' | 'viewer';
}

export type SignalingMessage =
  | { type: 'join'; roomId: string; peerId: string; role?: 'broadcaster' | 'viewer' }
  | { type: 'peer-joined'; peerId: string; peerCount: number }
  | { type: 'peer-left'; peerId: string }
  | { type: 'offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: 'peer-list'; peers: PeerInfo[] }
  | { type: 'error'; message: string };
