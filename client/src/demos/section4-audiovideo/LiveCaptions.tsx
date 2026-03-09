import { useMemo, useRef, useState, useCallback } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

const CODE = `// Web Speech API → real-time captions → DataChannel
const recognition = new webkitSpeechRecognition();
recognition.continuous = true;
recognition.interimResults = true;
recognition.lang = 'en-US';

recognition.onresult = (event) => {
  let interim = '', final = '';
  for (const result of event.results) {
    if (result.isFinal) final += result[0].transcript;
    else interim += result[0].transcript;
  }
  // Send interim results for live preview, final for the permanent record
  dc.send(JSON.stringify({ type: 'caption', text: interim || final, isFinal: !!final }));
};

// Receiver — display as caption overlay
dc.onmessage = ({ data }) => {
  const { text, isFinal } = JSON.parse(data);
  if (isFinal) captions.push(text);
  else livePreview = text;
};`;

interface Caption {
  id: number;
  text: string;
  ts: number;
}
let capId = 0;

type SpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionEvent = {
  results: SpeechRecognitionResultList;
  resultIndex: number;
};
type SpeechRecognitionResultList = { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } };

export default function LiveCaptions() {
  const logger = useMemo(() => new Logger(), []);
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [roomId, setRoomId] = useState('CAPTIONS01');
  const [joined, setJoined] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [liveText, setLiveText] = useState('');
  const [remoteLive, setRemoteLive] = useState('');
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const dataChannels = useRef(new Map<string, RTCDataChannel>());
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const broadcast = (msg: object) => {
    const s = JSON.stringify(msg);
    dataChannels.current.forEach((dc) => { if (dc.readyState === 'open') dc.send(s); });
  };

  const setupDc = (dc: RTCDataChannel, remotePeerId: string) => {
    dataChannels.current.set(remotePeerId, dc);
    dc.onopen = () => logger.success(`Caption channel open with ${remotePeerId}`);
    dc.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'caption') {
        if (msg.isFinal) {
          setCaptions((c) => [...c, { id: ++capId, text: msg.text, ts: Date.now() }].slice(-50));
          setRemoteLive('');
          logger.info(`[Remote] ${msg.text}`);
        } else {
          setRemoteLive(msg.text);
        }
      }
    };
  };

  const createPc = useCallback((remotePeerId: string) => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    peerConnections.current.set(remotePeerId, pc);
    pc.onicecandidate = (ev) => {
      if (ev.candidate) sendRef.current({ type: 'ice-candidate', from: peerId, to: remotePeerId, candidate: ev.candidate.toJSON() });
    };
    pc.ondatachannel = (ev) => setupDc(ev.channel, remotePeerId);
    return pc;
  }, [peerId]);

  const { connect, join, send } = useSignaling({
    logger,
    onMessage: useCallback(async (msg: SignalingMessage) => {
      switch (msg.type) {
        case 'peer-list': {
          for (const peer of msg.peers) {
            const pc = createPc(peer.peerId);
            const dc = pc.createDataChannel('captions');
            setupDc(dc, peer.peerId);
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            sendRef.current({ type: 'offer', from: peerId, to: peer.peerId, sdp: offer });
          }
          break;
        }
        case 'offer': {
          const pc = createPc(msg.from);
          await pc.setRemoteDescription(msg.sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendRef.current({ type: 'answer', from: peerId, to: msg.from, sdp: answer });
          break;
        }
        case 'answer': await peerConnections.current.get(msg.from)?.setRemoteDescription(msg.sdp); break;
        case 'ice-candidate': await peerConnections.current.get(msg.from)?.addIceCandidate(msg.candidate).catch(console.warn); break;
      }
    }, [createPc, peerId]),
  });
  sendRef.current = send;

  const handleJoin = () => {
    connect();
    setTimeout(() => { join(roomId, peerId); setJoined(true); }, 500);
    logger.success(`Joined room ${roomId}`);
  };

  const startRecognition = () => {
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognition; SpeechRecognition?: new () => SpeechRecognition }).webkitSpeechRecognition ?? (window as unknown as { SpeechRecognition?: new () => SpeechRecognition }).SpeechRecognition;
    if (!SR) { logger.error('Web Speech API not supported in this browser (try Chrome)'); return; }

    const recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognitionRef.current = recognition;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t;
        else interim += t;
      }
      if (finalText) {
        setCaptions((c) => [...c, { id: ++capId, text: finalText, ts: Date.now() }].slice(-50));
        setLiveText('');
        broadcast({ type: 'caption', text: finalText, isFinal: true });
        logger.info(`[You] ${finalText}`);
      } else {
        setLiveText(interim);
        broadcast({ type: 'caption', text: interim, isFinal: false });
      }
    };

    recognition.onerror = () => { setRecognizing(false); logger.error('Recognition error'); };
    recognition.onend = () => setRecognizing(false);
    recognition.start();
    setRecognizing(true);
    logger.success('Listening… start speaking!');
  };

  const stopRecognition = () => {
    recognitionRef.current?.stop();
    setRecognizing(false);
    setLiveText('');
  };

  const handleLeave = () => {
    stopRecognition();
    peerConnections.current.forEach((pc) => pc.close());
    peerConnections.current.clear();
    dataChannels.current.clear();
    setJoined(false);
    setCaptions([]);
  };

  return (
    <DemoLayout
      title="Live Captions"
      difficulty="intermediate"
      description="Auto-transcribe speech with the Web Speech API and broadcast captions to all peers via DataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            The <strong>Web Speech API</strong>'s <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">SpeechRecognition</code> interface
            transcribes microphone audio in real time, delivering both <em>interim</em> (in-progress)
            and <em>final</em> (committed) transcript events. This demo pipes those events directly
            over a <strong>RTCDataChannel</strong> to all peers in the room — no speech model runs
            on your server.
          </p>
          <p>
            Interim results (shown in amber) update as you speak. When a sentence is finalized, it
            appears in the caption history and is sent as a permanent record to peers.
            This is exactly how live captioning works in video call apps like Google Meet.
          </p>
          <p className="text-amber-400/80">⚡ Web Speech API requires Chrome or Edge. Open two tabs to caption for each other.</p>
        </div>
      }
      hints={[
        'Open two tabs with the same room code',
        'One tab speaks, the other sees captions appear in real time',
        'Web Speech API requires Chrome/Edge and microphone permission',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap gap-3 items-center">
            <input value={roomId} onChange={(e) => setRoomId(e.target.value)} disabled={joined}
              className="bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono w-32 focus:outline-none disabled:opacity-50" />
            {!joined ? (
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">Join Room</button>
            ) : (
              <>
                {!recognizing ? (
                  <button onClick={startRecognition} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg">🎤 Start Speaking</button>
                ) : (
                  <button onClick={stopRecognition} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg animate-pulse">⏹ Stop</button>
                )}
                <button onClick={handleLeave} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">Leave</button>
              </>
            )}
          </div>

          {/* Caption display */}
          <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 min-h-48 space-y-2 overflow-y-auto" style={{ maxHeight: 280 }}>
            {captions.length === 0 && !liveText && !remoteLive && (
              <p className="text-zinc-700 text-sm text-center py-6">Captions will appear here…</p>
            )}
            {captions.map((c) => (
              <p key={c.id} className="text-zinc-200 text-sm">{c.text}</p>
            ))}
            {liveText && (
              <p className="text-amber-400/80 text-sm italic">{liveText}▌ <span className="text-xs text-zinc-600">(you — live)</span></p>
            )}
            {remoteLive && (
              <p className="text-blue-400/80 text-sm italic">{remoteLive}▌ <span className="text-xs text-zinc-600">(remote — live)</span></p>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-zinc-600">
            <span className="w-3 h-3 rounded-full bg-amber-500/60 inline-block" /> you (live)
            <span className="w-3 h-3 rounded-full bg-blue-500/60 inline-block ml-2" /> remote (live)
            <span className="w-3 h-3 rounded-full bg-zinc-400/60 inline-block ml-2" /> finalized
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Web Speech API → DataChannel captions' }}
      mdnLinks={[
        { label: 'SpeechRecognition', href: 'https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
