import { createNoise2D } from 'simplex-noise';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { createLoopbackDataChannelPair, type LoopbackDataChannelPair } from '@/lib/loopbackDataChannel';
import { Logger } from '@/lib/logger';

interface StormState {
  seed: number;
  stormX: number;
  stormY: number;
  intensity: number;
  speed: number;
}

const DEFAULT_STATE: StormState = {
  seed: 7,
  stormX: 0.38,
  stormY: 0.46,
  intensity: 0.65,
  speed: 0.22,
};

const CODE = `const noise2D = createNoise2D(seedFn);
const field = noise2D(x / 18 + t * speed, y / 18);
const storm = Math.max(0, 1 - distance(x, y, stormX, stormY) * 1.8);

channel.send(JSON.stringify({
  seed,
  stormX,
  stormY,
  intensity,
  speed,
}));`;

function mulberry32(seed: number) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let value = Math.imul(t ^ (t >>> 15), t | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function drawStorm(canvas: HTMLCanvasElement | null, state: StormState, time: number) {
  if (!canvas) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return;
  }

  const image = ctx.createImageData(width, height);
  const noise2D = createNoise2D(mulberry32(state.seed));

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = x / width - state.stormX;
      const dy = y / height - state.stormY;
      const radius = Math.sqrt(dx * dx + dy * dy);
      const pressure = noise2D(x / 26 + time * state.speed, y / 26 - time * state.speed * 0.6);
      const storm = Math.max(0, 1 - radius * 2.4) * state.intensity;
      const vapor = (pressure + 1) / 2;
      const energy = Math.min(1, vapor * 0.6 + storm * 0.8);

      const offset = (y * width + x) * 4;
      image.data[offset] = 18 + energy * 70;
      image.data[offset + 1] = 30 + vapor * 80 + storm * 40;
      image.data[offset + 2] = 72 + energy * 160;
      image.data[offset + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(state.stormX * width, state.stormY * height, 10 + state.intensity * 22, 0, Math.PI * 2);
  ctx.stroke();
}

function StormCanvas({
  state,
  onPoint,
}: {
  state: StormState;
  onPoint: (x: number, y: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let frame = 0;
    let raf = 0;

    const loop = () => {
      frame += 1;
      drawStorm(canvasRef.current, state, frame / 60);
      raf = requestAnimationFrame(loop);
    };

    loop();
    return () => cancelAnimationFrame(raf);
  }, [state]);

  return (
    <canvas
      ref={canvasRef}
      width={520}
      height={280}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onPoint((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
      }}
      className="w-full rounded-3xl border border-zinc-800 bg-surface-0"
    />
  );
}

export default function SignalStorm() {
  const logger = useMemo(() => new Logger(), []);
  const pairRef = useRef<LoopbackDataChannelPair | null>(null);
  const [connected, setConnected] = useState(false);
  const [stateA, setStateA] = useState<StormState>(DEFAULT_STATE);
  const [stateB, setStateB] = useState<StormState>(DEFAULT_STATE);

  const connect = async () => {
    pairRef.current?.close();
    const pair = await createLoopbackDataChannelPair('signal-storm', { logger });
    pairRef.current = pair;

    pair.channelA.onmessage = (event) => {
      setStateA(JSON.parse(event.data as string) as StormState);
      logger.info('Peer A received storm controls');
    };

    pair.channelB.onmessage = (event) => {
      setStateB(JSON.parse(event.data as string) as StormState);
      logger.info('Peer B received storm controls');
    };

    setConnected(true);
    logger.success('Signal storm connected');
  };

  const updateState = (peer: 'A' | 'B', next: StormState) => {
    if (peer === 'A') {
      setStateA(next);
      pairRef.current?.channelA.send(JSON.stringify(next));
    } else {
      setStateB(next);
      pairRef.current?.channelB.send(JSON.stringify(next));
    }
  };

  const controls = (peer: 'A' | 'B', state: StormState) => (
    <div className="grid gap-3 rounded-2xl border border-zinc-800 bg-surface-0 p-4 md:grid-cols-3">
      <label className="space-y-1 text-xs text-zinc-400">
        Seed
        <div className="flex gap-2">
          <input
            type="number"
            value={state.seed}
            onChange={(event) => updateState(peer, { ...state, seed: Number(event.target.value) })}
            className="w-full rounded-xl border border-zinc-800 bg-surface-1 px-3 py-2 text-sm text-zinc-200 outline-none"
          />
          <button
            onClick={() => updateState(peer, { ...state, seed: Math.floor(Math.random() * 9999) })}
            className="rounded-xl bg-surface-1 px-3 py-2 text-xs text-zinc-200 hover:bg-surface-2"
          >
            Random
          </button>
        </div>
      </label>

      <label className="space-y-1 text-xs text-zinc-400">
        Intensity {(state.intensity * 100).toFixed(0)}%
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.01}
          value={state.intensity}
          onChange={(event) => updateState(peer, { ...state, intensity: Number(event.target.value) })}
          className={peer === 'A' ? 'w-full accent-blue-400' : 'w-full accent-fuchsia-400'}
        />
      </label>

      <label className="space-y-1 text-xs text-zinc-400">
        Speed {state.speed.toFixed(2)}
        <input
          type="range"
          min={0.05}
          max={0.5}
          step={0.01}
          value={state.speed}
          onChange={(event) => updateState(peer, { ...state, speed: Number(event.target.value) })}
          className={peer === 'A' ? 'w-full accent-blue-400' : 'w-full accent-fuchsia-400'}
        />
      </label>
    </div>
  );

  return (
    <DemoLayout
      title="Signal Storm"
      difficulty="advanced"
      description="Generate a procedural weather field with simplex-noise and sync the storm controls between peers over RTCDataChannel."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            This demo treats WebRTC like a remote instrument panel. Only a tiny control object crosses
            the data channel. Each browser then uses <strong>simplex-noise</strong> to synthesize the same
            moody weather field locally.
          </p>
          <p>
            It is a good fit for shared simulations, dashboards, and generative art where peers can recreate
            the scene from deterministic inputs.
          </p>
        </div>
      }
      hints={[
        'Click inside a canvas to move the storm eye.',
        'Change the seed to generate a totally new field while keeping the same UI logic.',
        'Only the control payload is synchronized; the heavy visual work stays client-side.',
      ]}
      demo={
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <button
                onClick={connect}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
              >
                Connect storm peers
              </button>
            ) : (
              <span className="rounded-xl border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-300">
                Storm controls synced
              </span>
            )}
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Peer A storm desk</p>
              {controls('A', stateA)}
              <StormCanvas
                state={stateA}
                onPoint={(stormX, stormY) => updateState('A', { ...stateA, stormX, stormY })}
              />
            </section>

            <section className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-fuchsia-300">Peer B storm desk</p>
              {controls('B', stateB)}
              <StormCanvas
                state={stateB}
                onPoint={(stormX, stormY) => updateState('B', { ...stateB, stormX, stormY })}
              />
            </section>
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'Deterministic simulation control payloads' }}
      mdnLinks={[
        { label: 'RTCDataChannel', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel' },
      ]}
    />
  );
}
