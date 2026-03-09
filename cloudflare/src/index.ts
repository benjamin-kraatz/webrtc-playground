interface PeerInfo {
  peerId: string;
  role?: 'broadcaster' | 'viewer';
}

type SignalingMessage =
  | { type: 'join'; roomId: string; peerId: string; role?: 'broadcaster' | 'viewer' }
  | { type: 'peer-joined'; peerId: string; peerCount: number }
  | { type: 'peer-left'; peerId: string }
  | { type: 'offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: 'peer-list'; peers: PeerInfo[] }
  | { type: 'error'; message: string };

interface SocketAttachment {
  joined: boolean;
  peerId: string;
  role?: 'broadcaster' | 'viewer';
}

interface Env {
  ASSETS: Fetcher;
  SIGNALING_ROOMS: DurableObjectNamespace;
}

function isRelayMessage(
  msg: SignalingMessage
): msg is Extract<SignalingMessage, { type: 'offer' | 'answer' | 'ice-candidate' }> {
  return msg.type === 'offer' || msg.type === 'answer' || msg.type === 'ice-candidate';
}

function json(message: SignalingMessage, init?: ResponseInit): Response {
  return new Response(JSON.stringify(message), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

function parseMessage(raw: string): SignalingMessage | null {
  try {
    return JSON.parse(raw) as SignalingMessage;
  } catch {
    return null;
  }
}

function normalizeRoomId(input: string | null): string | null {
  if (!input) return null;
  const roomId = input.trim();
  return roomId.length > 0 ? roomId : null;
}

function getAttachment(socket: WebSocket): SocketAttachment {
  const value = socket.deserializeAttachment();
  if (
    value &&
    typeof value === 'object' &&
    'peerId' in value &&
    typeof (value as { peerId: unknown }).peerId === 'string'
  ) {
    const attachment = value as SocketAttachment;
    return {
      joined: attachment.joined ?? false,
      peerId: attachment.peerId,
      role: attachment.role,
    };
  }

  const attachment: SocketAttachment = {
    joined: false,
    peerId: crypto.randomUUID(),
  };
  socket.serializeAttachment(attachment);
  return attachment;
}

function setAttachment(socket: WebSocket, attachment: SocketAttachment): void {
  socket.serializeAttachment(attachment);
}

export class SignalingRoom {
  private readonly state: DurableObjectState;
  private peers = new Map<string, { socket: WebSocket; role?: 'broadcaster' | 'viewer' }>();

  constructor(state: DurableObjectState) {
    this.state = state;

    for (const socket of this.state.getWebSockets()) {
      const attachment = getAttachment(socket);
      if (attachment.joined) {
        this.peers.set(attachment.peerId, { socket, role: attachment.role });
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return json({ type: 'error', message: 'Expected WebSocket upgrade' }, { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.state.acceptWebSocket(server);
    setAttachment(server, { joined: false, peerId: crypto.randomUUID() });

    return new Response(null, {
      status: 101,
      webSocket: client,
    } as ResponseInit & { webSocket: WebSocket });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    const parsed = parseMessage(raw);

    if (!parsed) {
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' } satisfies SignalingMessage));
      return;
    }

    if (parsed.type === 'join') {
      this.handleJoin(socket, parsed);
      return;
    }

    if (isRelayMessage(parsed)) {
      this.handleRelay(socket, parsed);
      return;
    }

    socket.send(JSON.stringify({ type: 'error', message: 'Unknown message type' } satisfies SignalingMessage));
  }

  webSocketClose(socket: WebSocket): void {
    this.handleDisconnect(socket);
  }

  webSocketError(socket: WebSocket): void {
    this.handleDisconnect(socket);
  }

  private handleJoin(socket: WebSocket, msg: Extract<SignalingMessage, { type: 'join' }>): void {
    const attachment = getAttachment(socket);
    const existingPeers = Array.from(this.peers.entries()).map(([peerId, peer]) => ({
      peerId,
      role: peer.role,
    }));

    socket.send(JSON.stringify({ type: 'peer-list', peers: existingPeers } satisfies SignalingMessage));

    const nextAttachment: SocketAttachment = {
      joined: true,
      peerId: attachment.peerId,
      role: msg.role,
    };

    setAttachment(socket, nextAttachment);
    this.peers.set(attachment.peerId, { socket, role: msg.role });
    this.broadcast(
      { type: 'peer-joined', peerId: attachment.peerId, peerCount: this.peers.size } satisfies SignalingMessage,
      attachment.peerId
    );
  }

  private handleRelay(
    socket: WebSocket,
    msg: Extract<SignalingMessage, { type: 'offer' | 'answer' | 'ice-candidate' }>
  ): void {
    const attachment = getAttachment(socket);
    if (!attachment.joined || !this.peers.has(attachment.peerId)) {
      socket.send(JSON.stringify({ type: 'error', message: 'Not in a room' } satisfies SignalingMessage));
      return;
    }

    const target = this.peers.get(msg.to);
    if (!target) {
      socket.send(JSON.stringify({ type: 'error', message: `Peer ${msg.to} not found` } satisfies SignalingMessage));
      return;
    }

    target.socket.send(JSON.stringify({ ...msg, from: attachment.peerId }));
  }

  private handleDisconnect(socket: WebSocket): void {
    const attachment = getAttachment(socket);
    if (!attachment.joined) return;
    if (!this.peers.delete(attachment.peerId)) return;

    this.broadcast({ type: 'peer-left', peerId: attachment.peerId } satisfies SignalingMessage, attachment.peerId);
    setAttachment(socket, { ...attachment, joined: false });
  }

  private broadcast(message: SignalingMessage, excludePeerId?: string): void {
    const payload = JSON.stringify(message);
    for (const [peerId, peer] of this.peers.entries()) {
      if (peerId !== excludePeerId) {
        peer.socket.send(payload);
      }
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      const roomId = normalizeRoomId(url.searchParams.get('roomId'));
      if (!roomId) {
        return json({ type: 'error', message: 'roomId query parameter is required' }, { status: 400 });
      }

      if (request.headers.get('Upgrade') !== 'websocket') {
        return json({ type: 'error', message: 'Expected WebSocket upgrade' }, { status: 426 });
      }

      const id = env.SIGNALING_ROOMS.idFromName(roomId);
      const stub = env.SIGNALING_ROOMS.get(id);
      return stub.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
