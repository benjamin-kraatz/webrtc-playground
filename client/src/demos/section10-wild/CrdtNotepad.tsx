import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { createLoopbackDataPair, type LoopbackDataPair } from '@/lib/createLoopbackDataPair';

const CODE = `// Yjs CRDT updates over RTCDataChannel
docA.on('update', (update, origin) => {
  if (origin !== 'remote') dcA.send(update); // Uint8Array payload
});

dcA.onmessage = (ev) => {
  Y.applyUpdate(docA, new Uint8Array(ev.data), 'remote');
};`;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

export default function CrdtNotepad() {
  const logger = useMemo(() => new Logger(), []);
  const [connected, setConnected] = useState(false);
  const [textA, setTextA] = useState('Peer A: start typing a collaborative note...');
  const [textB, setTextB] = useState('Peer B: changes merge automatically via CRDT.');

  const pairRef = useRef<LoopbackDataPair | null>(null);
  const docARef = useRef<Y.Doc | null>(null);
  const docBRef = useRef<Y.Doc | null>(null);
  const yTextARef = useRef<Y.Text | null>(null);
  const yTextBRef = useRef<Y.Text | null>(null);

  const teardown = () => {
    pairRef.current?.close();
    pairRef.current = null;
    docARef.current?.destroy();
    docBRef.current?.destroy();
    docARef.current = null;
    docBRef.current = null;
    yTextARef.current = null;
    yTextBRef.current = null;
    setConnected(false);
  };

  const connect = async () => {
    teardown();
    const pair = await createLoopbackDataPair('crdt-notepad');
    pairRef.current = pair;
    pair.dcA.binaryType = 'arraybuffer';
    pair.dcB.binaryType = 'arraybuffer';

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const yTextA = docA.getText('note');
    const yTextB = docB.getText('note');

    docARef.current = docA;
    docBRef.current = docB;
    yTextARef.current = yTextA;
    yTextBRef.current = yTextB;

    yTextA.observe(() => setTextA(yTextA.toString()));
    yTextB.observe(() => setTextB(yTextB.toString()));

    docA.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote' || pair.dcA.readyState !== 'open') return;
      pair.dcA.send(toArrayBuffer(update));
    });
    docB.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote' || pair.dcB.readyState !== 'open') return;
      pair.dcB.send(toArrayBuffer(update));
    });

    pair.dcA.onmessage = (ev) => Y.applyUpdate(docA, new Uint8Array(ev.data as ArrayBuffer), 'remote');
    pair.dcB.onmessage = (ev) => Y.applyUpdate(docB, new Uint8Array(ev.data as ArrayBuffer), 'remote');

    yTextA.insert(0, textA);
    yTextB.insert(0, textB);
    pair.dcA.send(toArrayBuffer(Y.encodeStateAsUpdate(docA)));
    pair.dcB.send(toArrayBuffer(Y.encodeStateAsUpdate(docB)));

    setConnected(true);
    logger.success('CRDT peers connected. Concurrent edits now merge deterministically.');
  };

  const updateText = (side: 'A' | 'B', value: string) => {
    const text = side === 'A' ? yTextARef.current : yTextBRef.current;
    if (!text) return;
    text.doc?.transact(() => {
      text.delete(0, text.length);
      text.insert(0, value);
    }, 'local-input');
  };

  useEffect(() => () => teardown(), []);

  return (
    <DemoLayout
      title="CRDT Notepad Warp (Yjs)"
      difficulty="advanced"
      description="A two-peer collaborative notepad where edits merge with CRDT logic over RTCDataChannel."
      explanation={
        <div className="space-y-2 text-sm">
          <p>Instead of last-write-wins, this demo uses <strong>Yjs</strong> CRDT updates, so concurrent typing merges consistently.</p>
          <p>Each peer sends binary document updates over WebRTC DataChannels. No server merge logic required.</p>
        </div>
      }
      demo={
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            {!connected ? (
              <button onClick={connect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg">Connect CRDT Loopback</button>
            ) : (
              <button onClick={teardown} className="px-4 py-2 bg-rose-700 hover:bg-rose-600 text-white text-sm rounded-lg">Disconnect</button>
            )}
            <span className={`text-xs ${connected ? 'text-emerald-400' : 'text-zinc-500'}`}>
              {connected ? 'Yjs updates flowing' : 'Disconnected'}
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-zinc-500 mb-1">Peer A ({textA.length} chars)</p>
              <textarea
                value={textA}
                onChange={(e) => updateText('A', e.target.value)}
                disabled={!connected}
                className="w-full h-48 bg-surface-0 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 disabled:opacity-50"
              />
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1">Peer B ({textB.length} chars)</p>
              <textarea
                value={textB}
                onChange={(e) => updateText('B', e.target.value)}
                disabled={!connected}
                className="w-full h-48 bg-surface-0 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 disabled:opacity-50"
              />
            </div>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Yjs CRDT updates over DataChannel' }}
      hints={['Try typing in both panes quickly; content converges instead of clobbering.', 'Binary DataChannel payloads keep updates compact.']}
      mdnLinks={[{ label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' }]}
    />
  );
}
