import { useMemo, useRef, useState, useCallback, useEffect } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { ConnectionStatus } from '@/components/ui/ConnectionStatus';
import { Logger } from '@/lib/logger';
import { useSignaling } from '@/hooks/useSignaling';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';
import { v4 as uuidv4 } from 'uuid';
import type { SignalingMessage } from '@/types/signaling';

type ColumnId = 'todo' | 'doing' | 'done';

interface Card {
  id: string;
  title: string;
  label?: string;
}

interface BoardState {
  todo: Card[];
  doing: Card[];
  done: Card[];
}

const COLUMN_LABELS: Record<ColumnId, string> = {
  todo: 'To Do',
  doing: 'In Progress',
  done: 'Done',
};

const COLUMN_COLORS: Record<ColumnId, string> = {
  todo: 'border-blue-700/50',
  doing: 'border-amber-700/50',
  done: 'border-emerald-700/50',
};

const LABEL_COLORS: Record<string, string> = {
  feature: 'bg-blue-900/60 text-blue-300',
  bug: 'bg-red-900/60 text-red-300',
  design: 'bg-purple-900/60 text-purple-300',
  docs: 'bg-amber-900/60 text-amber-300',
};

const INITIAL_BOARD: BoardState = {
  todo: [
    { id: 'c1', title: 'Set up signaling server', label: 'feature' },
    { id: 'c2', title: 'Write RTCDataChannel sync', label: 'feature' },
    { id: 'c3', title: 'Fix ICE candidate race condition', label: 'bug' },
  ],
  doing: [
    { id: 'c4', title: 'Design kanban UI', label: 'design' },
  ],
  done: [
    { id: 'c5', title: 'Set up Vite + React project', label: 'docs' },
  ],
};

function SortableCard({ card, onDelete }: { card: Card; onDelete: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`bg-surface-2 border border-zinc-700 rounded-lg p-2.5 cursor-grab active:cursor-grabbing select-none transition-shadow group
        ${isDragging ? 'opacity-40 shadow-lg ring-1 ring-blue-500' : 'hover:border-zinc-600'}`}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-sm text-zinc-200 leading-snug flex-1">{card.title}</p>
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(card.id); }}
          className="text-zinc-700 hover:text-zinc-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0 text-xs leading-none mt-0.5"
        >
          ✕
        </button>
      </div>
      {card.label && (
        <span className={`mt-1.5 inline-block text-xs px-1.5 py-0.5 rounded font-medium ${LABEL_COLORS[card.label] ?? 'bg-zinc-800 text-zinc-400'}`}>
          {card.label}
        </span>
      )}
    </div>
  );
}

const CODE = `// Kanban state sync via RTCDataChannel
// Full board state sent on every change (for small boards this is fine)
function syncBoard(board: BoardState) {
  dc.send(JSON.stringify({ type: 'board', state: board }));
}

// Receive remote board state
dc.onmessage = ({ data }) => {
  const { type, state } = JSON.parse(data);
  if (type === 'board') setBoard(state);
};`;

