import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

type GamePhase = 'idle' | 'waiting' | 'ready' | 'clicked' | 'false-start' | 'done';

interface RoundResult { round: number; you: number | null; peer: number | null }

const CODE = `// Reaction time duel via DataChannel
// Both peers start the same timer; whoever clicks first wins the round

let flashTime = null;

function startRound() {
  const delay = 1000 + Math.random() * 3000; // 1–4 s random delay
  setTimeout(() => {
    flashTime = performance.now();
    showTarget();                  // "GO!" stimulus
  }, delay);
}

button.onclick = () => {
  if (!flashTime) { // clicked before the flash
    dc.send(JSON.stringify({ type: 'false-start' }));
    return;
  }
  const rt = performance.now() - flashTime;
  dc.send(JSON.stringify({ type: 'reaction', ms: rt, round }));
};

dc.onmessage = ({ data }) => {
  const { type, ms, round } = JSON.parse(data);
  if (type === 'reaction') setOpponentTime(ms); // display peer's result
};`;

const COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899'];

export default function ReactionDuel() {
  const logger = useMemo(() => new Logger(), []);
  const [phase, setPhase] = useState<GamePhase>('idle');
  const [myTime, setMyTime] = useState<number | null>(null);
  const [peerTime, setPeerTime] = useState<number | null>(null);
  const [round, setRound] = useState(0);
  const [results, setResults] = useState<RoundResult[]>([]);
  const [color, setColor] = useState('#3b82f6');
  const [connected, setConnected] = useState(false);
  const flashTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const currentRoundRef = useRef(0);
  const myTimeRef = useRef<number | null>(null);
  const peerTimeRef = useRef<number | null>(null);

  const connect = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = ev => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = ev => ev.candidate && pcA.addIceCandidate(ev.candidate);
    const dc = pcA.createDataChannel('reaction', { ordered: true });
    dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Duel channel open — start a round!'); };
    pcB.ondatachannel = ev => {
      ev.channel.onmessage = e => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'reaction') {
          peerTimeRef.current = msg.ms;
          setPeerTime(msg.ms);
          const winner = myTimeRef.current !== null ? (myTimeRef.current < msg.ms ? 'You' : 'Peer') : 'Peer';
          logger.info(`Round ${msg.round}: Peer = ${msg.ms.toFixed(0)}ms, You = ${myTimeRef.current?.toFixed(0) ?? '—'}ms → ${winner} wins`);
          setResults(r => [...r, { round: msg.round, you: myTimeRef.current, peer: msg.ms }].slice(-10));
        }
        if (msg.type === 'false-start') { logger.warn('Peer false-started!'); }
        if (msg.type === 'go') { triggerFlash(); }
      };
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  const triggerFlash = () => {
    setPhase('ready');
    setColor(COLORS[Math.floor(Math.random() * COLORS.length)]);
    flashTimeRef.current = performance.now();
  };

  const startRound = () => {
    const r = round + 1;
    setRound(r);
    currentRoundRef.current = r;
    setMyTime(null); setPeerTime(null);
    myTimeRef.current = null; peerTimeRef.current = null;
    setPhase('waiting');
    flashTimeRef.current = null;
    const delay = 1000 + Math.random() * 3000;
    timerRef.current = setTimeout(() => {
      triggerFlash();
      if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'go', round: r }));
    }, delay);
    logger.info(`Round ${r} — wait for the flash…`);
  };

  const handleClick = () => {
    if (phase === 'waiting') {
      clearTimeout(timerRef.current!);
      setPhase('false-start');
      if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'false-start' }));
      logger.warn('False start! Too early.');
      return;
    }
    if (phase === 'ready' && flashTimeRef.current) {
      const rt = performance.now() - flashTimeRef.current;
      myTimeRef.current = rt;
      setMyTime(rt);
      setPhase('clicked');
      if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'reaction', ms: rt, round: currentRoundRef.current }));
      logger.success(`Your time: ${rt.toFixed(0)} ms`);
    }
  };

  const ratingLabel = (ms: number | null) => {
    if (ms === null) return '—';
    if (ms < 150) return '⚡ Superhuman!';
    if (ms < 200) return '🥇 Elite';
    if (ms < 250) return '😎 Fast';
    if (ms < 300) return '👍 Good';
    if (ms < 400) return '🙂 Average';
    return '🐢 Slow';
  };

  const scores = results.reduce((acc, r) => {
    if (r.you !== null && r.peer !== null) { if (r.you < r.peer) acc.you++; else acc.peer++; }
    return acc;
  }, { you: 0, peer: 0 });

  const areaStyle = () => {
    if (phase === 'false-start') return 'bg-rose-950 border-rose-600';
    if (phase === 'ready') return 'border-4 cursor-pointer';
    if (phase === 'waiting') return 'bg-zinc-900 border-zinc-800 cursor-wait';
    return 'bg-surface-0 border-zinc-800';
  };

  return (
    <DemoLayout
      title="Reaction Time Duel"
      difficulty="beginner"
      description="Race a peer to click when the color flashes — reaction times compared over RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Each round starts a random 1–4 second countdown before a colored flash appears.
            Click as fast as possible! Your reaction time (milliseconds since the flash) is sent
            over a <strong>RTCDataChannel</strong>. The peer does the same independently —
            whoever clicks faster wins the round.
          </p>
          <p>
            The <em>false-start</em> detection works by checking whether the flash has appeared
            yet when you click. If not, a false-start event is sent to the peer as a penalty.
          </p>
          <p>
            Average human visual reaction time is 150–300 ms. Below 150 ms is superhuman
            (or cheating!). The loopback simulates a second player in the same browser.
          </p>
        </div>
      }
      hints={[
        'Wait for the color flash — clicking early is a false start!',
        'Connect Loopback to simulate a two-player duel',
        'Average humans react in 150–300 ms — try to beat that!',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap gap-3 items-center">
            {!connected && <button onClick={connect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">Connect Loopback</button>}
            <button onClick={startRound} disabled={phase === 'waiting' || phase === 'ready'}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {round === 0 ? 'Start Round' : 'Next Round'}
            </button>
            {round > 0 && <span className="text-xs text-zinc-500">You: <strong className="text-blue-400">{scores.you}</strong> · Peer: <strong className="text-rose-400">{scores.peer}</strong></span>}
          </div>

          {/* Big reaction area */}
          <div
            className={`relative h-48 rounded-2xl border-2 flex items-center justify-center transition-all duration-100 select-none ${areaStyle()}`}
            style={phase === 'ready' ? { backgroundColor: color, borderColor: color } : {}}
            onClick={handleClick}
          >
            {phase === 'idle' && <p className="text-zinc-600 text-lg">Press Start Round</p>}
            {phase === 'waiting' && <p className="text-zinc-500 text-lg animate-pulse">Wait for it…</p>}
            {phase === 'ready' && <p className="text-white text-5xl font-bold drop-shadow-lg">CLICK!</p>}
            {phase === 'clicked' && <p className="text-emerald-400 text-3xl font-bold">{myTime?.toFixed(0)} ms</p>}
            {phase === 'false-start' && <p className="text-rose-400 text-2xl font-bold">⚠ False Start!</p>}
          </div>

          {/* Results */}
          {(myTime !== null || peerTime !== null) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-surface-0 border border-zinc-800 rounded-xl p-4 text-center">
                <p className="text-xs text-zinc-500 mb-1">You</p>
                <p className="text-2xl font-bold font-mono text-blue-400">{myTime !== null ? `${myTime.toFixed(0)} ms` : '—'}</p>
                <p className="text-xs text-zinc-500 mt-1">{ratingLabel(myTime)}</p>
              </div>
              <div className="bg-surface-0 border border-zinc-800 rounded-xl p-4 text-center">
                <p className="text-xs text-zinc-500 mb-1">Peer</p>
                <p className="text-2xl font-bold font-mono text-rose-400">{peerTime !== null ? `${peerTime.toFixed(0)} ms` : '—'}</p>
                <p className="text-xs text-zinc-500 mt-1">{ratingLabel(peerTime)}</p>
              </div>
            </div>
          )}

          {/* Round history */}
          {results.length > 0 && (
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {[...results].reverse().map(r => (
                <div key={r.round} className="flex items-center gap-3 text-xs py-1 border-b border-zinc-900">
                  <span className="text-zinc-600 w-12">Rd {r.round}</span>
                  <span className="text-blue-400 font-mono flex-1">{r.you !== null ? `${r.you.toFixed(0)}ms` : 'F/S'}</span>
                  <span className="text-rose-400 font-mono flex-1">{r.peer !== null ? `${r.peer.toFixed(0)}ms` : 'F/S'}</span>
                  <span className={`font-bold ${(r.you ?? 9999) < (r.peer ?? 9999) ? 'text-blue-400' : 'text-rose-400'}`}>
                    {r.you !== null && r.peer !== null ? ((r.you < r.peer) ? 'You ✓' : 'Peer ✓') : '—'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Reaction time measurement + DataChannel comparison' }}
      mdnLinks={[
        { label: 'performance.now()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/Performance/now' },
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
