import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { DifficultyBadge } from '@/components/ui/DifficultyBadge';
import { LogPanel } from '@/components/ui/LogPanel';
import { CodeBlock } from '@/components/ui/CodeBlock';
import type { Logger } from '@/lib/logger';
import type { Difficulty } from '@/types/demo';

interface Props {
  title: string;
  difficulty: Difficulty;
  description: string;
  explanation: ReactNode;
  demo: ReactNode;
  logger: Logger;
  codeSnippet?: { code: string; title?: string; language?: string };
  mdnLinks?: { label: string; href: string }[];
  hints?: string[];
  className?: string;
}

export function DemoLayout({
  title,
  difficulty,
  description,
  explanation,
  demo,
  logger,
  codeSnippet,
  mdnLinks,
  hints,
  className,
}: Props) {
  return (
    <div className={clsx('max-w-5xl mx-auto p-6 space-y-6', className)}>
      {/* Explanation Card */}
      <div className="bg-surface-1 border border-zinc-800 rounded-xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">{title}</h1>
            <p className="text-zinc-400 mt-1">{description}</p>
          </div>
          <DifficultyBadge difficulty={difficulty} />
        </div>

        <div className="prose prose-sm prose-invert max-w-none text-zinc-300">
          {explanation}
        </div>

        {(mdnLinks?.length || hints?.length) && (
          <div className="mt-4 flex flex-wrap gap-4">
            {mdnLinks && mdnLinks.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {mdnLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    {link.label}
                  </a>
                ))}
              </div>
            )}
            {hints && hints.length > 0 && (
              <div className="flex-1 min-w-64">
                {hints.map((hint, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs text-amber-400/80 mb-1">
                    <span className="shrink-0 mt-0.5">⚡</span>
                    <span>{hint}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Demo Area */}
      <div className="bg-surface-1 border border-zinc-800 rounded-xl p-6">
        {demo}
      </div>

      {/* Log Panel */}
      <LogPanel logger={logger} maxHeight="220px" />

      {/* Code Snippet */}
      {codeSnippet && (
        <CodeBlock
          code={codeSnippet.code}
          title={codeSnippet.title}
          language={codeSnippet.language ?? 'typescript'}
        />
      )}
    </div>
  );
}