export default function KanbanBoard() {
  const logger = useMemo(() => new Logger(), []);
  const [roomId, setRoomId] = useState(() => Math.random().toString(36).slice(2, 8).toUpperCase());
  const peerId = useMemo(() => uuidv4().slice(0, 8), []);
  const [joined, setJoined] = useState(false);
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const [board, setBoard] = useState<BoardState>(INITIAL_BOARD);
  const [addingTo, setAddingTo] = useState<ColumnId | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newLabel, setNewLabel] = useState('feature');
  const [activeId, setActiveId] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const sendRef = useRef<(msg: SignalingMessage) => void>(() => {});
  const isRemote = useRef(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const syncBoard = useCallback((b: BoardState) => {
    if (isRemote.current) return;
    dcRef.current?.send(JSON.stringify({ type: 'board', state: b }));
  }, []);

  const updateBoard = useCallback((b: BoardState) => {
    setBoard(b);
    syncBoard(b);
  }, [syncBoard]);

  const findCardColumn = (cardId: string): ColumnId | null => {
    for (const col of ['todo', 'doing', 'done'] as ColumnId[]) {
      if (board[col].some((c) => c.id === cardId)) return col;
    }
    return null;
  };

  const handleDragStart = (ev: DragStartEvent) => setActiveId(ev.active.id as string);

  const handleDragEnd = (ev: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = ev;
    if (!over) return;

    const fromCol = findCardColumn(active.id as string);
    const toCol = findCardColumn(over.id as string) ?? (over.id as ColumnId);
    if (!fromCol) return;

    const newBoard = { ...board, [fromCol]: [...board[fromCol]], [toCol]: [...board[toCol]] };

    if (fromCol === toCol) {
      const oldIdx = newBoard[fromCol].findIndex((c) => c.id === active.id);
      const newIdx = newBoard[fromCol].findIndex((c) => c.id === over.id);
      if (oldIdx !== -1 && newIdx !== -1) {
        newBoard[fromCol] = arrayMove(newBoard[fromCol], oldIdx, newIdx);
        updateBoard(newBoard);
      }
    } else {
      const card = newBoard[fromCol].find((c) => c.id === active.id);
      if (!card) return;
      newBoard[fromCol] = newBoard[fromCol].filter((c) => c.id !== active.id);
      const insertAt = newBoard[toCol].findIndex((c) => c.id === over.id);
      if (insertAt === -1) newBoard[toCol].push(card);
      else newBoard[toCol].splice(insertAt, 0, card);
      updateBoard(newBoard);
      logger.info(`Moved "${card.title}" → ${COLUMN_LABELS[toCol]}`);
    }
  };

  const handleAddCard = (col: ColumnId) => {
    if (!newTitle.trim()) return;
    const card: Card = { id: uuidv4().slice(0, 8), title: newTitle.trim(), label: newLabel };
    const newBoard = { ...board, [col]: [...board[col], card] };
    updateBoard(newBoard);
    setNewTitle('');
    setAddingTo(null);
    logger.info(`Added card: "${card.title}" to ${COLUMN_LABELS[col]}`);
  };

  const handleDeleteCard = (cardId: string) => {
    const col = findCardColumn(cardId);
    if (!col) return;
    const newBoard = { ...board, [col]: board[col].filter((c) => c.id !== cardId) };
    updateBoard(newBoard);
  };

  const setupDc = useCallback((dc: RTCDataChannel) => {
    dcRef.current = dc;
    dc.onopen = () => {
      logger.success('Board channel open — drag cards to collaborate!');
      dc.send(JSON.stringify({ type: 'board', state: board }));
    };
    dc.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string);
      if (msg.type === 'board') {
        isRemote.current = true;
        setBoard(msg.state);
        setTimeout(() => { isRemote.current = false; }, 0);
      }
    };
  }, [board, logger]);

  const onMessage = useCallback(async (msg: SignalingMessage) => {
    const pc = pcRef.current;
    if (!pc) return;
    switch (msg.type) {
      case 'peer-joined': {
        remotePeerIdRef.current = msg.peerId;
        const dc = pc.createDataChannel('kanban');
        setupDc(dc);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        sendRef.current({ type: 'offer', from: peerId, to: msg.peerId, sdp: offer });
        break;
      }
      case 'offer':
        remotePeerIdRef.current = msg.from;
        await pc.setRemoteDescription(msg.sdp);
        pc.ondatachannel = (ev) => setupDc(ev.channel);
        {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendRef.current({ type: 'answer', from: peerId, to: msg.from, sdp: answer });
        }
        break;
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
    setTimeout(() => { join(roomId, peerId); setJoined(true); }, 400);
  };

  const handleLeave = () => {
    pcRef.current?.close();
    disconnect();
    setJoined(false);
    setConnectionState('new');
  };

  useEffect(() => { return () => { pcRef.current?.close(); }; }, []);

  return (
    <DemoLayout
      title="P2P Kanban Board"
      difficulty="intermediate"
      description="A collaborative drag-and-drop Kanban board powered by @dnd-kit and synced over RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            <strong>@dnd-kit</strong> provides accessible, performant drag-and-drop for React.
            Cards can be reordered within a column or moved between columns. Every change
            broadcasts the full board state as JSON over <code className="text-xs bg-surface-2 px-1 py-0.5 rounded">RTCDataChannel</code>.
          </p>
          <p>
            Open a second tab with the same room code and drag cards — both boards stay in sync
            without a database or backend storage. Perfect for lightweight real-time team boards.
          </p>
          {sigStatus !== 'connected' && (
            <p className="text-amber-400 text-xs">⚠ Run <code className="bg-surface-2 px-1 py-0.5 rounded">bun run dev</code> to start the signaling server.</p>
          )}
        </div>
      }
      hints={['Open two tabs with the same room code', 'Drag cards between columns — changes sync instantly', 'Click ✕ on a card to delete it from both boards']}
      demo={
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <ConnectionStatus state={connectionState} />
            <span className="text-xs text-zinc-500">Signaling: <span className={sigStatus === 'connected' ? 'text-emerald-400' : 'text-amber-400'}>{sigStatus}</span></span>
          </div>

          {!joined ? (
            <div className="flex items-center gap-3">
              <div>
                <label className="text-xs text-zinc-500">Room Code</label>
                <input value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="block mt-1 bg-surface-0 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm font-mono text-zinc-200 w-28 focus:outline-none focus:border-blue-500" />
              </div>
              <button onClick={handleJoin} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg mt-4">Join Room</button>
            </div>
          ) : (
            <div className="flex justify-end">
              <button onClick={handleLeave} className="px-3 py-1.5 bg-red-900/40 text-red-400 text-xs rounded border border-red-800">Leave</button>
            </div>
          )}

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {(['todo', 'doing', 'done'] as ColumnId[]).map((col) => (
                <div key={col} className={`bg-surface-0 border-2 ${COLUMN_COLORS[col]} rounded-xl p-3 space-y-2 min-h-48`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-zinc-300">{COLUMN_LABELS[col]}</h3>
                    <span className="text-xs text-zinc-600 bg-surface-2 px-1.5 py-0.5 rounded-full">{board[col].length}</span>
                  </div>

                  <SortableContext items={board[col].map((c) => c.id)} strategy={verticalListSortingStrategy}>
                    {board[col].map((card) => (
                      <SortableCard key={card.id} card={card} onDelete={handleDeleteCard} />
                    ))}
                  </SortableContext>

                  {addingTo === col ? (
                    <div className="space-y-1.5 pt-1">
                      <input
                        autoFocus
                        value={newTitle}
                        onChange={(e) => setNewTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddCard(col); if (e.key === 'Escape') setAddingTo(null); }}
                        placeholder="Card title…"
                        className="w-full bg-surface-2 border border-zinc-600 rounded-lg px-2.5 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-blue-500"
                      />
                      <select
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        className="w-full bg-surface-2 border border-zinc-700 rounded-lg px-2 py-1 text-xs text-zinc-400 focus:outline-none"
                      >
                        {Object.keys(LABEL_COLORS).map((l) => <option key={l} value={l}>{l}</option>)}
                      </select>
                      <div className="flex gap-1.5">
                        <button onClick={() => handleAddCard(col)} className="flex-1 text-xs py-1 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors">Add</button>
                        <button onClick={() => setAddingTo(null)} className="flex-1 text-xs py-1 bg-surface-2 hover:bg-surface-3 text-zinc-400 rounded transition-colors">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingTo(col)}
                      className="w-full text-xs text-zinc-600 hover:text-zinc-400 py-1.5 border border-dashed border-zinc-800 hover:border-zinc-600 rounded-lg transition-colors"
                    >
                      + Add card
                    </button>
                  )}
                </div>
              ))}
            </div>
          </DndContext>
          <p className="text-xs text-zinc-600">Active card: {activeId ?? 'none'}</p>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Board state sync via RTCDataChannel' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
