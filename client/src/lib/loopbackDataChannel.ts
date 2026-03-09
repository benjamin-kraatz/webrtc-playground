import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import type { Logger } from '@/lib/logger';

export interface LoopbackDataChannelPair {
  pcA: RTCPeerConnection;
  pcB: RTCPeerConnection;
  channelA: RTCDataChannel;
  channelB: RTCDataChannel;
  close: () => void;
}

function waitForChannelOpen(channel: RTCDataChannel): Promise<void> {
  if (channel.readyState === 'open') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error(`Failed to open data channel "${channel.label}"`));
    };
    const cleanup = () => {
      channel.removeEventListener('open', handleOpen);
      channel.removeEventListener('error', handleError);
    };

    channel.addEventListener('open', handleOpen, { once: true });
    channel.addEventListener('error', handleError, { once: true });
  });
}

export async function createLoopbackDataChannelPair(
  label: string,
  options?: {
    logger?: Logger;
    dataChannelInit?: RTCDataChannelInit;
  }
): Promise<LoopbackDataChannelPair> {
  const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
  const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);

  const log = (message: string) => options?.logger?.info(message);

  pcA.onicecandidate = (event) => {
    if (event.candidate) {
      void pcB.addIceCandidate(event.candidate);
    }
  };

  pcB.onicecandidate = (event) => {
    if (event.candidate) {
      void pcA.addIceCandidate(event.candidate);
    }
  };

  pcA.onconnectionstatechange = () => log(`[A] connectionState -> ${pcA.connectionState}`);
  pcB.onconnectionstatechange = () => log(`[B] connectionState -> ${pcB.connectionState}`);

  const channelA = pcA.createDataChannel(label, options?.dataChannelInit);
  const channelBPromise = new Promise<RTCDataChannel>((resolve) => {
    pcB.ondatachannel = (event) => resolve(event.channel);
  });

  const offer = await pcA.createOffer();
  await pcA.setLocalDescription(offer);
  await pcB.setRemoteDescription(offer);

  const answer = await pcB.createAnswer();
  await pcB.setLocalDescription(answer);
  await pcA.setRemoteDescription(answer);

  const channelB = await channelBPromise;
  await Promise.all([waitForChannelOpen(channelA), waitForChannelOpen(channelB)]);

  log(`Loopback channel "${label}" connected`);

  return {
    pcA,
    pcB,
    channelA,
    channelB,
    close: () => {
      channelA.close();
      channelB.close();
      pcA.close();
      pcB.close();
    },
  };
}
