import { useMemo, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { createLoopbackDataChannelPair, type LoopbackDataChannelPair } from '@/lib/loopbackDataChannel';
import { Logger } from '@/lib/logger';

const CODE = `const game = new Chess(currentFen);
const move = game.move({ from, to, promotion: 'q' });

if (move) {
  channel.send(JSON.stringify({
    type: 'move',
    san: move.san,
  }));
}`;

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function createGame(fen?: string) {
  return fen ? new Chess(fen) : new Chess();
}

function pieceGlyph(piece: { color: 'w' | 'b'; type: string } | null) {
  if (!piece) return '';
  const map: Record<string, string> = {
    wp: '♙',
    wn: '♘',
    wb: '♗',
    wr: '♖',
    wq: '♕',
    wk: '♔',
    bp: '♟',
    bn: '♞',
    bb: '♝',
    br: '♜',
    bq: '♛',
    bk: '♚',
  };
  return map[`${piece.color}${piece.type}`] ?? '';
}

function Board({
  fen,
  selected,
  onSelect,
}: {
  fen: string;
  selected: string | null;
  onSelect: (square: string) => void;
}) {
  const board = createGame(fen).board();

  return (
    <div className="grid grid-cols-8 overflow-hidden rounded-2xl border border-zinc-800">
      {board.map((row, rowIndex) =>
        row.map((piece, colIndex) => {
          const square = `${FILES[colIndex]}${8 - rowIndex}`;
          const dark = (rowIndex + colIndex) % 2 === 1;
          const isSelected = selected === square;

          return (
            <button
              key={square}
              onClick={() => onSelect(square)}
              className={`relative flex aspect-square items-center justify-center text-2xl transition-colors ${
                dark ? 'bg-zinc-800' : 'bg-zinc-700'
              } ${isSelected ? 'ring-2 ring-amber-400 ring-inset' : ''}`}
            >
              <span>{pieceGlyph(piece)}</span>
              <span className="absolute left-1 top-1 text-[10px] text-zinc-500">{square}</span>
            </button>
          );
        })
      )}
    </div>
  );
}

export default function ChessRelay() {
  const logger = useMemo(() => new Logger(), []);
  const pairRef = useRef<LoopbackDataChannelPair | null>(null);
  const fenARef = useRef(createGame().fen());
  const fenBRef = useRef(createGame().fen());
  const [connected, setConnected] = useState(false);
  const [fenA, setFenA] = useState(fenARef.current);
  const [fenB, setFenB] = useState(fenBRef.current);
  const [selectedA, setSelectedA] = useState<string | null>(null);
  const [selectedB, setSelectedB] = useState<string | null>(null);
  const [historyA, setHistoryA] = useState<string[]>([]);
  const [historyB, setHistoryB] = useState<string[]>([]);

  const connect = async () => {
    pairRef.current?.close();
    const pair = await createLoopbackDataChannelPair('chess-relay', { logger });
    pairRef.current = pair;

    pair.channelA.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as { san: string };
      const game = createGame(fenARef.current);
      game.move(payload.san);
      fenARef.current = game.fen();
      setFenA(game.fen());
      setHistoryA((previous) => [...previous, payload.san]);
      logger.info(`Peer A received move ${payload.san}`);
    };

    pair.channelB.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as { san: string };
      const game = createGame(fenBRef.current);
      game.move(payload.san);
      fenBRef.current = game.fen();
      setFenB(game.fen());
      setHistoryB((previous) => [...previous, payload.san]);
      logger.info(`Peer B received move ${payload.san}`);
    };

    setConnected(true);
    logger.success('Chess relay connected');
  };

  const applyMove = (peer: 'A' | 'B', square: string) => {
    const selected = peer === 'A' ? selectedA : selectedB;
    if (!selected) {
      peer === 'A' ? setSelectedA(square) : setSelectedB(square);
      return;
    }

    const fen = peer === 'A' ? fenARef.current : fenBRef.current;
    const game = createGame(fen);
    const move = game.move({ from: selected, to: square, promotion: 'q' });

    if (!move) {
      peer === 'A' ? setSelectedA(square) : setSelectedB(square);
      return;
    }

    if (peer === 'A') {
      fenARef.current = game.fen();
      setFenA(game.fen());
      setHistoryA((previous) => [...previous, move.san]);
      setSelectedA(null);
      pairRef.current?.channelA.send(JSON.stringify({ type: 'move', san: move.san }));
    } else {
      fenBRef.current = game.fen();
      setFenB(game.fen());
      setHistoryB((previous) => [...previous, move.san]);
      setSelectedB(null);
      pairRef.current?.channelB.send(JSON.stringify({ type: 'move', san: move.san }));
    }

    logger.success(`${peer} played ${move.san}`);
  };

  const resetBoards = () => {
    const fen = createGame().fen();
    fenARef.current = fen;
    fenBRef.current = fen;
    setFenA(fen);
    setFenB(fen);
    setHistoryA([]);
    setHistoryB([]);
    setSelectedA(null);
    setSelectedB(null);
    logger.info('Boards reset to the starting position');
  };

  const statusA = createGame(fenA);
  const statusB = createGame(fenB);

  return (
    <DemoLayout
      title="Chess Relay"
      difficulty="intermediate"
      description="Relay legal chess moves over RTCDataChannel and keep two peer boards perfectly synchronized with chess.js."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>chess.js</strong> handles legality, SAN notation, turns, and check state while
            WebRTC transports only the move itself. That keeps the peer payload tiny and the game logic trustworthy.
          </p>
          <p>
            It is a clean example of shipping intent instead of whole-state snapshots.
          </p>
        </div>
      }
      hints={[
        'Click one square to select a piece, then another to make the move.',
        'Moves are transmitted as SAN strings, so the remote board rebuilds them legally.',
        'Reset both boards anytime if you want a fresh opening.',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <button
                onClick={connect}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Connect chess boards
              </button>
            ) : (
              <span className="rounded-xl border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
                Chess link active
              </span>
            )}
            <button
              onClick={resetBoards}
              className="rounded-xl bg-surface-2 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-surface-3"
            >
              Reset board
            </button>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Peer A</p>
                <span className="text-xs text-zinc-500">{statusA.turn() === 'w' ? 'White' : 'Black'} to move</span>
              </div>
              <Board fen={fenA} selected={selectedA} onSelect={(square) => applyMove('A', square)} />
              <div className="rounded-2xl border border-zinc-800 bg-surface-0 p-3 text-xs text-zinc-400">
                {historyA.length ? historyA.join(' ') : 'No moves yet'}
              </div>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">Peer B</p>
                <span className="text-xs text-zinc-500">{statusB.turn() === 'w' ? 'White' : 'Black'} to move</span>
              </div>
              <Board fen={fenB} selected={selectedB} onSelect={(square) => applyMove('B', square)} />
              <div className="rounded-2xl border border-zinc-800 bg-surface-0 p-3 text-xs text-zinc-400">
                {historyB.length ? historyB.join(' ') : 'No moves yet'}
              </div>
            </section>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Move intent over RTCDataChannel' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
