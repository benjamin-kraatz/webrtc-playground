import { useRef, useCallback } from 'react';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import type { Logger } from '@/lib/logger';

/**
 * Two RTCPeerConnections on the same page, wired internally.
 * No STUN/TURN needed for loopback — ICE negotiates via host candidates.
 */
export function useLoopback(logger?: Logger) {
  const pcA = useRef<RTCPeerConnection | null>(null);
  const pcB = useRef<RTCPeerConnection | null>(null);

  const log = (msg: string) => logger?.info(msg);

  const connect = useCallback(async (options?: {
    onTrackB?: (ev: RTCTrackEvent) => void;
    onDataChannelB?: (ev: RTCDataChannelEvent) => void;
    streamA?: MediaStream;
    dataChannelLabel?: string;
  }): Promise<{ pcA: RTCPeerConnection; pcB: RTCPeerConnection; dc?: RTCDataChannel }> => {
    // Close any existing connections
    pcA.current?.close();
    pcB.current?.close();

    const a = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const b = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.current = a;
    pcB.current = b;

    // Wire ICE candidates
    a.onicecandidate = (ev) => {
      if (ev.candidate) {
        b.addIceCandidate(ev.candidate).catch(console.error);
      }
    };
    b.onicecandidate = (ev) => {
      if (ev.candidate) {
        a.addIceCandidate(ev.candidate).catch(console.error);
      }
    };

    // State logging
    a.onconnectionstatechange = () => log(`[A] connectionState → ${a.connectionState}`);
    b.onconnectionstatechange = () => log(`[B] connectionState → ${b.connectionState}`);
    a.oniceconnectionstatechange = () => log(`[A] iceState → ${a.iceConnectionState}`);
    b.oniceconnectionstatechange = () => log(`[B] iceState → ${b.iceConnectionState}`);

    if (options?.onTrackB) b.ontrack = options.onTrackB;
    if (options?.onDataChannelB) b.ondatachannel = options.onDataChannelB;

    // Add media tracks from A if provided
    if (options?.streamA) {
      options.streamA.getTracks().forEach((track) => a.addTrack(track, options.streamA!));
      log('Added media tracks from A to B');
    }

    // Create data channel if requested
    let dc: RTCDataChannel | undefined;
    if (options?.dataChannelLabel) {
      dc = a.createDataChannel(options.dataChannelLabel);
    }

    // Negotiate
    const offer = await a.createOffer();
    await a.setLocalDescription(offer);
    await b.setRemoteDescription(offer);
    log('Offer set on both sides');

    const answer = await b.createAnswer();
    await b.setLocalDescription(answer);
    await a.setRemoteDescription(answer);
    log('Answer set on both sides — ICE negotiating...');

    return { pcA: a, pcB: b, dc };
  }, []);

  const disconnect = useCallback(() => {
    pcA.current?.close();
    pcB.current?.close();
    pcA.current = null;
    pcB.current = null;
    log('Loopback connection closed');
  }, []);

  return { pcA, pcB, connect, disconnect };
}
