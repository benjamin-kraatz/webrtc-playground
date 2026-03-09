import { useState } from 'react';
import { clsx } from 'clsx';

interface Props {
  code: string;
  language?: string;
  title?: string;
  className?: string;
}

export function CodeBlock({ code, language = 'typescript', title, className }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={clsx('rounded-lg overflow-hidden border border-zinc-800', className)}>
      <div className="flex items-center justify-between px-4 py-2 bg-surface-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">{language}</span>
          {title && <span className="text-xs font-medium text-zinc-300">{title}</span>}
        </div>
        <button
          onClick={copy}
          className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors flex items-center gap-1"
        >
          {copied ? (
            <>
              <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="bg-surface-1 p-4 overflow-x-auto text-sm font-mono text-zinc-300 leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}
