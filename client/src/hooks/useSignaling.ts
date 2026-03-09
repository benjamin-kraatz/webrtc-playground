import { useRef, useState, useCallback, useEffect } from 'react';
import { SignalingClient } from '@/lib/signaling';
import type { SignalingMessage, PeerInfo } from '@/types/signaling';
import type { Logger } from '@/lib/logger';

export type SignalingStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'offline';

export interface UseSignalingOptions {
  url?: string;
  logger?: Logger;
  onMessage?: (msg: SignalingMessage) => void;
}

interface PendingJoin {
  roomId: string;
  peerId: string;
  role?: 'broadcaster' | 'viewer';
}

function buildSignalingUrl(baseUrl: string, roomId?: string): string {
  const resolvedUrl = baseUrl.startsWith('ws://') || baseUrl.startsWith('wss://')
    ? new URL(baseUrl)
    : new URL(baseUrl, window.location.origin);

  if (resolvedUrl.protocol === 'http:' || resolvedUrl.protocol === 'https:') {
    resolvedUrl.protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  }

  if (roomId) {
    resolvedUrl.searchParams.set('roomId', roomId);
  } else {
    resolvedUrl.searchParams.delete('roomId');
  }

  return resolvedUrl.toString();
}

function hasRoomIdInBaseUrl(baseUrl: string): boolean {
  const resolvedUrl = baseUrl.startsWith('ws://') || baseUrl.startsWith('wss://')
    ? new URL(baseUrl)
    : new URL(baseUrl, window.location.origin);

  return resolvedUrl.searchParams.has('roomId');
}

export function useSignaling(options: UseSignalingOptions = {}) {
  const { url = import.meta.env.VITE_SIGNALING_URL ?? '/ws', logger } = options;
  // Use a ref to hold onMessage so it's always fresh without being a dep
  const onMessageRef = useRef(options.onMessage);
  useEffect(() => { onMessageRef.current = options.onMessage; }, [options.onMessage]);

  const client = useRef<SignalingClient | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const pendingJoinRef = useRef<PendingJoin | null>(null);
  const [status, setStatus] = useState<SignalingStatus>('disconnected');
  const [peers, setPeers] = useState<PeerInfo[]>([]);

  // Stable send — reads from client ref, never changes identity
  const send = useCallback((msg: SignalingMessage) => {
    client.current?.send(msg);
  }, []);

  const connect = useCallback((roomId?: string) => {
    if (!roomId && !hasRoomIdInBaseUrl(url)) {
      setStatus('disconnected');
      return;
    }

    if (client.current) {
      client.current.disconnect();
    }

    const wsUrl = buildSignalingUrl(url, roomId);
    const c = new SignalingClient(wsUrl);
    client.current = c;
    currentUrlRef.current = wsUrl;

    c.onStatus((s) => {
      setStatus(s as SignalingStatus);
      logger?.info(`Signaling: ${s}`);
      if (s === 'connected' && pendingJoinRef.current) {
        c.send({ type: 'join', ...pendingJoinRef.current });
        logger?.info(`Joined room: ${pendingJoinRef.current.roomId} as ${pendingJoinRef.current.peerId}`);
        pendingJoinRef.current = null;
      }
      if (s === 'error') {
        setStatus('offline');
        logger?.warn('Signaling server unreachable — some demos require the server');
      }
    });

    c.onMessage((msg) => {
      if (msg.type === 'peer-list') {
        setPeers(msg.peers);
      } else if (msg.type === 'peer-joined') {
        setPeers((p) => [...p, { peerId: msg.peerId }]);
        logger?.info(`Peer joined: ${msg.peerId} (${msg.peerCount} total)`);
      } else if (msg.type === 'peer-left') {
        setPeers((p) => p.filter((peer) => peer.peerId !== msg.peerId));
        logger?.info(`Peer left: ${msg.peerId}`);
      }
      onMessageRef.current?.(msg);
    });

    c.connect();
  }, [url, logger]);

  const join = useCallback((roomId: string, peerId: string, role?: 'broadcaster' | 'viewer') => {
    const nextJoin = { roomId, peerId, role };
    const expectedUrl = buildSignalingUrl(url, roomId);

    if (currentUrlRef.current !== expectedUrl || !client.current?.isOpen()) {
      pendingJoinRef.current = nextJoin;
      connect(roomId);
      return;
    }

    client.current.send({ type: 'join', ...nextJoin });
    logger?.info(`Joined room: ${roomId} as ${peerId}`);
  }, [connect, logger, url]);

  const disconnect = useCallback(() => {
    client.current?.disconnect();
    client.current = null;
    currentUrlRef.current = null;
    pendingJoinRef.current = null;
    setStatus('disconnected');
    setPeers([]);
  }, []);

  useEffect(() => {
    return () => {
      client.current?.disconnect();
    };
  }, []);

  return { status, peers, connect, join, send, disconnect };
}
