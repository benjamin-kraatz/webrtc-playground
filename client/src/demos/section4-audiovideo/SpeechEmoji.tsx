import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const WORD_MAP: Array<[RegExp, string[]]> = [
  [/\b(fire|hot|burn|flame)\b/i,         ['🔥', '🌋', '♨️']],
  [/\b(love|heart|adore|kiss)\b/i,       ['❤️', '💕', '😍']],
  [/\b(laugh|funny|hilarious|haha)\b/i,  ['😂', '🤣', '😆']],
  [/\b(sad|cry|unhappy|upset)\b/i,       ['😢', '😭', '💔']],
  [/\b(happy|joy|great|awesome)\b/i,     ['😊', '🎉', '✨']],
  [/\b(food|eat|hungry|pizza|burger)\b/i,['🍕', '🍔', '🌮']],
  [/\b(music|song|beat|sound)\b/i,       ['🎵', '🎶', '🎸']],
  [/\b(sleep|tired|yawn|rest)\b/i,       ['😴', '💤', '🛏️']],
  [/\b(party|celebrate|birthday)\b/i,    ['🥳', '🎊', '🎂']],
  [/\b(rocket|space|launch|fly)\b/i,     ['🚀', '🛸', '⭐']],
  [/\b(money|cash|rich|buy)\b/i,         ['💰', '💵', '🤑']],
  [/\b(computer|code|program|tech)\b/i,  ['💻', '👨‍💻', '⌨️']],
  [/\b(dog|puppy|woof)\b/i,              ['🐶', '🐾', '🦴']],
  [/\b(cat|kitten|meow)\b/i,             ['🐱', '😸', '🐈']],
  [/\b(star|stars|amazing|wow)\b/i,      ['⭐', '🌟', '✨']],
  [/\b(angry|mad|furious|rage)\b/i,      ['😡', '🤬', '💢']],
  [/\b(cool|awesome|nice|sweet)\b/i,     ['😎', '🆒', '👌']],
  [/\b(think|idea|brain|smart)\b/i,      ['🤔', '💡', '🧠']],
  [/\b(yes|agree|right|correct)\b/i,     ['✅', '👍', '💯']],
  [/\b(no|wrong|disagree|nope)\b/i,      ['❌', '👎', '🚫']],
  [/\b(water|ocean|sea|swim)\b/i,        ['💧', '🌊', '🏊']],
  [/\b(sun|sunny|bright|light)\b/i,      ['☀️', '🌤️', '✨']],
  [/\b(rain|storm|cloud|wet)\b/i,        ['🌧️', '⛈️', '🌂']],
  [/\b(hello|hi|hey|greet)\b/i,          ['👋', '😊', '🙏']],
  [/\b(bye|goodbye|later|ciao)\b/i,      ['👋', '✌️', '😔']],
  [/\b(beer|drink|cheers|wine)\b/i,      ['🍺', '🥂', '🍷']],
  [/\b(book|read|learn|study)\b/i,       ['📚', '📖', '🎓']],
  [/\b(game|play|fun|win)\b/i,           ['🎮', '🏆', '🎯']],
];

function matchEmojis(text: string): string[] {
  const results: string[] = [];
  for (const [pattern, emojis] of WORD_MAP) {
    if (pattern.test(text)) {
      results.push(emojis[Math.floor(Math.random() * emojis.length)]);
    }
  }
  return results.length ? results : ['🤷'];
}

interface Translation {
  id: number;
  text: string;
  emojis: string[];
  from: 'local' | 'remote';
}
let tlId = 0;

