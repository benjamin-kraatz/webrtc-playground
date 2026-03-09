import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const WORDS = [
  'ABOUT','ABOVE','ABUSE','ACTOR','ACUTE','ADMIN','ADORE','ADULT','AFTER','AGAIN',
  'AGILE','AGREE','AHEAD','ALARM','ALBUM','ALERT','ALIBI','ALIGN','ALLEY','ALLOT',
  'ALONE','ALONG','ALTER','ANGEL','ANGRY','ANIME','ANKLE','ANNEX','APART','APPLE',
  'APPLY','ARENA','ARGUE','ARRAY','AUDIO','AUDIT','AVERT','AWAIT','AWAKE','AXIAL',
  'BACON','BADGE','BADLY','BAGEL','BASIC','BATCH','BEGAN','BEGIN','BEING','BELOW',
  'BENCH','BILLY','BINGO','BIRTH','BLAND','BLANK','BLAST','BLAZE','BLEED','BLEND',
  'BLINK','BLOCK','BLOOM','BLUES','BLUNT','BLURT','BONUS','BOOST','BRAVE','BREAK',
  'BREED','BRICK','BRIDE','BRIEF','BRING','BRISK','BROAD','BROKE','BROWN','BRUSH',
  'BUILD','BUILT','BULGE','BUNCH','BURST','BYTES','CABIN','CACHE','CANDY','CARGO',
  'CARRY','CATCH','CAUSE','CHAIN','CHAIR','CHAOS','CHARM','CHART','CHEAP','CHECK',
];

function getDailyWord(): string {
  const day = Math.floor(Date.now() / 86400000);
  return WORDS[day % WORDS.length];
}

type TileState = 'empty' | 'filled' | 'correct' | 'present' | 'absent';
interface Tile { letter: string; state: TileState }

function checkGuess(guess: string, target: string): Tile[] {
  const result: Tile[] = guess.split('').map((l) => ({ letter: l, state: 'absent' as TileState }));
  const remaining = target.split('');
  // First pass: correct
  for (let i = 0; i < 5; i++) {
    if (guess[i] === target[i]) { result[i].state = 'correct'; remaining[i] = ''; }
  }
  // Second pass: present
  for (let i = 0; i < 5; i++) {
    if (result[i].state !== 'correct') {
      const idx = remaining.indexOf(guess[i]);
      if (idx >= 0) { result[i].state = 'present'; remaining[idx] = ''; }
    }
  }
  return result;
}

const TILE_COLORS: Record<TileState, string> = {
  empty:   'bg-surface-0 border-zinc-700 text-zinc-600',
  filled:  'bg-surface-2 border-zinc-500 text-zinc-200',
  correct: 'bg-emerald-700 border-emerald-600 text-white',
  present: 'bg-amber-600 border-amber-500 text-white',
  absent:  'bg-zinc-700 border-zinc-600 text-zinc-300',
};

const CODE = `// Wordle Duel — same daily word derived from the date (no coordination needed!)
function getDailyWord() {
  const day = Math.floor(Date.now() / 86400000); // epoch days
  return WORDS[day % WORDS.length]; // deterministic & identical for all peers
}

// Sync only solve status (not the guesses — that would ruin the competition!)
dc.send(JSON.stringify({ type: 'status', guesses: guessCount, solved: true }));

dc.onmessage = ({ data }) => {
  const { guesses, solved } = JSON.parse(data);
  setOpponentStatus({ guesses, solved }); // show opponent progress
};`;

