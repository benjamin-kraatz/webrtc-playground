import { NavLink, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { SECTIONS, DEMOS } from '@/config/demos';
import type { SectionMeta } from '@/types/demo';

function SectionGroup({ section }: { section: SectionMeta }) {
  const demos = DEMOS.filter((d) => d.section === section.id);
  const location = useLocation();
  const hasActive = demos.some((d) => location.pathname === d.path);

  return (
    <div>
      <div className="demo-section-header flex items-center gap-1.5">
        <span>{section.icon}</span>
        <span>{section.title}</span>
      </div>
      <div className="space-y-0.5 px-2">
        {demos.map((demo) => (
          <NavLink
            key={demo.id}
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
        ))}
      </div>
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: Props) {
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
              <p className="text-xs text-zinc-500">27 interactive demos</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-3 space-y-1">
          {SECTIONS.map((section) => (
            <SectionGroup key={section.id} section={section} />
          ))}
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
