import { useRef, useState, useCallback } from 'react';
import type { Logger } from '@/lib/logger';

export type DataChannelState = 'closed' | 'connecting' | 'open' | 'closing';

export interface UseDataChannelOptions {
  label?: string;
  channelOptions?: RTCDataChannelInit;
  logger?: Logger;
  onMessage?: (ev: MessageEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export function useDataChannel(options: UseDataChannelOptions = {}) {
  const { label = 'data', channelOptions, logger, onMessage, onOpen, onClose } = options;

  const dc = useRef<RTCDataChannel | null>(null);
  const [channelState, setChannelState] = useState<DataChannelState>('closed');
  const [bufferedAmount, setBufferedAmount] = useState(0);

  const attach = useCallback((channel: RTCDataChannel) => {
    dc.current = channel;

    channel.onopen = () => {
      setChannelState('open');
      logger?.success(`DataChannel "${channel.label}" opened`);
      onOpen?.();
    };

    channel.onclose = () => {
      setChannelState('closed');
      logger?.info(`DataChannel "${channel.label}" closed`);
      onClose?.();
    };

    channel.onerror = (ev) => {
      const err = (ev as RTCErrorEvent).error;
      logger?.error(`DataChannel error: ${err?.message ?? 'unknown'}`);
    };

    channel.onmessage = (ev) => {
      setBufferedAmount(channel.bufferedAmount);
      onMessage?.(ev);
    };

    channel.bufferedAmountLowThreshold = 256 * 1024;
    channel.onbufferedamountlow = () => {
      setBufferedAmount(channel.bufferedAmount);
    };

    setChannelState(channel.readyState as DataChannelState);
    logger?.info(`DataChannel "${channel.label}" attached (state: ${channel.readyState})`);
  }, [logger, onMessage, onOpen, onClose]);

  const create = useCallback((pc: RTCPeerConnection) => {
    const channel = pc.createDataChannel(label, channelOptions);
    attach(channel);
    return channel;
  }, [label, channelOptions, attach]);

  const send = useCallback((data: string | ArrayBuffer | ArrayBufferView | Blob) => {
    if (dc.current?.readyState === 'open') {
      dc.current.send(data as string);
      setBufferedAmount(dc.current.bufferedAmount);
      return true;
    }
    return false;
  }, []);

  const close = useCallback(() => {
    dc.current?.close();
    dc.current = null;
  }, []);

  return { dc, channelState, bufferedAmount, create, attach, send, close };
}
