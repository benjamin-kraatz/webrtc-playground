import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { fileToChunks, encodeChunk, decodeChunk, assembleChunks, HIGH_WATERMARK } from '@/lib/chunker';
import { sha256, sha256File } from '@/lib/checksum';

const CODE = `// Backpressure: pause when buffer is too full
const HIGH = 1024 * 1024; // 1MB
dc.bufferedAmountLowThreshold = 256 * 1024;

let paused = false;
dc.onbufferedamountlow = () => {
  if (paused) { paused = false; sendNextChunk(); }
};

async function sendChunks(chunks) {
  for (const chunk of chunks) {
    if (dc.bufferedAmount > HIGH) {
      paused = true;
      await new Promise(r => dc.onbufferedamountlow = r);
    }
    dc.send(encodeChunk(chunk)); // ArrayBuffer
  }
}`;

export default function FileTransfer() {
  const logger = useMemo(() => new Logger(), []);
  const [localSdp, setLocalSdp] = useState('');
  const [remoteSdpInput, setRemoteSdpInput] = useState('');
  const [role, setRole] = useState<'sender' | 'receiver' | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [received, setReceived] = useState<{ url: string; name: string } | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const receivedChunks = useRef<ReturnType<typeof decodeChunk>[]>([]);
  const fileMetaRef = useRef<{ name: string; size: number; type: string; totalChunks: number } | null>(null);

  const gatherComplete = (pc: RTCPeerConnection): Promise<string> =>
    new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') { resolve(pc.localDescription!.sdp); return; }
      const h = () => { if (pc.iceGatheringState === 'complete') { resolve(pc.localDescription!.sdp); pc.removeEventListener('icegatheringstatechange', h); } };
      pc.addEventListener('icegatheringstatechange', h);
    });

  const startSender = async () => {
    setRole('sender');
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcRef.current = pc;
    const dc = pc.createDataChannel('file', { ordered: true });
    dcRef.current = dc;
    dc.bufferedAmountLowThreshold = 256 * 1024;
    dc.onopen = () => { setStatus('Channel open — select a file to send'); logger.success('Channel open'); };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdp = await gatherComplete(pc);
    setLocalSdp(sdp);
    logger.success('Offer ready — copy to receiver tab');
  };

  const startReceiver = async () => {
    setRole('receiver');
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcRef.current = pc;

    pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      dcRef.current = dc;
      dc.binaryType = 'arraybuffer';
      dc.onmessage = (e) => {
        const data = e.data as string | ArrayBuffer;
        if (typeof data === 'string') {
          const meta = JSON.parse(data);
          fileMetaRef.current = meta;
          receivedChunks.current = [];
          logger.info(`Receiving: ${meta.name} (${(meta.size / 1024).toFixed(1)}KB, ${meta.totalChunks} chunks)`);
        } else {
          const chunk = decodeChunk(data);
          receivedChunks.current.push(chunk);
          setProgress(Math.round((receivedChunks.current.length / (fileMetaRef.current?.totalChunks ?? 1)) * 100));
          if (receivedChunks.current.length === fileMetaRef.current?.totalChunks) {
            const assembled = assembleChunks(receivedChunks.current);
            sha256(assembled).then((hash) => {
              logger.success(`File assembled! SHA-256: ${hash.slice(0, 16)}...`);
              const blob = new Blob([assembled], { type: fileMetaRef.current?.type });
              setReceived({ url: URL.createObjectURL(blob), name: fileMetaRef.current?.name ?? 'file' });
              setStatus(`Received ${(assembled.byteLength / 1024).toFixed(1)}KB`);
            });
          }
        }
      };
      logger.success('Data channel received');
    };

    await pc.setRemoteDescription({ type: 'offer', sdp: remoteSdpInput });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const sdp = await gatherComplete(pc);
    setLocalSdp(sdp);
    logger.success('Answer ready — copy to sender tab');
  };

  const applyAnswer = async () => {
    await pcRef.current!.setRemoteDescription({ type: 'answer', sdp: remoteSdpInput });
    logger.success('Answer applied! ICE negotiating...');
  };

  const sendFile = async () => {
    if (!file || dcRef.current?.readyState !== 'open') return;
    const dc = dcRef.current;
    dc.binaryType = 'arraybuffer';

    const hash = await sha256File(file);
    logger.info(`Sending: ${file.name} (${(file.size / 1024).toFixed(1)}KB) SHA-256: ${hash.slice(0, 16)}...`);
    dc.send(JSON.stringify({ name: file.name, size: file.size, type: file.type, totalChunks: Math.ceil(file.size / (16 * 1024)) }));

    const chunks = await fileToChunks(file);
    let i = 0;
    const sendNext = () => {
      while (i < chunks.length) {
        if (dc.bufferedAmount > HIGH_WATERMARK) {
          dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; sendNext(); };
          return;
        }
        dc.send(encodeChunk(chunks[i]));
        setProgress(Math.round(((i + 1) / chunks.length) * 100));
        i++;
      }
      logger.success('File sent!');
      setStatus('Sent!');
    };
    sendNext();
  };

  const reset = () => {
    pcRef.current?.close();
    setRole(null);
    setFile(null);
    setProgress(0);
    setStatus('');
    setReceived(null);
    setLocalSdp('');
    setRemoteSdpInput('');
  };

  return (
    <DemoLayout
      title="File Transfer"
      difficulty="intermediate"
      description="Transfer files between tabs with backpressure control and SHA-256 verification."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            RTCDataChannel can transfer binary data (ArrayBuffer) — perfect for files. The critical
            challenge is <strong>backpressure</strong>: if you send faster than the channel can deliver,
            you'll overflow the browser's buffer and crash the tab.
          </p>
          <p>
            The solution: check <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">dc.bufferedAmount</code> before
            each send, pause when it exceeds a threshold, and resume via
            <code className="ml-1 text-xs bg-surface-2 px-1 py-0.5 rounded">dc.onbufferedamountlow</code>.
          </p>
        </div>
      }
      hints={['Open two tabs', 'Tab 1: Sender, Tab 2: Receiver', 'Files verified with SHA-256']}
      demo={
        <div className="space-y-4">
          {role === null && (
            <div className="flex flex-col gap-3">
              <button onClick={startSender} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg w-fit">
                I'm the Sender (Tab 1)
              </button>
              <div>
                <p className="text-xs text-zinc-500 mb-1">Paste offer SDP from Sender tab:</p>
                <textarea value={remoteSdpInput} onChange={(e) => setRemoteSdpInput(e.target.value)}
                  className="w-full h-20 bg-surface-0 border border-zinc-700 rounded-lg p-2 text-xs font-mono text-zinc-300 resize-none focus:outline-none focus:border-blue-500" />
                <button onClick={startReceiver} disabled={!remoteSdpInput.trim()}
                  className="mt-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg w-full">
                  I'm the Receiver (Tab 2)
                </button>
              </div>
            </div>
          )}

          {role === 'sender' && localSdp && (
            <div className="space-y-3">
              <div>
                <p className="text-xs text-zinc-500 mb-1">Copy offer → Receiver tab:</p>
                <textarea value={localSdp} readOnly
                  className="w-full h-20 bg-surface-0 border border-zinc-700 rounded-lg p-2 text-xs font-mono text-zinc-300 resize-none"
                  onClick={(e) => (e.target as HTMLTextAreaElement).select()} />
              </div>
              <div>
                <p className="text-xs text-zinc-500 mb-1">Paste answer from Receiver:</p>
                <textarea value={remoteSdpInput} onChange={(e) => setRemoteSdpInput(e.target.value)}
                  className="w-full h-16 bg-surface-0 border border-zinc-700 rounded-lg p-2 text-xs font-mono text-zinc-300 resize-none focus:outline-none focus:border-blue-500" />
                <button onClick={applyAnswer} disabled={!remoteSdpInput.trim()}
                  className="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                  Apply Answer
                </button>
              </div>
              {status.includes('open') && (
                <div className="space-y-2">
                  <label className="text-xs text-zinc-400">Select a file:</label>
                  <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                    className="text-sm text-zinc-300 file:mr-3 file:px-3 file:py-1 file:rounded file:border-0 file:bg-surface-2 file:text-zinc-300 hover:file:bg-surface-3" />
                  <button onClick={sendFile} disabled={!file}
                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                    Send File
                  </button>
                </div>
              )}
            </div>
          )}

          {role === 'receiver' && localSdp && (
            <div>
              <p className="text-xs text-zinc-500 mb-1">Copy this answer → Sender tab:</p>
              <textarea value={localSdp} readOnly
                className="w-full h-20 bg-surface-0 border border-zinc-700 rounded-lg p-2 text-xs font-mono text-zinc-300 resize-none"
                onClick={(e) => (e.target as HTMLTextAreaElement).select()} />
            </div>
          )}

          {progress > 0 && <ProgressBar value={progress} label={`Transfer: ${progress}%`} />}
          {status && !status.includes('open') && <p className="text-sm text-zinc-400">{status}</p>}

          {received && (
            <div className="bg-emerald-900/20 border border-emerald-800 rounded-lg p-4">
              <p className="text-sm text-emerald-400 font-semibold mb-2">✓ File received successfully!</p>
              <a href={received.url} download={received.name}
                className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium rounded-lg inline-block">
                Download {received.name}
              </a>
            </div>
          )}

          {role && <button onClick={reset} className="text-xs text-zinc-500 hover:text-zinc-300">Reset</button>}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Backpressure-safe file sending' }}
      mdnLinks={[
        { label: 'bufferedAmount', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/bufferedAmount' },
      ]}
    />
  );
}
