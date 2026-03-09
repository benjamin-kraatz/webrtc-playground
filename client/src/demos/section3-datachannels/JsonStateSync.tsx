import { useMemo, useRef, useState } from 'react';
import { DemoLayout } from '@/components/layout/DemoLayout';
import { Logger } from '@/lib/logger';
import { DEFAULT_PC_CONFIG } from '@/config/iceServers';

const CODE = `// Sync state updates via data channel
interface StateUpdate {
  key: string;
  value: unknown;
  ts: number;
}

function syncState(dc: RTCDataChannel, key: string, value: unknown) {
  dc.send(JSON.stringify({ key, value, ts: Date.now() }));
}

dc.onmessage = (ev) => {
  const update: StateUpdate = JSON.parse(ev.data);
  setState(prev => ({ ...prev, [update.key]: update.value }));
};`;

interface SharedState {
  counter: number;
  color: string;
  message: string;
  slider: number;
}

const DEFAULT_STATE: SharedState = {
  counter: 0,
  color: '#3b82f6',
  message: 'Hello!',
  slider: 50,
};

export default function JsonStateSync() {
  const logger = useMemo(() => new Logger(), []);
  const [stateA, setStateA] = useState<SharedState>({ ...DEFAULT_STATE });
  const [stateB, setStateB] = useState<SharedState>({ ...DEFAULT_STATE });
  const [connected, setConnected] = useState(false);
  const dcARef = useRef<RTCDataChannel | null>(null);
  const dcBRef = useRef<RTCDataChannel | null>(null);
  const pcA = useRef<RTCPeerConnection | null>(null);
  const pcB = useRef<RTCPeerConnection | null>(null);

  const handleConnect = async () => {
    pcA.current?.close();
    pcB.current?.close();

    const a = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    const b = new RTCPeerConnection(DEFAULT_PC_CONFIG);
    pcA.current = a;
    pcB.current = b;

    a.onicecandidate = (ev) => ev.candidate && b.addIceCandidate(ev.candidate);
    b.onicecandidate = (ev) => ev.candidate && a.addIceCandidate(ev.candidate);

    const dcA = a.createDataChannel('state', { ordered: true });
    dcARef.current = dcA;

    b.ondatachannel = (ev) => {
      const dcB = ev.channel;
      dcBRef.current = dcB;
      dcB.onopen = () => { setConnected(true); logger.success('State sync channels connected!'); };
      dcB.onmessage = (e) => {
        const update = JSON.parse(e.data as string);
        setStateB((prev) => ({ ...prev, [update.key]: update.value }));
        logger.debug(`B received: ${update.key} = ${JSON.stringify(update.value)}`);
      };
    };

    dcA.onopen = () => {
      // Send initial state to B
      Object.entries(stateA).forEach(([k, v]) => {
        dcA.send(JSON.stringify({ key: k, value: v, ts: Date.now() }));
      });
    };
    dcA.onmessage = (e) => {
      const update = JSON.parse(e.data as string);
      setStateA((prev) => ({ ...prev, [update.key]: update.value }));
      logger.debug(`A received: ${update.key} = ${JSON.stringify(update.value)}`);
    };

    const offer = await a.createOffer();
    await a.setLocalDescription(offer);
    await b.setRemoteDescription(offer);
    const answer = await b.createAnswer();
    await b.setLocalDescription(answer);
    await a.setRemoteDescription(answer);
    logger.info('Loopback connected');
  };

  const updateA = <K extends keyof SharedState>(key: K, value: SharedState[K]) => {
    setStateA((prev) => ({ ...prev, [key]: value }));
    dcARef.current?.send(JSON.stringify({ key, value, ts: Date.now() }));
  };

  const updateB = <K extends keyof SharedState>(key: K, value: SharedState[K]) => {
    setStateB((prev) => ({ ...prev, [key]: value }));
    dcBRef.current?.send(JSON.stringify({ key, value, ts: Date.now() }));
  };

  const disconnect = () => {
    pcA.current?.close();
    pcB.current?.close();
    setConnected(false);
    setStateA({ ...DEFAULT_STATE });
    setStateB({ ...DEFAULT_STATE });
    logger.info('Disconnected');
  };

  return (
    <DemoLayout
      title="JSON State Sync"
      difficulty="intermediate"
      description="Keep a JSON object synchronized between two peers in real time."
      explanation={
        <div className="space-y-3 text-sm">
          <p>
            Data channels are great for syncing application state between peers. This demo keeps a
            shared state object synchronized — any change on either side propagates instantly to the other.
          </p>
          <p>
            In production you'd add <strong>conflict resolution</strong> (e.g., last-write-wins via
            timestamps, or CRDTs for true concurrent editing). This demo uses simple last-write-wins.
          </p>
        </div>
      }
      demo={
        <div className="space-y-5">
          <div className="flex gap-2">
            {!connected ? (
              <button onClick={handleConnect} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg">
                Connect (loopback)
              </button>
            ) : (
              <button onClick={disconnect} className="px-4 py-2 bg-surface-2 hover:bg-surface-3 text-zinc-300 text-sm font-medium rounded-lg">
                Disconnect
              </button>
            )}
            {connected && <span className="text-xs text-emerald-400 self-center">✓ Connected — changes sync instantly</span>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {/* Peer A */}
            <div className="space-y-4">
              <p className="text-xs font-semibold text-zinc-500 border-b border-zinc-800 pb-2">PEER A</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-400">Counter: {stateA.counter}</label>
                  <div className="flex gap-2 mt-1">
                    <button onClick={() => updateA('counter', stateA.counter + 1)} disabled={!connected}
                      className="px-3 py-1 bg-surface-2 hover:bg-surface-3 disabled:opacity-50 text-zinc-300 text-sm rounded-lg">+1</button>
                    <button onClick={() => updateA('counter', stateA.counter - 1)} disabled={!connected}
                      className="px-3 py-1 bg-surface-2 hover:bg-surface-3 disabled:opacity-50 text-zinc-300 text-sm rounded-lg">-1</button>
                    <button onClick={() => updateA('counter', 0)} disabled={!connected}
                      className="px-3 py-1 bg-surface-2 hover:bg-surface-3 disabled:opacity-50 text-zinc-300 text-sm rounded-lg">Reset</button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-zinc-400">Color</label>
                  <input type="color" value={stateA.color} onChange={(e) => updateA('color', e.target.value)} disabled={!connected}
                    className="ml-2 w-8 h-6 rounded border-0 bg-transparent cursor-pointer" />
                </div>
                <div>
                  <label className="text-xs text-zinc-400">Message</label>
                  <input type="text" value={stateA.message} onChange={(e) => updateA('message', e.target.value)} disabled={!connected}
                    className="w-full mt-1 bg-surface-0 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-zinc-300 focus:outline-none focus:border-blue-500 disabled:opacity-50" />
                </div>
                <div>
                  <label className="text-xs text-zinc-400">Slider: {stateA.slider}</label>
                  <input type="range" min={0} max={100} value={stateA.slider} onChange={(e) => updateA('slider', Number(e.target.value))} disabled={!connected}
                    className="w-full mt-1 accent-blue-400 disabled:opacity-50" />
                </div>
              </div>
            </div>

            {/* Peer B */}
            <div className="space-y-4">
              <p className="text-xs font-semibold text-zinc-500 border-b border-zinc-800 pb-2">PEER B</p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-400">Counter: {stateB.counter}</label>
                  <div className="flex gap-2 mt-1">
                    <button onClick={() => updateB('counter', stateB.counter + 1)} disabled={!connected}
                      className="px-3 py-1 bg-surface-2 hover:bg-surface-3 disabled:opacity-50 text-zinc-300 text-sm rounded-lg">+1</button>
                    <button onClick={() => updateB('counter', stateB.counter - 1)} disabled={!connected}
                      className="px-3 py-1 bg-surface-2 hover:bg-surface-3 disabled:opacity-50 text-zinc-300 text-sm rounded-lg">-1</button>
                    <button onClick={() => updateB('counter', 0)} disabled={!connected}
                      className="px-3 py-1 bg-surface-2 hover:bg-surface-3 disabled:opacity-50 text-zinc-300 text-sm rounded-lg">Reset</button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-zinc-400">Color</label>
                  <input type="color" value={stateB.color} onChange={(e) => updateB('color', e.target.value)} disabled={!connected}
                    className="ml-2 w-8 h-6 rounded border-0 bg-transparent cursor-pointer" />
                </div>
                <div>
                  <label className="text-xs text-zinc-400">Message</label>
                  <input type="text" value={stateB.message} onChange={(e) => updateB('message', e.target.value)} disabled={!connected}
                    className="w-full mt-1 bg-surface-0 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-zinc-300 focus:outline-none focus:border-blue-500 disabled:opacity-50" />
                </div>
                <div>
                  <label className="text-xs text-zinc-400">Slider: {stateB.slider}</label>
                  <input type="range" min={0} max={100} value={stateB.slider} onChange={(e) => updateB('slider', Number(e.target.value))} disabled={!connected}
                    className="w-full mt-1 accent-violet-400 disabled:opacity-50" />
                </div>
              </div>
            </div>
          </div>

          {/* Visual sync indicator */}
          <div className="flex items-center gap-4 p-4 bg-surface-0 rounded-lg">
            <div className="w-8 h-8 rounded-full" style={{ background: stateA.color }} />
            <div className="flex-1 text-center">
              <p className="text-sm text-zinc-400">{stateA.message}</p>
              <p className="text-2xl font-bold text-zinc-100">{stateA.counter}</p>
            </div>
            <div className="text-xs text-zinc-600">synced</div>
            <div className="flex-1 text-center">
              <p className="text-sm text-zinc-400">{stateB.message}</p>
              <p className="text-2xl font-bold text-zinc-100">{stateB.counter}</p>
            </div>
            <div className="w-8 h-8 rounded-full" style={{ background: stateB.color }} />
          </div>
        </div>
      }
      logger={logger}
      codeSnippet={{ code: CODE, title: 'State sync over RTCDataChannel' }}
      mdnLinks={[
        { label: 'RTCDataChannel.send()', href: 'https://developer.mozilla.org/en-US/docs/Web/API/RTCDataChannel/send' },
      ]}
    />
  );
}
