import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import { Chess, type Square, type PieceSymbol, type Color } from 'chess.js';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

const PIECE_UNICODE: Record<Color, Record<PieceSymbol, string>> = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = [8, 7, 6, 5, 4, 3, 2, 1];

const CODE = `import { Chess } from 'chess.js';
const chess = new Chess();

// On move: validate, apply, sync via data channel
function handleMove(from: Square, to: Square) {
  const move = chess.move({ from, to, promotion: 'q' });
  if (move) {
    dc.send(JSON.stringify({ type: 'move', from, to }));
  }
}

// Receive opponent's move
dc.onmessage = ({ data }) => {
  const { from, to } = JSON.parse(data);
  chess.move({ from, to, promotion: 'q' });
  updateBoard();
};`;

export default function ChessDuel() {
  const logger = useMemo(() => new Logger(), []);
  const [roomId, setRoomId] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase());
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [joined, setJoined] = useState(false);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [myColor, setMyColor] = useState<Color>('w');
  const [chess] = useState(() => new Chess());
  const [fen, setFen] = useState(chess.fen());
  const [selected, setSelected] = useState<Square | null>(null);
  const [legalMoves, setLegalMoves] = useState<Square[]>([]);
  const [lastMove, setLastMove] = useState<{ from: Square; to: Square } | null>(null);
  const [status, setStatus] = useState('');
  const [capturedW, setCapturedW] = useState<string[]>([]);
  const [capturedB, setCapturedB] = useState<string[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});

  const syncBoard = () => {
    setFen(chess.fen());
    const caps = { w: [] as string[], b: [] as string[] };
    // Count captured pieces by comparing starting counts
    const startCount: Record<string, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
    const currentW: Record<string, number> = {};
    const currentB: Record<string, number> = {};
    chess.board().flat().forEach((sq) => {
      if (!sq) return;
      if (sq.color === 'w') currentW[sq.type] = (currentW[sq.type] ?? 0) + 1;
      else currentB[sq.type] = (currentB[sq.type] ?? 0) + 1;
    });
    (['p', 'n', 'b', 'r', 'q'] as PieceSymbol[]).forEach((t) => {
      const wMissing = startCount[t] - (currentW[t] ?? 0);
      const bMissing = startCount[t] - (currentB[t] ?? 0);
      for (let i = 0; i < wMissing; i++) caps.b.push(PIECE_UNICODE.w[t]);
      for (let i = 0; i < bMissing; i++) caps.w.push(PIECE_UNICODE.b[t]);
    });
    setCapturedW(caps.w);
    setCapturedB(caps.b);

    if (chess.isCheckmate()) setStatus(`Checkmate! ${chess.turn() === 'w' ? 'Black' : 'White'} wins`);
    else if (chess.isDraw()) setStatus('Draw!');
    else if (chess.isCheck()) setStatus(`${chess.turn() === 'w' ? 'White' : 'Black'} is in check`);
    else setStatus(`${chess.turn() === 'w' ? 'White' : 'Black'} to move`);
  };

  const handleSquareClick = (square: Square) => {
    if (!dcRef.current || dcRef.current.readyState !== 'open') return;
    if (chess.isGameOver()) return;
    if (chess.turn() !== myColor) { logger.warn("Not your turn!"); return; }

    if (selected) {
      if (legalMoves.includes(square)) {
        const move = chess.move({ from: selected, to: square, promotion: 'q' });
        if (move) {
          setLastMove({ from: selected, to: square });
          dcRef.current.send(JSON.stringify({ type: 'move', from: selected, to: square }));
          logger.info(`Moved ${selected} → ${square}`);
          syncBoard();
        }
        setSelected(null);
        setLegalMoves([]);
      } else {
        const piece = chess.get(square);
        if (piece && piece.color === myColor) {
          setSelected(square);
          setLegalMoves(chess.moves({ square, verbose: true }).map((m) => m.to as Square));
        } else {
          setSelected(null);
          setLegalMoves([]);
        }
      }
    } else {
      const piece = chess.get(square);
      if (piece && piece.color === myColor) {
        setSelected(square);
        setLegalMoves(chess.moves({ square, verbose: true }).map((m) => m.to as Square));
      }
    }
  };

  const setupDc = useCallback((dc: RTCDataChannel) => {
    dcRef.current = dc;
    dc.onopen = () => { logger.success('Game channel open — chess duel begins!'); };
    dc.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'move') {
        chess.move({ from: msg.from, to: msg.to, promotion: 'q' });
        setLastMove({ from: msg.from, to: msg.to });
        syncBoard();
        logger.info(`Opponent played ${msg.from} → ${msg.to}`);
      } else if (msg.type === 'reset') {
        chess.reset();
        syncBoard();
        logger.info('Board reset by opponent');
      } else if (msg.type === 'color') {
        setMyColor(msg.color);
        logger.info(`You are playing as ${msg.color === 'w' ? 'White ♔' : 'Black ♚'}`);
      }
    };
  }, [chess, logger]);

  const onMessage = useCallback(async (msg: SignalingMessage) => {
    const pc = pcRef.current;
    if (!pc) return;
    switch (msg.type) {
      case 'peer-joined': {
        remotePeerIdRef.current = msg.peerId;
        logger.info(`Opponent joined — creating game channel as White…`);
        setMyColor('w');
        const dc = pc.createDataChannel('chess');
        setupDc(dc);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendRef.current({ type: 'offer', from: peerId, to: msg.peerId, sdp: offer });
        break;
      }
      case 'offer': {
        remotePeerIdRef.current = msg.from;
        setMyColor('b');
        logger.info('Offer received — joining as Black…');
        await pc.setRemoteDescription(msg.sdp);
        pc.ondatachannel = (ev) => setupDc(ev.channel);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendRef.current({ type: 'answer', from: peerId, to: msg.from, sdp: answer });
        break;
      }
      case 'answer':
        await pc.setRemoteDescription(msg.sdp);
        break;
      case 'ice-candidate':
        await pc.addIceCandidate(msg.candidate).catch(() => {});
        break;
    }
  }, [peerId, logger, setupDc]);

  const { status: sigStatus, connect, join, send, disconnect } = useSignaling({ logger, onMessage });
  sendRef.current = send;

  const handleJoin = () => {
    const pc = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcRef.current = pc;
    pc.onconnectionstatechange = () => setConnectionState(pc.connectionState);
    pc.onicecandidate = (ev) => {
      if (ev.candidate && remotePeerIdRef.current) {
        send({ type: 'ice-candidate', from: peerId, to: remotePeerIdRef.current, candidate: ev.candidate.toJSON() });
      }
    };
    connect();
    setTimeout(() => { join(roomId, peerId); setJoined(true); syncBoard(); }, 400);
  };

  const handleLeave = () => {
    pcRef.current?.close();
    disconnect();
    chess.reset();
    setJoined(false);
    setConnectionState('new');
    setSelected(null);
    setLegalMoves([]);
    setLastMove(null);
  };

  const handleReset = () => {
    chess.reset();
    syncBoard();
    setSelected(null);
    setLegalMoves([]);
    setLastMove(null);
    dcRef.current?.send(JSON.stringify({ type: 'reset' }));
  };

  useEffect(() => { syncBoard(); }, []);
  useEffect(() => { return () => { pcRef.current?.close(); }; }, []);

  const board = chess.board();
  const displayBoard = myColor === 'b' ? [...board].reverse().map((r) => [...r].reverse()) : board;
  const displayFiles = myColor === 'b' ? [...FILES].reverse() : FILES;
  const displayRanks = myColor === 'b' ? [...RANKS].reverse() : RANKS;

  return (
    <DemoLayout
      title="Chess Duel"
      difficulty="intermediate"
      description="Play chess against another person in real time via RTCDataChannel — powered by chess.js."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>chess.js</strong> handles all game logic: move validation, check, checkmate,
            and draw detection. Only the move coordinates (e.g., <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">e2→e4</code>)
            are transmitted via <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">RTCDataChannel</code> — a tiny
            JSON message per move. The full game state is reconstructed locally by both peers.
          </p>
          <p>
            Open a second tab with the same room code, click Join. The first peer plays White,
            the second plays Black.
          </p>
          {sigStatus !== 'connected' && (
            <p className="text-amber-400 text-xs">⚠ Run <code className="bg-surface-2 px-1 py-0.5 rounded">bun run dev</code> to start the signaling server.</p>
          )}
        </div>
      }
      hints={['First peer = White, second peer = Black', 'Click a piece to see legal moves highlighted', 'Promotion always picks Queen automatically']}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <ConnectionStatus state={connectionState} />
            <span className="text-xs text-zinc-500">Signaling: <span className={sigStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{sigStatus}</span></span>
            {joined && <span className="text-xs text-zinc-500">You are <span className={myColor === 'w' ? 'text-zinc-200' : 'text-zinc-500 font-bold'}>{myColor === 'w' ? '♔ White' : '♚ Black'}</span></span>}
          </div>

          {!joined ? (
            <div className="flex items-center gap-3">
              <div>
                <label className="text-xs text-zinc-500">Room Code</label>
                <input value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="block mt-1 bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-zinc-200 w-28 focus:outline-none focus:border-blue-500" />
              </div>
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg mt-4">
                Join Room
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Captured pieces & status */}
              <div className="flex items-center justify-between text-sm">
                <div>
                  <span className="text-xs text-zinc-500 mr-2">Black captured:</span>
                  <span className="text-lg">{capturedW.join(' ')}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={handleReset} className="text-xs px-2 py-1 bg-surface-2 hover:bg-surface-3 text-zinc-400 rounded transition-colors">Reset</button>
                  <button onClick={handleLeave} className="text-xs px-2 py-1 bg-red-900/40 hover:bg-red-900 text-red-400 rounded border border-red-800 transition-colors">Leave</button>
                </div>
              </div>

              {status && (
                <p className={`text-sm font-medium ${chess.isCheckmate() || chess.isDraw() ? 'text-amber-400' : chess.isCheck() ? 'text-red-400' : 'text-zinc-400'}`}>
                  {status}
                </p>
              )}

              {/* Board */}
              <div className="flex gap-2">
                <div className="flex flex-col justify-around text-xs text-zinc-600 py-1" style={{ fontSize: '10px' }}>
                  {displayRanks.map((r) => <span key={r} className="h-10 flex items-center">{r}</span>)}
                </div>
                <div>
                  <div className="grid grid-cols-8 border border-zinc-700 rounded-lg overflow-hidden" style={{ width: 'min(320px, 80vw)' }}>
                    {displayBoard.flat().map((piece, idx) => {
                      const rank = displayRanks[Math.floor(idx / 8)];
                      const file = displayFiles[idx % 8];
                      const square = `${file}${rank}` as Square;
                      const isLight = (Math.floor(idx / 8) + (idx % 8)) % 2 === 0;
                      const isSelected = selected === square;
                      const isLegal = legalMoves.includes(square);
                      const isLast = lastMove && (lastMove.from === square || lastMove.to === square);

                      return (
                        <div
                          key={idx}
                          onClick={() => handleSquareClick(square)}
                          className={`
                            aspect-square flex items-center justify-center cursor-pointer select-none transition-colors
                            ${isLight ? 'bg-amber-100/10' : 'bg-amber-900/20'}
                            ${isSelected ? '!bg-blue-600/60' : ''}
                            ${isLast && !isSelected ? '!bg-yellow-600/30' : ''}
                            ${chess.turn() === myColor && !chess.isGameOver() ? 'hover:brightness-125' : ''}
                          `}
                          style={{ fontSize: 'min(28px, 7vw)' }}
                        >
                          {isLegal && (
                            <div className={`absolute w-2 h-2 rounded-full ${piece ? 'ring-2 ring-emerald-400/80' : 'bg-emerald-400/50'}`} />
                          )}
                          {piece && (
                            <span className={`relative z-10 ${piece.color === 'w' ? 'text-white' : 'text-zinc-900'}`}
                              style={{ textShadow: piece.color === 'w' ? '0 1px 2px rgba(0,0,0,0.8)' : '0 1px 2px rgba(255,255,255,0.3)' }}>
                              {PIECE_UNICODE[piece.color][piece.type]}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex justify-around text-zinc-600 mt-1" style={{ fontSize: '10px', width: 'min(320px, 80vw)' }}>
                    {displayFiles.map((f) => <span key={f}>{f}</span>)}
                  </div>
                </div>
              </div>

              <div>
                <span className="text-xs text-zinc-500 mr-2">White captured:</span>
                <span className="text-lg">{capturedB.join(' ')}</span>
              </div>
            </div>
          )}
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'chess.js moves via RTCDataChannel' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
