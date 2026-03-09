# Cloudflare Workers

This repo can deploy the client app and signaling layer to a single Cloudflare Worker.

## Requirements

- Cloudflare account authenticated with Wrangler:
  - `npx wrangler login`
  - or set `CLOUDFLARE_API_TOKEN`
- Bun installed for the existing workspace scripts

## Commands

- `bun run cf:build`
  - Builds the Vite client into `client/dist`
- `bun run cf:typecheck`
  - Type-checks the Worker code in `cloudflare/`
- `bun run cf:dev`
  - Builds the client and starts `wrangler dev`
- `bun run cf:deploy`
  - Builds the client and deploys to Cloudflare `workers.dev`

## Runtime Shape

- Static assets are served from `client/dist`
- SPA routes fall back to `index.html`
- WebSocket signaling is exposed at same-origin `/ws`
- Room state is handled by the `SignalingRoom` Durable Object

## Local Development

- `bun run dev` is unchanged
- Vite still proxies `/ws` and `/api` to the Bun server on port `3001`
- Cloudflare deployment is a separate path and does not replace the Bun local server

## Optional Client Override

Set `VITE_SIGNALING_URL` in the client environment only if signaling should use a non-default absolute WebSocket URL.
