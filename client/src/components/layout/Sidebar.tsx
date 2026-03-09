import { useState, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { clsx } from 'clsx';
import { SECTIONS, DEMOS } from '@/config/demos';
import type { DemoMeta, SectionMeta } from '@/types/demo';

function SectionGroup({ section }: { section: SectionMeta }) {
  const demos = DEMOS.filter((d) => d.section === section.id);

  return (
    <div>
      <div className="demo-section-header flex items-center gap-1.5">
        <span>{section.icon}</span>
        <span>{section.title}</span>
      </div>
      <div className="space-y-0.5 px-2">
        {demos.map((demo) => (
          <DemoLink key={demo.id} demo={demo} />
        ))}
      </div>
    </div>
  );
}

function DemoLink({ demo }: { demo: DemoMeta }) {
  return (
    <NavLink
      to={demo.path}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-2 text-sm px-2 py-1.5 rounded-lg transition-colors',
          isActive
            ? 'bg-surface-2 text-zinc-100'
            : 'text-zinc-400 hover:text-zinc-200 hover:bg-surface-2/50'
        )
      }
    >
      <span className="truncate">{demo.title}</span>
      <div className="ml-auto flex gap-1 shrink-0">
        {demo.needsServer && (
          <span title="Requires signaling server" className="text-[10px] bg-violet-900/50 text-violet-400 px-1 rounded">WS</span>
        )}
        {demo.needsMultipleTabs && (
          <span title="Open two tabs" className="text-[10px] bg-blue-900/50 text-blue-400 px-1 rounded">2T</span>
        )}
      </div>
    </NavLink>
  );
}

function SearchResults({ query, demos }: { query: string; demos: DemoMeta[] }) {
  const sectionMap = useMemo(
    () => Object.fromEntries(SECTIONS.map((s) => [s.id, s])),
    []
  );

  if (demos.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-zinc-500">
        No demos match <span className="text-zinc-400">"{query}"</span>
      </div>
    );
  }

  return (
    <div className="space-y-0.5 px-2">
      {demos.map((demo) => (
        <div key={demo.id}>
          <DemoLink demo={demo} />
          <p className="px-2 pb-1 text-[10px] text-zinc-600 truncate">
            {sectionMap[demo.section]?.icon} {sectionMap[demo.section]?.title} · {demo.difficulty}
          </p>
        </div>
      ))}
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: Props) {
  const [query, setQuery] = useState('');

  const filteredDemos = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return DEMOS.filter((d) =>
      d.title.toLowerCase().includes(q) ||
      d.description.toLowerCase().includes(q) ||
      d.difficulty.toLowerCase().includes(q) ||
      d.section.toLowerCase().includes(q) ||
      d.tags.some((t) => t.toLowerCase().includes(q)) ||
      SECTIONS.find((s) => s.id === d.section)?.title.toLowerCase().includes(q)
    );
  }, [query]);

  return (
    <>
      {/* Backdrop on mobile */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={clsx(
          'fixed lg:sticky top-0 z-30 h-screen w-64 bg-surface-1 border-r border-zinc-800',
          'flex flex-col overflow-hidden transition-transform duration-200',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="shrink-0 px-4 py-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-xs font-bold">
              W
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-100">WebRTC Playground</p>
              <p className="text-xs text-zinc-500">{DEMOS.length} interactive demos</p>
            </div>
          </div>
          {/* Search */}
          <div className="relative mt-3">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="text"
              placeholder="Search demos…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-surface-2 text-sm text-zinc-200 placeholder-zinc-500 rounded-lg pl-8 pr-7 py-1.5 outline-none focus:ring-1 focus:ring-zinc-600"
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-1">
          {filteredDemos ? (
            <SearchResults query={query} demos={filteredDemos} />
          ) : (
            SECTIONS.map((section) => (
              <SectionGroup key={section.id} section={section} />
            ))
          )}
        </nav>

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-zinc-800">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] bg-surface-2 text-zinc-500 px-1.5 py-0.5 rounded">WS</span>
            <span className="text-xs text-zinc-600">= needs signaling server</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-[10px] bg-surface-2 text-zinc-500 px-1.5 py-0.5 rounded">2T</span>
            <span className="text-xs text-zinc-600">= open two tabs</span>
          </div>
        </div>
      </aside>
    </>
  );
}
