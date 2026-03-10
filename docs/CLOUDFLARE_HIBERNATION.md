# Cloudflare Durable Object WebSocket Hibernation Explained

This note explains:

- what "WebSocket hibernation" means in Cloudflare Durable Objects
- how that differs from a more traditional always-hot WebSocket server
- why this repo's signaling server is a good fit for hibernation
- what changed in the code

## The Short Version

In a normal WebSocket server, your process stays alive while the socket stays connected.

In a Cloudflare Durable Object with WebSocket hibernation, the WebSocket connection can stay connected even when the Durable Object instance is evicted from memory. When a new WebSocket event arrives, Cloudflare wakes the Durable Object back up and calls your handlers again.

That means:

- clients stay connected
- the DO does not need to remain hot in memory the whole time
- you pay less duration cost for idle or mostly-idle sockets
- your code must be able to rebuild in-memory state after wake-up

That last point is the main design constraint.

## Normal WebSocket Mental Model

The usual server model looks like this:

1. Client opens a WebSocket.
2. Server stores connection state in memory.
3. Server process stays alive for the lifetime of the connection.
4. All room membership, peer maps, timers, and transient state live in RAM.

This is simple because memory stays warm. If you have a `Map` of peers, it is just there for the entire session.

The downside is that idle connections still keep the server process alive.

## Durable Object Hibernation Mental Model

With Cloudflare DO hibernation, the model changes:

1. Client opens a WebSocket to the Durable Object.
2. Durable Object accepts the socket with `state.acceptWebSocket(...)`.
3. Cloudflare may evict the DO instance when it becomes idle.
4. The WebSocket can remain connected.
5. Later, when a socket event arrives, Cloudflare creates the DO again.
6. Your constructor runs again.
7. Your code rebuilds any needed in-memory state from the existing sockets.

So the key question becomes:

"If my in-memory maps disappear, can I reconstruct them from the sockets and/or persisted storage?"

If the answer is yes, hibernation is usually a strong fit.

## Why This Signaling Server Fits Hibernation Well

This repo's signaling server is a good candidate because the room state is small and reconstructible.

What the DO really needs to know for signaling is:

- which peers are currently connected
- each peer's stable server-side `peerId`
- each peer's optional role

That is lightweight connection metadata. It does not require a permanently hot process.

This also matches WebRTC signaling traffic well:

- signaling is bursty
- after offer/answer/ICE exchange, rooms often go quiet
- media flows peer-to-peer, not through the Worker
- paying to keep the DO hot during idle time is usually wasteful

## What Makes Hibernation Possible Here

