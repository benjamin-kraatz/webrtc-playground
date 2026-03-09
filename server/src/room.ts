import type { Peer } from './peer.js';

export class Room {
  public readonly roomId: string;
  private peers = new Map<string, Peer>();

  constructor(roomId: string) {
    this.roomId = roomId;
  }

  add(peer: Peer): void {
    this.peers.set(peer.peerId, peer);
  }

  remove(peerId: string): void {
    this.peers.delete(peerId);
  }

  get(peerId: string): Peer | undefined {
    return this.peers.get(peerId);
  }

  getAll(): Peer[] {
    return Array.from(this.peers.values());
  }

  getAllExcept(peerId: string): Peer[] {
    return this.getAll().filter((p) => p.peerId !== peerId);
  }

  size(): number {
    return this.peers.size;
  }

  isEmpty(): boolean {
    return this.peers.size === 0;
  }

  broadcast(msg: object, excludeId?: string): void {
    for (const peer of this.peers.values()) {
      if (peer.peerId !== excludeId) {
        peer.send(msg);
      }
    }
  }
}
