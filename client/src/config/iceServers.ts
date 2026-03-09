export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export const DEFAULT_PC_CONFIG: RTCConfiguration = {
  iceServers: DEFAULT_ICE_SERVERS,
};
