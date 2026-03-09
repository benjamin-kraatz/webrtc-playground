import { useMemo, useRef, useState } from 'react';
import { formatHex, interpolate } from 'culori';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { createLoopbackDataChannelPair, type LoopbackDataChannelPair } from '@/lib/loopbackDataChannel';
import { Logger } from '@/lib/logger';

type GradientMode = 'rgb' | 'lab' | 'lch' | 'oklch';

interface GradientState {
  start: string;
  end: string;
  mode: GradientMode;
  angle: number;
}

const START_STATE: GradientState = {
  start: '#2dd4bf',
  end: '#7c3aed',
  mode: 'oklch',
  angle: 135,
};

const COSMIC_PRESETS: GradientState[] = [
  START_STATE,
  { start: '#fb7185', end: '#facc15', mode: 'lch', angle: 45 },
  { start: '#38bdf8', end: '#34d399', mode: 'lab', angle: 90 },
];

const CODE = `const mix = interpolate([start, end], 'oklch');
const swatches = Array.from({ length: 8 }, (_, index) =>
  formatHex(mix(index / 7))
);

channel.send(JSON.stringify({ start, end, mode, angle }));`;

function buildPalette(state: GradientState) {
  const mix = interpolate([state.start, state.end], state.mode);
  return Array.from({ length: 10 }, (_, index) => formatHex(mix(index / 9)) ?? '#000000');
}

function NebulaPreview({ state }: { state: GradientState }) {
  const palette = useMemo(() => buildPalette(state), [state]);

  return (
    <div className="space-y-3">
      <div
        className="h-44 rounded-3xl border border-zinc-800"
        style={{
          background: `linear-gradient(${state.angle}deg, ${palette.join(', ')})`,
          boxShadow: `0 0 80px ${palette[2]}33 inset`,
        }}
      />
      <div className="grid grid-cols-5 gap-2">
        {palette.map((color) => (
          <div key={color} className="space-y-1">
            <div className="h-10 rounded-xl border border-zinc-800" style={{ backgroundColor: color }} />
            <p className="truncate text-[10px] text-zinc-500">{color}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GradientNebula() {
  const logger = useMemo(() => new Logger(), []);
  const pairRef = useRef<LoopbackDataChannelPair | null>(null);
  const [connected, setConnected] = useState(false);
  const [stateA, setStateA] = useState<GradientState>(START_STATE);
  const [stateB, setStateB] = useState<GradientState>(START_STATE);

  const connect = async () => {
    pairRef.current?.close();
    const pair = await createLoopbackDataChannelPair('gradient-nebula', { logger });
    pairRef.current = pair;

    pair.channelA.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as GradientState;
      setStateA(payload);
      logger.info('Peer A received a gradient state update');
    };

    pair.channelB.onmessage = (event) => {
      const payload = JSON.parse(event.data as string) as GradientState;
      setStateB(payload);
      logger.info('Peer B received a gradient state update');
    };

    setConnected(true);
    logger.success('Gradient nebula connected');
  };

  const pushState = (peer: 'A' | 'B', next: GradientState) => {
    if (peer === 'A') {
      setStateA(next);
      pairRef.current?.channelA.send(JSON.stringify(next));
    } else {
      setStateB(next);
      pairRef.current?.channelB.send(JSON.stringify(next));
    }
  };

  const controls = (peer: 'A' | 'B', state: GradientState) => (
    <div className="space-y-3 rounded-2xl border border-zinc-800 bg-surface-0 p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs text-zinc-400">
          Start
          <input
            type="color"
            value={state.start}
            onChange={(event) => pushState(peer, { ...state, start: event.target.value })}
            className="h-10 w-full rounded-xl border border-zinc-800 bg-transparent"
          />
        </label>
        <label className="space-y-1 text-xs text-zinc-400">
          End
          <input
            type="color"
            value={state.end}
            onChange={(event) => pushState(peer, { ...state, end: event.target.value })}
            className="h-10 w-full rounded-xl border border-zinc-800 bg-transparent"
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="space-y-1 text-xs text-zinc-400">
          Interpolation
          <select
            value={state.mode}
            onChange={(event) => pushState(peer, { ...state, mode: event.target.value as GradientMode })}
            className="w-full rounded-xl border border-zinc-800 bg-surface-1 px-3 py-2 text-sm text-zinc-200 outline-none"
          >
            <option value="rgb">rgb</option>
            <option value="lab">lab</option>
            <option value="lch">lch</option>
            <option value="oklch">oklch</option>
          </select>
        </label>

        <label className="space-y-1 text-xs text-zinc-400">
          Angle {state.angle}°
          <input
            type="range"
            min={0}
            max={360}
            value={state.angle}
            onChange={(event) => pushState(peer, { ...state, angle: Number(event.target.value) })}
            className={peer === 'A' ? 'w-full accent-blue-400' : 'w-full accent-fuchsia-400'}
          />
        </label>
      </div>
    </div>
  );

  return (
    <DemoLayout
      title="Gradient Nebula"
      difficulty="advanced"
      description="Craft color-interpolated peer-synced nebula gradients with Culori and RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Raw hex colors are not enough if you want smooth perceptual blends. <strong>Culori</strong>
            lets the demo interpolate in spaces like Lab, LCH, and OKLCH while WebRTC keeps each peer's
            controls in lockstep.
          </p>
          <p>
            This is the kind of small but powerful package pairing that makes creative WebRTC tools feel polished.
          </p>
        </div>
      }
      hints={[
        'Switch between rgb and oklch to see the same endpoints blend very differently.',
        'Use the preset buttons to jump between wildly different cosmic palettes.',
        'All the other peer really needs is the gradient state object; Culori reconstructs the art locally.',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            {!connected ? (
              <button
                onClick={connect}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Connect gradient peers
              </button>
            ) : (
              <span className="rounded-xl border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
                Gradient sync live
              </span>
            )}

            {COSMIC_PRESETS.map((preset, index) => (
              <button
                key={`${preset.start}-${preset.end}-${index}`}
                onClick={() => {
                  setStateA(preset);
                  setStateB(preset);
                  if (pairRef.current) {
                    pairRef.current.channelA.send(JSON.stringify(preset));
                    pairRef.current.channelB.send(JSON.stringify(preset));
                  }
                }}
                className="rounded-xl bg-surface-2 px-3 py-2 text-xs text-zinc-300 hover:bg-surface-3"
              >
                Preset {index + 1}
              </button>
            ))}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Peer A nebula</p>
              {controls('A', stateA)}
              <NebulaPreview state={stateA} />
            </section>

            <section className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">Peer B nebula</p>
              {controls('B', stateB)}
              <NebulaPreview state={stateB} />
            </section>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Perceptual color interpolation over WebRTC' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
