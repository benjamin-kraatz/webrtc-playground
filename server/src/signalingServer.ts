import { WebSocketServer } from "ws";
import type { WebSocket, RawData } from "ws";
import { v4 as uuidv4 } from "uuid";
import { Peer } from "./peer.js";
import { Room } from "./room.js";
import type { SignalingMessage } from "./types.js";

export class SignalingServer {
  private wss: WebSocketServer;
  private rooms = new Map<string, Room>();
  private peerToRoom = new Map<string, string>();

  constructor(port: number) {
    this.wss = new WebSocketServer({ port, host: "0.0.0.0" });
    this.wss.on("connection", (ws: WebSocket) => this.onConnection(ws));
    console.log(
      `[signaling] WebSocket server listening on ws://localhost:${port}`,
    );
  }

  private onConnection(ws: WebSocket): void {
    const peerId = uuidv4();
    const peer = new Peer(peerId, ws);
    console.log(`[signaling] peer connected: ${peerId}`);

    ws.on("message", (data: RawData) => this.onMessage(peer, data));
    ws.on("close", () => this.onClose(peer));
    ws.on("error", (err) =>
      console.error(`[signaling] ws error for ${peerId}:`, err),
    );
  }

  private onMessage(peer: Peer, data: RawData): void {
    let msg: SignalingMessage;
    try {
      msg = JSON.parse(data.toString()) as SignalingMessage;
    } catch {
      peer.send({ type: "error", message: "Invalid JSON" });
      return;
    }

    switch (msg.type) {
      case "join":
        this.handleJoin(peer, msg);
        break;
      case "offer":
      case "answer":
      case "ice-candidate":
        this.handleRelay(peer, msg);
        break;
      default:
        peer.send({ type: "error", message: `Unknown message type` });
    }
  }

  private handleJoin(
    peer: Peer,
    msg: Extract<SignalingMessage, { type: "join" }>,
  ): void {
    const { roomId, role } = msg;
    peer.role = role;
    peer.roomId = roomId;

    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Room(roomId);
      this.rooms.set(roomId, room);
    }

    // Notify existing peers about the new peer
    const existingPeers = room.getAll();
    room.broadcast({
      type: "peer-joined",
      peerId: peer.peerId,
      peerCount: room.size() + 1,
    });

    room.add(peer);
    this.peerToRoom.set(peer.peerId, roomId);

    // Send new peer the current peer list
    peer.send({
      type: "peer-list",
      peers: existingPeers.map((p) => p.toInfo()),
    });

    console.log(
      `[signaling] ${peer.peerId} joined room ${roomId} (${room.size()} peers)`,
    );
  }

  private handleRelay(
    peer: Peer,
    msg: Extract<
      SignalingMessage,
      { type: "offer" | "answer" | "ice-candidate" }
    >,
  ): void {
    const roomId = this.peerToRoom.get(peer.peerId);
    if (!roomId) {
      peer.send({ type: "error", message: "Not in a room" });
      return;
    }

    const room = this.rooms.get(roomId);
    if (!room) return;

    const target = room.get(msg.to);
    if (!target) {
      peer.send({ type: "error", message: `Peer ${msg.to} not found` });
      return;
    }

    // Pure relay — just forward with from field set
    target.send({ ...msg, from: peer.peerId });
  }

  private onClose(peer: Peer): void {
    const roomId = this.peerToRoom.get(peer.peerId);
    if (roomId) {
      const room = this.rooms.get(roomId);
      if (room) {
        room.remove(peer.peerId);
        room.broadcast({ type: "peer-left", peerId: peer.peerId });
        if (room.isEmpty()) {
          this.rooms.delete(roomId);
          console.log(`[signaling] room ${roomId} closed (empty)`);
        }
      }
      this.peerToRoom.delete(peer.peerId);
    }
    console.log(`[signaling] peer disconnected: ${peer.peerId}`);
  }
}
