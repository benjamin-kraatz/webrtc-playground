import { Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Shell } from '@/components/layout/Shell';
import { DEMOS } from '@/config/demos';

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-zinc-600 border-t-blue-400 rounded-full animate-spin" />
        <p className="text-sm text-zinc-500">Loading demo...</p>
      </div>
    </div>
  );
}

function HomePage() {
  return (
    <div className="max-w-3xl mx-auto p-8 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-2xl mx-auto mb-6">
        📡
      </div>
      <h1 className="text-3xl font-bold text-zinc-100 mb-3">WebRTC Playground</h1>
      <p className="text-lg text-zinc-400 mb-8">
        90 interactive demos exploring every corner of the WebRTC API — from your first
        RTCPeerConnection to quantum-entangled Bloch spheres.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
        {[
          { n: '90', label: 'Demos' },
          { n: '9', label: 'Sections' },
          { n: '0', label: 'Dependencies*' },
          { n: '∞', label: 'Things to learn' },
        ].map(({ n, label }) => (
          <div key={label} className="bg-surface-1 border border-zinc-800 rounded-xl p-4">
            <p className="text-2xl font-bold text-zinc-100">{n}</p>
            <p className="text-sm text-zinc-500">{label}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-zinc-600 mt-4">*no runtime WebRTC library — all native browser APIs</p>
      <p className="text-sm text-zinc-500 mt-6">← Pick a demo from the sidebar to get started</p>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<HomePage />} />
          {DEMOS.map((demo) => (
            <Route
              key={demo.id}
              path={demo.path}
              element={
                <Suspense fallback={<LoadingSpinner />}>
                  <demo.component />
                </Suspense>
              }
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