The important mechanisms in the current code are in [`cloudflare/src/index.ts`](file:///Users/benn/Documents/Projects/Playground/webrtc-playground/cloudflare/src/index.ts).

### 1. The Durable Object accepts WebSockets directly

```ts
this.state.acceptWebSocket(server);
```

This is the hibernation-compatible DO WebSocket API. It is different from building a generic Worker-level WebSocket handler that relies on the object staying live in ordinary memory.

### 2. Metadata is stored on each socket

```ts
socket.serializeAttachment(attachment);
```

The code stores:

- `joined`
- `peerId`
- `role`

This matters because those attachments survive DO eviction. When the object wakes back up, the socket still exists and the attachment can be read again.

### 3. The peer map is rebuilt in the constructor

```ts
for (const socket of this.state.getWebSockets()) {
  const attachment = getAttachment(socket);
  if (attachment.joined) {
    this.peers.set(attachment.peerId, { socket, role: attachment.role });
  }
}
```

This is the core hibernation pattern.

The `peers` map is only an in-memory cache. It is not the source of truth. The source of truth is:

- the connected sockets returned by `getWebSockets()`
- the metadata attached to each socket

Because of that, losing the in-memory `Map` is acceptable.

## Hibernation vs "Normal DO WebSockets"

The confusing bit is that both versions still use Durable Objects and WebSockets.

The practical difference is not "DOs vs no DOs". The difference is:

- `normal always-hot model`: your logic implicitly depends on the object instance staying in memory
- `hibernation-safe model`: your logic assumes the object can disappear and later be reconstructed

So when people say "use hibernation", what they really mean is:

"Write the DO so it can tolerate eviction without losing the ability to continue serving connected sockets."

## What We Changed

The recent changes were small but important.

### 1. Added an explicit comment near constructor rehydration

We added a comment explaining that room membership must remain derivable from socket attachments alone.

Why that matters:

- future edits should not treat `this.peers` as durable state
- if someone later adds extra in-memory room state that cannot be rebuilt, they could accidentally break hibernation safety

### 2. Unified disconnect logic into one cleanup path

Before, disconnect cleanup lived in `handleDisconnect(...)`.

Now it lives in `disconnectPeer(...)`.

That helper:

- reads the socket attachment
- marks the socket as no longer joined
- removes the peer from the in-memory map
- broadcasts `peer-left` when appropriate
- optionally reciprocates the close frame

Why this helps:

- all close/error paths now clean up the same way
- attachment state and in-memory state are less likely to drift apart

### 3. `webSocketClose(...)` now reciprocates close frames when needed

Cloudflare recommends reciprocating close frames from the other side. Otherwise the peer can see an abnormal `1006` close in some cases.

The updated handler now receives:

- close code
- reason
- `wasClean`

and calls the shared disconnect helper.

Conceptually:

```ts
webSocketClose(socket, code, reason, wasClean) {
  this.disconnectPeer(socket, {
    closeCode: code,
    closeReason: reason,
    reciprocateClose: !wasClean,
  });
}
```

The important idea is that cleanup and close-handshake behavior are now handled together.

### 4. Expanded local runtime typings

[`cloudflare/src/runtime.d.ts`](file:///Users/benn/Documents/Projects/Playground/webrtc-playground/cloudflare/src/runtime.d.ts) now includes the WebSocket methods used by the DO code:

- `send(...)`
- `close(...)`
- `readyState`

This is only local typing support for the repo. It does not change runtime behavior.

## What Hibernation Does Not Mean

Hibernation does not mean:

- messages are persisted for you
- room history is stored automatically
- the DO is active all the time
- the client uses a special browser API

The browser client is still just using a normal WebSocket.

Hibernation is entirely a server-side behavior of the Durable Object runtime.

## When Hibernation Is Usually a Good Idea

It usually makes sense when:

- connections may stay open for a long time
- traffic is bursty or idle much of the time
- in-memory state can be reconstructed cheaply
- the server mostly routes messages rather than maintaining complex live computation

This signaling server matches that profile well.

## When Hibernation Is Not a Good Fit

It is less attractive when your DO depends on hot in-memory state that cannot be reconstructed cheaply.

Examples:

- large in-memory game simulation state with frequent ticks
- heavy timer-driven logic
- per-connection state that only exists in RAM and is not attached/persisted
- workloads that are so chatty that the object is effectively always awake anyway

In those cases, hibernation may provide little benefit or force awkward design constraints.

## The Design Rule To Remember

For hibernation-safe DO WebSocket code, treat in-memory state as a cache, not as the source of truth.

If the DO disappears and comes back, the system should still work by rebuilding state from:

- attached socket metadata
- Durable Object storage, if needed
- any deterministic identifiers such as room ID

That is the main architectural difference.

## For This Repo Specifically

The current signaling DO is using the right pattern for hibernation:

- accept sockets with `acceptWebSocket(...)`
- store peer metadata via attachments
- rebuild `peers` from `getWebSockets()` in the constructor

The recent hardening just made the close/cleanup behavior more correct and more aligned with Cloudflare guidance.

## If You Want a Simple Rule of Thumb

Use hibernation for DO WebSocket servers by default when:

- the socket may live longer than the periods of active work
- your room/session state is small
- you can reconstruct live state after wake-up

Do not rely on hibernation as a magic optimization if your design still assumes the object must remain permanently warm.
