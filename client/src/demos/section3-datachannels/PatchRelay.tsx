import { useMemo, useRef, useState } from 'react';
import DiffMatchPatch from 'diff-match-patch';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { createLoopbackDataChannelPair, type LoopbackDataChannelPair } from '@/lib/loopbackDataChannel';
import { formatBytes } from '@/lib/format';
import { Logger } from '@/lib/logger';

const SAMPLE_DOC = `Mission log: the relay is stable.

Peer A edits this briefing.
Peer B receives only patch text, not the full document body.

Try adding a sentence, deleting one, or changing a single word.`;

const CODE = `const patches = dmp.patch_make(previousText, nextText);
const patchText = dmp.patch_toText(patches);

channel.send(JSON.stringify({
  patchText,
  fullBytes: nextText.length,
  patchBytes: patchText.length,
}));

const [restored] = dmp.patch_apply(dmp.patch_fromText(patchText), currentText);`;

interface PatchStats {
  patchBytes: number;
  fullBytes: number;
}

export default function PatchRelay() {
  const logger = useMemo(() => new Logger(), []);
  const dmp = useMemo(() => new DiffMatchPatch(), []);
  const pairRef = useRef<LoopbackDataChannelPair | null>(null);
  const docARef = useRef(SAMPLE_DOC);
  const docBRef = useRef(SAMPLE_DOC);
  const [connected, setConnected] = useState(false);
  const [docA, setDocA] = useState(SAMPLE_DOC);
  const [docB, setDocB] = useState(SAMPLE_DOC);
  const [lastPatchA, setLastPatchA] = useState('// waiting for patch traffic');
  const [lastPatchB, setLastPatchB] = useState('// waiting for patch traffic');
  const [statsA, setStatsA] = useState<PatchStats | null>(null);
  const [statsB, setStatsB] = useState<PatchStats | null>(null);

  const connect = async () => {
    pairRef.current?.close();
    const pair = await createLoopbackDataChannelPair('patch-relay', { logger });
    pairRef.current = pair;

    pair.channelA.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as { patchText: string; fullBytes: number; patchBytes: number };
      const [nextDoc] = dmp.patch_apply(dmp.patch_fromText(payload.patchText), docARef.current);
      docARef.current = nextDoc;
      setDocA(nextDoc);
      setLastPatchA(payload.patchText);
      setStatsA({ patchBytes: payload.patchBytes, fullBytes: payload.fullBytes });
      logger.success('Peer A applied an incoming patch');
    };

    pair.channelB.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as { patchText: string; fullBytes: number; patchBytes: number };
      const [nextDoc] = dmp.patch_apply(dmp.patch_fromText(payload.patchText), docBRef.current);
      docBRef.current = nextDoc;
      setDocB(nextDoc);
      setLastPatchB(payload.patchText);
      setStatsB({ patchBytes: payload.patchBytes, fullBytes: payload.fullBytes });
      logger.success('Peer B applied an incoming patch');
    };

    setConnected(true);
    logger.success('Patch relay connected');
  };

  const updatePeer = (peer: 'A' | 'B', nextDoc: string) => {
    const current = peer === 'A' ? docARef.current : docBRef.current;
    const patches = dmp.patch_make(current, nextDoc);
    const patchText = dmp.patch_toText(patches);
    const stats = {
      patchBytes: new TextEncoder().encode(patchText).length,
      fullBytes: new TextEncoder().encode(nextDoc).length,
    };

    if (peer === 'A') {
      docARef.current = nextDoc;
      setDocA(nextDoc);
      setLastPatchB(patchText || '// no-op patch');
      setStatsB(stats);
      pairRef.current?.channelA.send(JSON.stringify({ patchText, ...stats }));
    } else {
      docBRef.current = nextDoc;
      setDocB(nextDoc);
      setLastPatchA(patchText || '// no-op patch');
      setStatsA(stats);
      pairRef.current?.channelB.send(JSON.stringify({ patchText, ...stats }));
    }
  };

  const renderStats = (stats: PatchStats | null) => {
    if (!stats) {
      return <p className="text-xs text-zinc-600">No patch applied yet</p>;
    }

    const saved = Math.max(0, stats.fullBytes - stats.patchBytes);
    return (
      <div className="flex gap-2 text-xs text-zinc-300">
        <div className="rounded-xl border border-zinc-800 bg-surface-0 px-3 py-2">
          Full: {formatBytes(stats.fullBytes)}
        </div>
        <div className="rounded-xl border border-zinc-800 bg-surface-0 px-3 py-2">
          Patch: {formatBytes(stats.patchBytes)}
        </div>
        <div className="rounded-xl border border-zinc-800 bg-surface-0 px-3 py-2 text-emerald-300">
          Saved: {formatBytes(saved)}
        </div>
      </div>
    );
  };

  return (
    <DemoLayout
      title="Patch Relay"
      difficulty="advanced"
      description="Send document patches instead of whole files by pairing RTCDataChannel with diff-match-patch."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Full document sync is simple, but it wastes bandwidth once the text gets large. This demo
            computes patch text with <strong>diff-match-patch</strong> and ships only the delta over WebRTC.
          </p>
          <p>
            The receiving peer applies the patch against its local copy and reports how many bytes were
            saved compared with resending the whole document.
          </p>
        </div>
      }
      hints={[
        'Small word edits produce tiny patch payloads.',
        'The lower panel shows the actual patch text that crossed the data channel.',
        'This pattern is useful for code review notes, drafts, and collaborative editors.',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <button
                onClick={connect}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Connect patch peers
              </button>
            ) : (
              <span className="rounded-xl border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
                Delta sync active
              </span>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Peer A document</p>
              <textarea
                value={docA}
                onChange={(event) => updatePeer('A', event.target.value)}
                className="h-56 w-full rounded-2xl border border-zinc-800 bg-surface-0 px-4 py-3 font-mono text-xs text-zinc-200 outline-none focus:border-blue-500"
              />
              {renderStats(statsA)}
              <pre className="max-h-40 overflow-auto rounded-2xl border border-zinc-800 bg-surface-0 p-4 text-[11px] text-zinc-400">
                {lastPatchA}
              </pre>
            </section>

            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">Peer B document</p>
              <textarea
                value={docB}
                onChange={(event) => updatePeer('B', event.target.value)}
                className="h-56 w-full rounded-2xl border border-zinc-800 bg-surface-0 px-4 py-3 font-mono text-xs text-zinc-200 outline-none focus:border-fuchsia-500"
              />
              {renderStats(statsB)}
              <pre className="max-h-40 overflow-auto rounded-2xl border border-zinc-800 bg-surface-0 p-4 text-[11px] text-zinc-400">
                {lastPatchB}
              </pre>
            </section>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Patch generation + application over RTCDataChannel' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
