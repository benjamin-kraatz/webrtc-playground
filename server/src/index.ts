import { SignalingServer } from './signalingServer.js';

const PORT = parseInt(process.env.PORT ?? '3001', 10);

new SignalingServer(PORT);

console.log(`[server] WebRTC Playground signaling server running on port ${PORT}`);
