import { clsx } from 'clsx';

const STATE_COLORS: Record<string, string> = {
  new: 'bg-state-new text-zinc-900',
  connecting: 'bg-state-connecting text-zinc-900',
  connected: 'bg-state-connected text-zinc-900',
  disconnected: 'bg-state-disconnected text-zinc-900',
  failed: 'bg-state-failed text-zinc-900',
  closed: 'bg-state-closed text-zinc-100',
};

const DOT_COLORS: Record<string, string> = {
  new: 'bg-state-new',
  connecting: 'bg-state-connecting animate-pulse',
  connected: 'bg-state-connected animate-pulse',
  disconnected: 'bg-state-disconnected',
  failed: 'bg-state-failed',
  closed: 'bg-state-closed',
};

interface Props {
  state: RTCPeerConnectionState | string;
  label?: string;
  className?: string;
}

export function ConnectionStatus({ state, label, className }: Props) {
  const bg = STATE_COLORS[state] ?? STATE_COLORS.new;
  const dot = DOT_COLORS[state] ?? DOT_COLORS.new;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full',
        bg,
        className
      )}
    >
      <span className={clsx('w-1.5 h-1.5 rounded-full', dot)} />
      {label ?? state}
    </span>
  );
}
