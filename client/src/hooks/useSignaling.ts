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

export function useSignaling(options: UseSignalingOptions = {}) {
  const { url = '/ws', logger } = options;
  // Use a ref to hold onMessage so it's always fresh without being a dep
  const onMessageRef = useRef(options.onMessage);
  useEffect(() => { onMessageRef.current = options.onMessage; }, [options.onMessage]);

  const client = useRef<SignalingClient | null>(null);
  const [status, setStatus] = useState<SignalingStatus>('disconnected');
  const [peers, setPeers] = useState<PeerInfo[]>([]);

  // Stable send — reads from client ref, never changes identity
  const send = useCallback((msg: SignalingMessage) => {
    client.current?.send(msg);
  }, []);

  const connect = useCallback(() => {
    if (client.current) {
      client.current.disconnect();
    }

    const wsUrl = url.startsWith('ws') ? url : `ws://${window.location.host}${url}`;
    const c = new SignalingClient(wsUrl);
    client.current = c;

    c.onStatus((s) => {
      setStatus(s as SignalingStatus);
      logger?.info(`Signaling: ${s}`);
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
    client.current?.send({ type: 'join', roomId, peerId, role });
    logger?.info(`Joined room: ${roomId} as ${peerId}`);
  }, [logger]);

  const disconnect = useCallback(() => {
    client.current?.disconnect();
    client.current = null;
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
