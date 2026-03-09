import { clsx } from 'clsx';

const STATES: RTCPeerConnectionState[] = ['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'];

const STATE_COLORS: Record<RTCPeerConnectionState, string> = {
  new: 'fill-zinc-700 stroke-zinc-500',
  connecting: 'fill-amber-900 stroke-amber-400',
  connected: 'fill-emerald-900 stroke-emerald-400',
  disconnected: 'fill-orange-900 stroke-orange-400',
  failed: 'fill-red-900 stroke-red-400',
  closed: 'fill-zinc-900 stroke-zinc-600',
};

const TEXT_COLORS: Record<RTCPeerConnectionState, string> = {
  new: 'text-zinc-400',
  connecting: 'text-amber-400',
  connected: 'text-emerald-400',
  disconnected: 'text-orange-400',
  failed: 'text-red-400',
  closed: 'text-zinc-600',
};

interface Props {
  current: RTCPeerConnectionState;
}

export function PcStateDiagram({ current }: Props) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {STATES.map((state, i) => {
        const active = state === current;
        return (
          <div key={state} className="flex items-center gap-1">
            <div
              className={clsx(
                'px-2.5 py-1 rounded text-xs font-mono font-medium border transition-all duration-300',
                active ? [
                  TEXT_COLORS[state],
                  'border-current scale-105 shadow-lg',
                ] : 'text-zinc-600 border-zinc-800'
              )}
            >
              {state}
            </div>
            {i < STATES.length - 1 && (
              <svg className="w-3 h-3 text-zinc-700 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}
