import type WebSocket from 'ws';
import type { PeerInfo } from './types.js';

export class Peer {
  public readonly peerId: string;
  public readonly ws: WebSocket;
  public role?: 'broadcaster' | 'viewer';
  public roomId?: string;

  constructor(peerId: string, ws: WebSocket) {
    this.peerId = peerId;
    this.ws = ws;
  }

  send(msg: object): void {
    if (this.ws.readyState === 1 /* OPEN */) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  toInfo(): PeerInfo {
    return { peerId: this.peerId, role: this.role };
  }
}
