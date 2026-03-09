import type { SignalingMessage } from '@/types/signaling';

type MessageHandler = (msg: SignalingMessage) => void;
type StatusHandler = (status: 'connecting' | 'connected' | 'disconnected' | 'error') => void;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private url: string;
  private messageHandlers = new Set<MessageHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(url: string) {
    this.url = url;
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    this.notifyStatus('connecting');

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.notifyStatus('error');
      return;
    }

    this.ws.onopen = () => this.notifyStatus('connected');
    this.ws.onclose = () => {
      this.notifyStatus('disconnected');
      if (!this.destroyed) {
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };
    this.ws.onerror = () => this.notifyStatus('error');
    this.ws.onmessage = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(ev.data as string) as SignalingMessage;
        this.messageHandlers.forEach((h) => h(msg));
      } catch {
        console.error('[signaling] bad JSON', ev.data);
      }
    };
  }

  send(msg: SignalingMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('[signaling] not connected, dropping message', msg);
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private notifyStatus(s: Parameters<StatusHandler>[0]): void {
    this.statusHandlers.forEach((h) => h(s));
  }
}
