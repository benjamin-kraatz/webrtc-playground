import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const MORSE: Record<string, string> = {
  A:'.-', B:'-...', C:'-.-.', D:'-..', E:'.', F:'..-.', G:'--.', H:'....',
  I:'..', J:'.---', K:'-.-', L:'.-..', M:'--', N:'-.', O:'---', P:'.--.',
  Q:'--.-', R:'.-.', S:'...', T:'-', U:'..-', V:'...-', W:'.--', X:'-..-',
  Y:'-.--', Z:'--..', '0':'-----', '1':'.----', '2':'..---', '3':'...--',
  '4':'....-', '5':'.....', '6':'-....', '7':'--...', '8':'---..', '9':'----.',
  '.':'.-.-.-', ',':'--..--', '?':'..--..', '!':'-.-.--', ' ':' ',
};

function toMorse(text: string): string {
  return text.toUpperCase().split('').map((c) => MORSE[c] ?? '?').join(' ');
}

function fromMorse(morse: string): string {
  const reverseMap = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
  return morse.split('   ').map((word) =>
    word.split(' ').map((code) => reverseMap[code] ?? '?').join('')
  ).join(' ');
}

const CODE = `// Encode text to Morse and play via Web Audio
const DOT  = 60;   // ms
const DASH = 180;  // ms
const GAP  = 60;   // ms between symbols
const CHAR_GAP = 180; // ms between characters

function playMorse(morse, audioCtx) {
  let t = audioCtx.currentTime + 0.1;
  for (const symbol of morse) {
    if (symbol === ' ') { t += CHAR_GAP / 1000; continue; }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = 700;
    osc.connect(gain); gain.connect(audioCtx.destination);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.8, t + 0.005);
    const dur = (symbol === '.' ? DOT : DASH) / 1000;
    gain.gain.setValueAtTime(0.8, t + dur - 0.005);
    gain.gain.linearRampToValueAtTime(0, t + dur);
    osc.start(t); osc.stop(t + dur);
    t += dur + GAP / 1000;
  }
  return t; // end time
}`;

interface Message {
  id: number;
  text: string;
  morse: string;
  from: 'local' | 'remote';
}
let msgId = 0;

