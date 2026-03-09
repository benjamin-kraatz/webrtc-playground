import { useRef, useState, useCallback, useEffect } from 'react';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import type { Logger } from '@/lib/logger';

export type IceMode = 'trickle' | 'complete';

export interface PcState {
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  iceGatheringState: RTCIceGatheringState;
  signalingState: RTCSignalingState;
  localDescription: RTCSessionDescription | null;
  remoteDescription: RTCSessionDescription | null;
  candidates: RTCIceCandidate[];
}

export interface UsePeerConnectionOptions {
  config?: RTCConfiguration;
  iceMode?: IceMode;
  logger?: Logger;
  onIceCandidate?: (candidate: RTCIceCandidate | null) => void;
  onTrack?: (event: RTCTrackEvent) => void;
  onDataChannel?: (channel: RTCDataChannel) => void;
  onNegotiationNeeded?: () => void;
}

export function usePeerConnection(options: UsePeerConnectionOptions = {}) {
  const {
    config = DEFAULT_PC_CONFIG,
    iceMode = 'trickle',
    logger,
    onIceCandidate,
    onTrack,
    onDataChannel,
    onNegotiationNeeded,
  } = options;

  // RTCPeerConnection lives in a ref — never in state
  const pc = useRef<RTCPeerConnection | null>(null);
  const gatheringCompleteResolve = useRef<((sdp: RTCSessionDescription) => void) | null>(null);

  const [state, setState] = useState<PcState>({
    connectionState: 'new',
    iceConnectionState: 'new',
    iceGatheringState: 'new',
    signalingState: 'stable',
    localDescription: null,
    remoteDescription: null,
    candidates: [],
  });

  const log = useCallback(
    (msg: string, data?: unknown) => logger?.info(msg, data),
    [logger]
  );

  const create = useCallback(() => {
    // Close any existing connection
    if (pc.current) {
      pc.current.close();
    }

    const conn = new RTCPeerConnection(config);
    pc.current = conn;

    conn.onconnectionstatechange = () => {
      log(`connectionState → ${conn.connectionState}`);
      setState((s) => ({ ...s, connectionState: conn.connectionState }));
    };

    conn.oniceconnectionstatechange = () => {
      log(`iceConnectionState → ${conn.iceConnectionState}`);
      setState((s) => ({ ...s, iceConnectionState: conn.iceConnectionState }));
    };

    conn.onicegatheringstatechange = () => {
      log(`iceGatheringState → ${conn.iceGatheringState}`);
      setState((s) => ({ ...s, iceGatheringState: conn.iceGatheringState }));
      if (conn.iceGatheringState === 'complete' && gatheringCompleteResolve.current) {
        gatheringCompleteResolve.current(conn.localDescription!);
        gatheringCompleteResolve.current = null;
      }
    };

    conn.onsignalingstatechange = () => {
      setState((s) => ({ ...s, signalingState: conn.signalingState }));
    };

    conn.onicecandidate = (ev) => {
      if (ev.candidate) {
        log(`ICE candidate: ${ev.candidate.type} ${ev.candidate.address ?? ''}`, ev.candidate.toJSON());
        setState((s) => ({ ...s, candidates: [...s.candidates, ev.candidate!] }));
      }
      if (iceMode === 'trickle' && onIceCandidate) {
        onIceCandidate(ev.candidate);
      }
    };

    if (onTrack) conn.ontrack = onTrack;
    if (onDataChannel) conn.ondatachannel = (ev: RTCDataChannelEvent) => onDataChannel(ev.channel);
    if (onNegotiationNeeded) conn.onnegotiationneeded = onNegotiationNeeded;

    setState({
      connectionState: 'new',
      iceConnectionState: 'new',
      iceGatheringState: 'new',
      signalingState: 'stable',
      localDescription: null,
      remoteDescription: null,
      candidates: [],
    });

    log('RTCPeerConnection created');
    return conn;
  }, [config, iceMode, log, onIceCandidate, onTrack, onDataChannel, onNegotiationNeeded]);

  const createOffer = useCallback(async (options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> => {
    const conn = pc.current!;
    const offer = await conn.createOffer(options);
    await conn.setLocalDescription(offer);
    log('Local description set (offer)');
    setState((s) => ({ ...s, localDescription: conn.localDescription }));

    if (iceMode === 'complete') {
      // Wait for ICE gathering to complete
      await new Promise<RTCSessionDescription>((resolve) => {
        if (conn.iceGatheringState === 'complete') {
          resolve(conn.localDescription!);
        } else {
          gatheringCompleteResolve.current = resolve;
        }
      });
      setState((s) => ({ ...s, localDescription: conn.localDescription }));
      return conn.localDescription!;
    }

    return conn.localDescription!;
  }, [iceMode, log]);

  const createAnswer = useCallback(async (): Promise<RTCSessionDescriptionInit> => {
    const conn = pc.current!;
    const answer = await conn.createAnswer();
    await conn.setLocalDescription(answer);
    log('Local description set (answer)');
    setState((s) => ({ ...s, localDescription: conn.localDescription }));

    if (iceMode === 'complete') {
      await new Promise<RTCSessionDescription>((resolve) => {
        if (conn.iceGatheringState === 'complete') {
          resolve(conn.localDescription!);
        } else {
          gatheringCompleteResolve.current = resolve;
        }
      });
      setState((s) => ({ ...s, localDescription: conn.localDescription }));
    }

    return conn.localDescription!;
  }, [iceMode, log]);

  const setRemoteDescription = useCallback(async (sdp: RTCSessionDescriptionInit): Promise<void> => {
    const conn = pc.current!;
    await conn.setRemoteDescription(new RTCSessionDescription(sdp));
    log('Remote description set');
    setState((s) => ({ ...s, remoteDescription: conn.remoteDescription }));
  }, [log]);

  const addIceCandidate = useCallback(async (candidate: RTCIceCandidateInit): Promise<void> => {
    const conn = pc.current!;
    await conn.addIceCandidate(new RTCIceCandidate(candidate));
    log('ICE candidate added');
  }, [log]);

  const close = useCallback(() => {
    pc.current?.close();
    pc.current = null;
    setState((s) => ({ ...s, connectionState: 'closed' }));
    log('RTCPeerConnection closed');
  }, [log]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      pc.current?.close();
      pc.current = null;
    };
  }, []);

  return {
    pc,
    state,
    create,
    createOffer,
    createAnswer,
    setRemoteDescription,
    addIceCandidate,
    close,
  };
}