export default function WordleDuel() {
  const logger = useMemo(() => new Logger(), []);
  const TARGET = useMemo(() => getDailyWord(), []);
  const [guesses, setGuesses] = useState<Tile[][]>([]);
  const [current, setCurrent] = useState('');
  const [gameState, setGameState] = useState<'playing' | 'won' | 'lost'>('playing');
  const [opponentStatus, setOpponentStatus] = useState<{ guesses: number; solved: boolean } | null>(null);
  const [connected, setConnected] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const dcRef = useRef<RTCDataChannel | null>(null);

  const handleKey = (key: string) => {
    if (gameState !== 'playing') return;
    if (key === 'ENTER') {
      if (current.length !== 5) return;
      if (!WORDS.includes(current)) { logger.warn('Not in word list'); return; }
      const tiles = checkGuess(current, TARGET);
      const newGuesses = [...guesses, tiles];
      setGuesses(newGuesses);
      setCurrent('');
      const won = tiles.every((t) => t.state === 'correct');
      if (won) {
        setGameState('won');
        logger.success(`You solved it in ${newGuesses.length} guess${newGuesses.length !== 1 ? 'es' : ''}! 🎉`);
        if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'status', guesses: newGuesses.length, solved: true }));
      } else if (newGuesses.length === 6) {
        setGameState('lost');
        setShowAnswer(true);
        logger.warn(`Game over! The word was ${TARGET}`);
        if (dcRef.current?.readyState === 'open') dcRef.current.send(JSON.stringify({ type: 'status', guesses: 6, solved: false }));
      }
    } else if (key === 'BACKSPACE') {
      setCurrent((c) => c.slice(0, -1));
    } else if (/^[A-Z]$/.test(key) && current.length < 5) {
      setCurrent((c) => c + key);
    }
  };

  const connect = async () => {
    const pcA = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const pcB = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.onicecandidate = (ev) => ev.candidate && pcB.addIceCandidate(ev.candidate);
    pcB.onicecandidate = (ev) => ev.candidate && pcA.addIceCandidate(ev.candidate);
    const dc = pcA.createDataChannel('wordle');
    dcRef.current = dc;
    dc.onopen = () => { setConnected(true); logger.success('Opponent connected! Same word, different grids — race to solve it!'); };
    pcB.ondatachannel = (ev) => {
      ev.channel.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        if (msg.type === 'status') {
          setOpponentStatus({ guesses: msg.guesses, solved: msg.solved });
          logger.info(`Opponent: ${msg.solved ? `solved in ${msg.guesses}!` : `${msg.guesses}/6 guesses`}`);
        }
      };
    };
    const offer = await pcA.createOffer();
    await pcA.setLocalDescription(offer);
    await pcB.setRemoteDescription(offer);
    const answer = await pcB.createAnswer();
    await pcB.setLocalDescription(answer);
    await pcA.setRemoteDescription(answer);
  };

  const reset = () => {
    setGuesses([]);
    setCurrent('');
    setGameState('playing');
    setOpponentStatus(null);
    setShowAnswer(false);
    logger.info('Game reset (word changes daily)');
  };

  const KEYBOARD_ROWS = [['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['ENTER','Z','X','C','V','B','N','M','BACKSPACE']];

  // Compute key states
  const keyStates = useMemo(() => {
    const states: Record<string, TileState> = {};
    for (const row of guesses) for (const tile of row) {
      const prev = states[tile.letter];
      if (prev === 'correct') continue;
      if (tile.state === 'correct' || !prev || tile.state === 'present' && prev === 'absent') states[tile.letter] = tile.state;
      else if (tile.state === 'absent' && !prev) states[tile.letter] = 'absent';
    }
    return states;
  }, [guesses]);

  const renderGrid = () => {
    const rows: Tile[][] = [];
    for (let r = 0; r < 6; r++) {
      if (r < guesses.length) rows.push(guesses[r]);
      else if (r === guesses.length && gameState === 'playing') rows.push(current.padEnd(5, ' ').split('').map((l) => ({ letter: l.trim(), state: l.trim() ? 'filled' : 'empty' })));
      else rows.push(Array(5).fill({ letter: '', state: 'empty' }));
    }
    return rows;
  };

  return (
    <DemoLayout
      title="Wordle Duel"
      difficulty="beginner"
      description="Race to solve the same Wordle against a peer — the word is date-based so no coordination needed."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Both peers derive the <strong>same secret word</strong> independently using the
            formula <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">WORDS[Math.floor(Date.now() / 86400000) % WORDS.length]</code> —
            the epoch day number modulo the word list size. No word needs to be exchanged!
          </p>
          <p>
            The <strong>RTCDataChannel</strong> only carries meta-status: "solved in N guesses"
            or "gave up in 6". Your actual guesses are never sent to the opponent, preserving
            the competitive element. This shows how to sync just enough state.
          </p>
          <p>
            Color coding: 🟩 Correct position · 🟨 Present but wrong position · ⬛ Not in word.
          </p>
        </div>
      }
      hints={[
        'The word changes every day — it\'s the same for everyone',
        'Connect Loopback to see the opponent status panel update as you solve',
        'Tiles in your guesses inform the keyboard color hints below',
      ]}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            {!connected && <button onClick={connect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">Connect Loopback</button>}
            <button onClick={reset} className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-xs rounded-lg">Reset</button>
            {(gameState !== 'playing' || showAnswer) && <button onClick={() => setShowAnswer(!showAnswer)} className="px-3 py-1.5 bg-surface-2 text-zinc-400 text-xs rounded-lg">{showAnswer ? 'Hide Answer' : 'Show Answer'}</button>}
          </div>

          <div className="flex gap-6 flex-wrap">
            {/* Game grid */}
            <div className="space-y-1.5">
              {renderGrid().map((row, ri) => (
                <div key={ri} className="flex gap-1.5">
                  {row.map((tile, ci) => (
                    <div key={ci} className={`w-12 h-12 border-2 rounded-lg flex items-center justify-center text-lg font-bold transition-all ${TILE_COLORS[tile.state]}`}>
                      {tile.letter}
                    </div>
                  ))}
                </div>
              ))}
            </div>

            {/* Status panel */}
            <div className="space-y-3 flex-1 min-w-36">
              {gameState === 'won' && (
                <div className="bg-emerald-950/40 border border-emerald-800 rounded-xl p-3 text-center">
                  <p className="text-emerald-400 font-bold">🎉 Solved!</p>
                  <p className="text-zinc-400 text-sm">{guesses.length}/6 guesses</p>
                </div>
              )}
              {gameState === 'lost' && (
                <div className="bg-rose-950/40 border border-rose-800 rounded-xl p-3 text-center">
                  <p className="text-rose-400 font-bold">😔 Game over</p>
                  {showAnswer && <p className="text-zinc-200 font-bold mt-1">Answer: {TARGET}</p>}
                </div>
              )}

              {opponentStatus && (
                <div className="bg-blue-950/30 border border-blue-900/50 rounded-xl p-3 space-y-1">
                  <p className="text-xs text-zinc-500 font-semibold">Opponent</p>
                  {opponentStatus.solved
                    ? <p className="text-emerald-400 font-bold">Solved in {opponentStatus.guesses}! 🎉</p>
                    : <p className="text-zinc-300">{opponentStatus.guesses}/6 guesses</p>}
                </div>
              )}

              <div className="text-xs text-zinc-600 space-y-0.5">
                <p>Word #{Math.floor(Date.now() / 86400000) % WORDS.length}</p>
                <p>Guess {guesses.length}/6</p>
              </div>
            </div>
          </div>

          {/* Keyboard */}
          <div className="space-y-1.5">
            {KEYBOARD_ROWS.map((row, ri) => (
              <div key={ri} className="flex gap-1 justify-center">
                {row.map((key) => {
                  const state = keyStates[key];
                  return (
                    <button key={key} onClick={() => handleKey(key)}
                      className={`px-2 h-10 text-xs font-bold rounded-lg transition-colors min-w-8 ${
                        key.length > 1 ? 'px-3 text-xs' : ''
                      } ${state ? TILE_COLORS[state] : 'bg-surface-2 hover:bg-surface-3 text-zinc-300 border border-zinc-700'}`}>
                      {key === 'BACKSPACE' ? '⌫' : key}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Date-seeded word + DataChannel status sync' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
