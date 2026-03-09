import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

export interface LoopbackDataPair {
  pcA: RTCPeerConnection;
  pcB: RTCPeerConnection;
  dcA: RTCDataChannel;
  dcB: RTCDataChannel;
  close: () => void;
}

function waitForOpen(dc: RTCDataChannel): Promise<void> {
  if (dc.readyState === 'open') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      dc.removeEventListener('open', onOpen);
      dc.removeEventListener('error', onError as EventListener);
      resolve();
    };
    const onError = () => {
      dc.removeEventListener('open', onOpen);
      dc.removeEventListener('error', onError as EventListener);
      reject(new Error(`Data channel "${dc.label}" failed to open.`));
    };
    dc.addEventListener('open', onOpen);
    dc.addEventListener('error', onError as EventListener);
  });
}

export async function createLoopbackDataPair(
  label = 'wild-demo',
  options: RTCDataChannelInit = {}
): Promise<LoopbackDataPair> {
  const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
  const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);

  pcA.onicecandidate = (ev) => {
    if (ev.candidate) pcB.addIceCandidate(ev.candidate).catch(() => {});
  };
  pcB.onicecandidate = (ev) => {
    if (ev.candidate) pcA.addIceCandidate(ev.candidate).catch(() => {});
  };

  const dcBPromise = new Promise<RTCDataChannel>((resolve) => {
    pcB.ondatachannel = (ev) => resolve(ev.channel);
  });

  const dcA = pcA.createDataChannel(label, options);

  const offer = await pcA.createOffer();
  await pcA.setLocalDescription(offer);
  await pcB.setRemoteDescription(offer);
  const answer = await pcB.createAnswer();
  await pcB.setLocalDescription(answer);
  await pcA.setRemoteDescription(answer);

  const dcB = await dcBPromise;
  await Promise.all([waitForOpen(dcA), waitForOpen(dcB)]);

  return {
    pcA,
    pcB,
    dcA,
    dcB,
    close: () => {
      dcA.close();
      dcB.close();
      pcA.close();
      pcB.close();
    },
  };
}
