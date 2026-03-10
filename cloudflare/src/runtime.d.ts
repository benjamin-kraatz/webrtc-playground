interface DurableObjectId {}

interface DurableObjectStub {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectState {
  acceptWebSocket(webSocket: WebSocket): void;
  getWebSockets(): WebSocket[];
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

declare const WebSocketPair: {
  new (): WebSocketPair;
};

interface WebSocket {
  readonly readyState: number;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
  send(message: string | ArrayBuffer | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}
