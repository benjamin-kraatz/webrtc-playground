import { clsx } from 'clsx';

interface Props {
  value: number; // 0-100
  label?: string;
  className?: string;
  color?: 'emerald' | 'blue' | 'amber' | 'red';
}

const COLOR_MAP = {
  emerald: 'bg-emerald-500',
  blue: 'bg-blue-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
};

export function ProgressBar({ value, label, className, color = 'emerald' }: Props) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={clsx('space-y-1', className)}>
      {label && (
        <div className="flex justify-between text-xs text-zinc-400">
          <span>{label}</span>
          <span>{pct.toFixed(1)}%</span>
        </div>
      )}
      <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
        <div
          className={clsx('h-full rounded-full transition-all duration-300', COLOR_MAP[color])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
