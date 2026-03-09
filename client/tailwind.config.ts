import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#09090b',  // zinc-950
          1: '#18181b',  // zinc-900
          2: '#27272a',  // zinc-800
          3: '#3f3f46',  // zinc-700
        },
        state: {
          new: '#71717a',         // zinc-500
          connecting: '#fbbf24',  // amber-400
          connected: '#34d399',   // emerald-400
          disconnected: '#fb923c',// orange-400
          failed: '#f87171',      // red-400
          closed: '#52525b',      // zinc-600
        },
        ice: {
          host: '#60a5fa',    // blue-400
          srflx: '#a78bfa',   // violet-400
          relay: '#f472b6',   // pink-400
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