type SpeechRec = { continuous: boolean; interimResults: boolean; lang: string; start(): void; stop(): void; onresult: ((e: { results: { length: number; [i: number]: { isFinal: boolean; [j: number]: { transcript: string } } }; resultIndex: number }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null };

const CODE = `// Speech-to-emoji: map recognized words to emoji
const recognition = new webkitSpeechRecognition();
recognition.continuous = true;
recognition.interimResults = true;

const WORD_MAP = [
  [/\\b(fire|hot|burn)\\b/i, ['🔥', '🌋']],
  [/\\b(love|heart)\\b/i,    ['❤️', '💕']],
  // ... 25+ more mappings
];

recognition.onresult = (event) => {
  const transcript = event.results[event.resultIndex][0].transcript;
  const emojis = [];
  for (const [pattern, emojiList] of WORD_MAP) {
    if (pattern.test(transcript)) emojis.push(emojiList[0]);
  }
  // Broadcast over DataChannel
  dc.send(JSON.stringify({ text: transcript, emojis }));
};`;

export default function SpeechEmoji() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [liveText, setLiveText] = useState('');
  const [burst, setBurst] = useState<string[]>([]);
  const recognitionRef = useRef<SpeechRec | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);

  const showBurst = (emojis: string[]) => {
    setBurst(emojis);
    setTimeout(() => setBurst([]), 2000);
  };

  const connect = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);
    const dc = pcA.createDataChannel('speech-emoji');
    dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Connected! Start speaking to translate.'); };
    pcB.ondatachannel = (ev) => {
      ev.channel.onmessage = (e) => {
        const { text, emojis } = JSON.parse(e.data as string);
        setTranslations((t) => [{ id: ++tlId, text, emojis, from: 'remote' as const }, ...t].slice(0, 30));
        showBurst(emojis);
        logger.info(`Remote: "${text}" → ${emojis.join(' ')}`);
      };
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  const startListening = () => {
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec; SpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition ?? (window as unknown as { SpeechRecognition?: new () => SpeechRec }).SpeechRecognition;
    if (!SR) { logger.error('Web Speech API not supported (try Chrome)'); return; }
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = 'en-US';
    recognitionRef.current = r;

    r.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      const transcript = last[0].transcript;
      if (last.isFinal) {
        const emojis = matchEmojis(transcript);
        setTranslations((t) => [{ id: ++tlId, text: transcript, emojis, from: 'local' as const }, ...t].slice(0, 30));
        showBurst(emojis);
        setLiveText('');
        if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ text: transcript, emojis }));
        logger.info(`You: "${transcript}" → ${emojis.join(' ')}`);
      } else {
        setLiveText(transcript);
      }
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    r.start();
    setListening(true);
  };

  const stopListening = () => { recognitionRef.current?.stop(); setListening(false); setLiveText(''); };

  const EXAMPLES = ['Fire!', 'I love music', 'Happy birthday', 'Let\'s play a game', 'Hello world'];
  const manualSend = (text: string) => {
    const emojis = matchEmojis(text);
    setTranslations((t) => [{ id: ++tlId, text, emojis, from: 'local' as const }, ...t].slice(0, 30));
    showBurst(emojis);
    if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ text, emojis }));
    logger.info(`"${text}" → ${emojis.join(' ')}`);
  };

  return (
    <DemoLayout
      title="Speech to Emoji"
      difficulty="beginner"
      description="Speak and watch your words transform into emoji — translated and broadcast to peers via DataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            The <strong>Web Speech API</strong> transcribes your speech into text in real time.
            This demo applies a word-matching dictionary of 27+ keyword patterns (using regular
            expressions) to find emoji equivalents. The result — the original text plus matched
            emojis — is broadcast over a <strong>RTCDataChannel</strong> to all peers.
          </p>
          <p>
            This pattern is useful for <em>reaction systems</em>: instead of just text, you can
            send semantic signals. The loopback simulates two peers, so you can see both sides
            simultaneously. In a real multi-tab setup, each peer speaks and all others see the
            emoji translation in real time.
          </p>
          <p>
            No Web Speech? Use the example buttons below to test the matching logic!
          </p>
        </div>
      }
      hints={[
        'Say words like "fire", "love", "rocket", "party", "code" to trigger emojis',
        'Use the example buttons if Web Speech isn\'t available in your browser',
        'Web Speech API works best in Chrome/Edge with microphone permission',
      ]}
      demo={
        <div className="space-y-5">
          {/* Emoji burst */}
          <div className="relative h-24 bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden flex items-center justify-center">
            {burst.length > 0 ? (
              <div className="flex gap-4 text-5xl" style={{ animation: 'popIn 0.3s ease-out' }}>
                {burst.map((e, i) => <span key={i}>{e}</span>)}
              </div>
            ) : (
              <span className="text-zinc-700 text-sm">{liveText || 'emoji appear here…'}</span>
            )}
          </div>

          {/* Controls */}
          {!connected && (
            <button onClick={connect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
              Connect
            </button>
          )}
          {connected && (
            <div className="flex gap-3">
              {!listening ? (
                <button onClick={startListening} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg">
                  🎤 Speak
                </button>
              ) : (
                <button onClick={stopListening} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white text-sm font-medium rounded-lg animate-pulse">
                  ⏹ Stop
                </button>
              )}
            </div>
          )}

          {/* Example phrases */}
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-500">Try these (no mic needed):</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button key={ex} onClick={() => manualSend(ex)}
                  className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-xs rounded-lg border border-zinc-800">
                  "{ex}"
                </button>
              ))}
            </div>
          </div>

          {/* Translation history */}
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {translations.map((t) => (
              <div key={t.id} className={`flex items-center gap-3 p-2.5 rounded-lg border text-sm ${t.from === 'local' ? 'border-blue-900/40 bg-blue-950/20' : 'border-violet-900/40 bg-violet-950/20'}`}>
                <span className="text-xl">{t.from === 'local' ? '🎙️' : '📻'}</span>
                <span className="flex-1 text-zinc-300 text-xs">"{t.text}"</span>
                <span className="text-2xl">{t.emojis.join(' ')}</span>
              </div>
            ))}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Speech recognition → emoji mapping → DataChannel' }}
      mdnLinks={[
        { label: 'SpeechRecognition', href: 'https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
