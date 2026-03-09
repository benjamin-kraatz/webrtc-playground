import { clsx } from 'clsx';
import type { Difficulty } from '@/types/demo';

const MAP: Record<Difficulty, { label: string; cls: string }> = {
  beginner: { label: 'Beginner', cls: 'bg-emerald-900/50 text-emerald-400 border-emerald-700' },
  intermediate: { label: 'Intermediate', cls: 'bg-amber-900/50 text-amber-400 border-amber-700' },
  advanced: { label: 'Advanced', cls: 'bg-red-900/50 text-red-400 border-red-700' },
};

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  const { label, cls } = MAP[difficulty];
  return (
    <span className={clsx('text-xs font-medium px-2 py-0.5 rounded border', cls)}>
      {label}
    </span>
  );
}
