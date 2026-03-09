# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

WebRTC Playground — a Bun-based monorepo with two workspaces:

| Service | Port | Description |
|---|---|---|
| `client` | 3000 | Vite + React 18 SPA with 27 WebRTC demos |
| `server` | 3001 | Bun WebSocket signaling server |

### Running the app

- `bun run dev` (from repo root) starts both services via `concurrently`.
- The Vite dev server proxies `/ws` and `/api` to the server on port 3001.

### Key commands

| Task | Command |
|---|---|
| Install deps | `bun install` |
| Dev (both) | `bun run dev` |
| Build client | `bun run build` |
| Type check client | `cd client && bun run tsc --noEmit` |
| Type check server | `cd server && bun run tsc --noEmit` |

### Caveats

- Bun must be installed (`curl -fsSL https://bun.sh/install | bash`). It is used as both the package manager (lockfile: `bun.lock`) and the server runtime.
- There is no ESLint or Prettier configured; the only lint-like check is TypeScript (`tsc --noEmit`).
- No automated test framework is configured (no Jest/Vitest/Playwright).
- Some demos (Video Call, Screen Annotation, Mesh Network, Broadcaster/Viewer, Group Chat, Collaborative Whiteboard, WebAudio Synth) require the signaling server — make sure `bun run dev` starts both services.
- The P2P Chat and Manual Signaling demos use manual SDP copy-paste between two browser tabs; they do not need the signaling server.