export default function MorseCodeRadio() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [transmitting, setTransmitting] = useState(false);
  const [currentMorse, setCurrentMorse] = useState('');
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const getAudioCtx = () => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    return audioCtxRef.current;
  };

  const playMorse = async (morse: string): Promise<void> => {
    const ctx = getAudioCtx();
    if (ctx.state === 'suspended') await ctx.resume();
    const DOT = 0.06, DASH = 0.18, SYM_GAP = 0.06, CHAR_GAP = 0.18;
    let t = ctx.currentTime + 0.1;
    const symbols = morse.split(' ');
    for (const sym of symbols) {
      if (sym === '') { t += CHAR_GAP; continue; }
      for (const ch of sym) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 700;
        osc.type = 'sine';
        osc.connect(gain); gain.connect(ctx.destination);
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.5, t + 0.005);
        const dur = ch === '.' ? DOT : DASH;
        gain.gain.setValueAtTime(0.5, t + dur - 0.005);
        gain.gain.linearRampToValueAtTime(0, t + dur);
        osc.start(t); osc.stop(t + dur + 0.01);
        t += dur + SYM_GAP;
      }
      t += CHAR_GAP - SYM_GAP;
    }
    const totalMs = (t - ctx.currentTime) * 1000 + 200;
    return new Promise((res) => setTimeout(res, totalMs));
  };

  const connect = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);
    const dc = pcA.createDataChannel('morse', { ordered: true });
    dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Radio channel open — ... --- ...'); };
    pcB.ondatachannel = (ev) => {
      ev.channel.onmessage = (e) => {
        const { text, morse } = JSON.parse(e.data as string);
        setMessages((m) => [...m, { id: ++msgId, text, morse, from: 'remote' }]);
        setCurrentMorse(morse);
        logger.info(`Received: ${text} (${morse})`);
        playMorse(morse);
      };
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  const transmit = async () => {
    if (!input.trim() || !dcRef.current || dcRef.current.readyState !== 'open') return;
    const text = input.trim();
    const morse = toMorse(text);
    setInput('');
    setTransmitting(true);
    setCurrentMorse(morse);
    setMessages((m) => [...m, { id: ++msgId, text, morse, from: 'local' }]);
    dcRef.current.send(JSON.stringify({ text, morse }));
    logger.info(`Transmitting: ${morse}`);
    await playMorse(morse);
    setTransmitting(false);
    setCurrentMorse('');
    logger.success(`Sent: "${text}"`);
  };

  const preview = toMorse(input || '...');

  return (
    <DemoLayout
      title="Morse Code Radio"
      difficulty="beginner"
      description="Type a message to encode it as Morse code — hear the beeps via Web Audio and transmit over DataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>Morse code</strong> encodes letters as sequences of short (dot) and long (dash)
            pulses. This demo uses the <strong>Web Audio API</strong> to generate a 700 Hz sine wave
            with precise timing for each symbol, played via an{' '}
            <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">OscillatorNode</code> connected
            to a <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">GainNode</code> for smooth
            attack/release envelopes.
          </p>
          <p>
            The text and its Morse encoding are sent simultaneously over a{' '}
            <strong>RTCDataChannel</strong> loopback. The receiving peer hears the same audio
            beeps and sees the decoded message. Timing: dot = 60 ms, dash = 180 ms.
          </p>
        </div>
      }
      hints={[
        'Connect first, then type your message and click Transmit',
        'Try "SOS" — the classic distress signal: ... --- ...',
        'Listen for the difference between dots and dashes in the beep timing',
      ]}
      demo={
        <div className="space-y-5">
          {!connected ? (
            <button onClick={connect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
              Open Radio Channel
            </button>
          ) : (
            <div className="space-y-4">
              {/* Morse display */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 min-h-16 flex items-center justify-center">
                <p className="font-mono text-lg text-emerald-400 tracking-widest break-all text-center">
                  {currentMorse || (input ? toMorse(input) : '_ _ _')}
                </p>
              </div>

              {/* Input */}
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && !transmitting && transmit()}
                  placeholder="TYPE YOUR MESSAGE"
                  disabled={transmitting}
                  className="flex-1 bg-surface-0 border border-zinc-700 rounded-lg px-3 py-2 text-sm font-mono text-zinc-200 uppercase focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                />
                <button onClick={transmit} disabled={transmitting || !input.trim()}
                  className={`px-4 py-2 text-white text-sm font-bold rounded-lg transition-colors ${transmitting ? 'bg-amber-600 animate-pulse' : 'bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50'}`}>
                  {transmitting ? '📡 TX…' : '📡 Transmit'}
                </button>
              </div>

              {/* Preview */}
              {input && !transmitting && (
                <p className="text-xs text-zinc-500 font-mono">Preview: <span className="text-emerald-500">{preview}</span></p>
              )}

              {/* Message log */}
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {messages.map((m) => (
                  <div key={m.id} className={`p-3 rounded-lg border text-xs space-y-1 ${m.from === 'local' ? 'border-emerald-900/50 bg-emerald-950/20' : 'border-zinc-800 bg-surface-0'}`}>
                    <div className="flex items-center gap-2">
                      <span className="text-base">{m.from === 'local' ? '📡' : '📻'}</span>
                      <span className="text-zinc-300 font-semibold">{m.text}</span>
                      <span className="ml-auto text-zinc-600">{m.from === 'local' ? 'Sent' : 'Received'}</span>
                    </div>
                    <p className="font-mono text-emerald-500/80 tracking-wider break-all">{m.morse}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Web Audio Morse code synthesis' }}
      mdnLinks={[
        { label: 'OscillatorNode', href: 'https://developer.mozilla.org/en-US/docs/Web/API/OscillatorNode' },
        { label: 'GainNode', href: 'https://developer.mozilla.org/en-US/docs/Web/API/GainNode' },
      ]}
    />
  );
}
