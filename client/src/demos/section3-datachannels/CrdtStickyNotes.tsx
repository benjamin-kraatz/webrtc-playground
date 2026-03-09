import { useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { createLoopbackDataChannelPair, type LoopbackDataChannelPair } from '@/lib/loopbackDataChannel';
import { clamp } from '@/lib/format';
import { Logger } from '@/lib/logger';

interface StickyNote {
  id: string;
  text: string;
  color: string;
  x: number;
  y: number;
  author: 'A' | 'B';
}

const COLORS = ['#38bdf8', '#a855f7', '#f97316', '#22c55e', '#eab308'];

const CODE = `const doc = new Y.Doc();
const notes = doc.getMap('notes');

doc.on('update', (update, origin) => {
  if (origin !== 'remote-peer') channel.send(update);
});

channel.onmessage = (event) => {
  Y.applyUpdate(doc, new Uint8Array(event.data), 'remote-peer');
};`;

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function notesFromMap(map: Y.Map<StickyNote>) {
  return Array.from(map.values()).sort((a, b) => a.y - b.y || a.x - b.x);
}

export default function CrdtStickyNotes() {
  const logger = useMemo(() => new Logger(), []);
  const pairRef = useRef<LoopbackDataChannelPair | null>(null);
  const docARef = useRef<Y.Doc | null>(null);
  const docBRef = useRef<Y.Doc | null>(null);
  const notesARef = useRef<Y.Map<StickyNote> | null>(null);
  const notesBRef = useRef<Y.Map<StickyNote> | null>(null);
  const [connected, setConnected] = useState(false);
  const [notesA, setNotesA] = useState<StickyNote[]>([]);
  const [notesB, setNotesB] = useState<StickyNote[]>([]);

  const connect = async () => {
    pairRef.current?.close();
    docARef.current?.destroy();
    docBRef.current?.destroy();

    const pair = await createLoopbackDataChannelPair('crdt-sticky-notes', { logger });
    pair.channelA.binaryType = 'arraybuffer';
    pair.channelB.binaryType = 'arraybuffer';

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const mapA = docA.getMap<StickyNote>('notes');
    const mapB = docB.getMap<StickyNote>('notes');

    docA.on('update', (update, origin) => {
      if (origin !== 'peer-b') {
        pair.channelA.send(toArrayBuffer(update));
      }
    });

    docB.on('update', (update, origin) => {
      if (origin !== 'peer-a') {
        pair.channelB.send(toArrayBuffer(update));
      }
    });

    mapA.observe(() => setNotesA(notesFromMap(mapA)));
    mapB.observe(() => setNotesB(notesFromMap(mapB)));

    pair.channelA.onmessage = (event) => {
      Y.applyUpdate(docA, new Uint8Array(event.data as ArrayBuffer), 'peer-b');
      logger.info('Peer A applied a CRDT update');
    };

    pair.channelB.onmessage = (event) => {
      Y.applyUpdate(docB, new Uint8Array(event.data as ArrayBuffer), 'peer-a');
      logger.info('Peer B applied a CRDT update');
    };

    pairRef.current = pair;
    docARef.current = docA;
    docBRef.current = docB;
    notesARef.current = mapA;
    notesBRef.current = mapB;
    setNotesA([]);
    setNotesB([]);
    setConnected(true);
    logger.success('CRDT sticky notes connected');
  };

  const addNote = (peer: 'A' | 'B') => {
    const map = peer === 'A' ? notesARef.current : notesBRef.current;
    if (!map) return;

    const note: StickyNote = {
      id: crypto.randomUUID(),
      text: peer === 'A' ? 'Peer A idea' : 'Peer B remix',
      color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? '#38bdf8',
      x: Math.floor(Math.random() * 220),
      y: Math.floor(Math.random() * 180),
      author: peer,
    };

    map.set(note.id, note);
    logger.success(`${peer} created a sticky note`);
  };

  const mutateNote = (peer: 'A' | 'B', id: string, patch: Partial<StickyNote>) => {
    const map = peer === 'A' ? notesARef.current : notesBRef.current;
    const current = map?.get(id);
    if (!map || !current) return;

    map.set(id, {
      ...current,
      ...patch,
      x: clamp((patch.x ?? current.x), 0, 240),
      y: clamp((patch.y ?? current.y), 0, 190),
    });
  };

  const removeNote = (peer: 'A' | 'B', id: string) => {
    const map = peer === 'A' ? notesARef.current : notesBRef.current;
    map?.delete(id);
    logger.info(`${peer} removed a sticky note`);
  };

  const renderBoard = (peer: 'A' | 'B', notes: StickyNote[], accent: string) => (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${accent}`}>Peer {peer}</p>
        <button
          onClick={() => addNote(peer)}
          disabled={!connected}
          className="rounded-xl bg-surface-2 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-surface-3 disabled:opacity-50"
        >
          Add sticky
        </button>
      </div>

      <div className="relative h-[300px] overflow-hidden rounded-3xl border border-zinc-800 bg-surface-0">
        {notes.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-zinc-600">
            Add a sticky note and watch the CRDT replicate it.
          </div>
        )}

        {notes.map((note) => (
          <div
            key={note.id}
            className="absolute w-40 rounded-2xl border border-white/10 p-3 shadow-lg"
            style={{
              left: note.x,
              top: note.y,
              backgroundColor: `${note.color}22`,
              boxShadow: `0 12px 30px ${note.color}20`,
            }}
          >
            <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-zinc-300">
              <span>{note.author === 'A' ? 'Blue desk' : 'Pink desk'}</span>
              <button onClick={() => removeNote(peer, note.id)} className="text-zinc-500 hover:text-zinc-200">
                ×
              </button>
            </div>
            <textarea
              value={note.text}
              onChange={(event) => mutateNote(peer, note.id, { text: event.target.value })}
              className="h-20 w-full resize-none rounded-xl border border-white/10 bg-black/10 px-2 py-1 text-xs text-zinc-100 outline-none"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="grid grid-cols-2 gap-1 text-xs">
                <button onClick={() => mutateNote(peer, note.id, { y: note.y - 16 })} className="rounded-lg bg-black/20 px-2 py-1 text-zinc-200">↑</button>
                <button onClick={() => mutateNote(peer, note.id, { x: note.x + 16 })} className="rounded-lg bg-black/20 px-2 py-1 text-zinc-200">→</button>
                <button onClick={() => mutateNote(peer, note.id, { x: note.x - 16 })} className="rounded-lg bg-black/20 px-2 py-1 text-zinc-200">←</button>
                <button onClick={() => mutateNote(peer, note.id, { y: note.y + 16 })} className="rounded-lg bg-black/20 px-2 py-1 text-zinc-200">↓</button>
              </div>
              <input
                type="color"
                value={note.color}
                onChange={(event) => mutateNote(peer, note.id, { color: event.target.value })}
                className="h-8 w-8 rounded-lg border border-white/10 bg-transparent"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <DemoLayout
      title="CRDT Sticky Notes"
      difficulty="advanced"
      description="Use Yjs updates over RTCDataChannel to keep a peer-to-peer sticky-note wall synchronized without a central server."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This demo pairs a <strong>Yjs</strong> document with RTCDataChannel transport. Each browser
            keeps its own CRDT copy, sends binary updates to the other peer, and merges remote changes automatically.
          </p>
          <p>
            It is the same architectural pattern behind robust peer-to-peer collaborative editors, boards, and whiteboards.
          </p>
        </div>
      }
      hints={[
        'Create notes on either side, then edit text, move them around, or recolor them.',
        'The payload crossing the wire is Yjs binary update data, not whole-board JSON snapshots.',
        'Because each side keeps a CRDT document, merges stay deterministic even as edits pile up.',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <button
                onClick={connect}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Connect CRDT peers
              </button>
            ) : (
              <span className="rounded-xl border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
                CRDT replication live
              </span>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            {renderBoard('A', notesA, 'text-blue-300')}
            {renderBoard('B', notesB, 'text-fuchsia-300')}
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Yjs CRDT updates over RTCDataChannel' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
