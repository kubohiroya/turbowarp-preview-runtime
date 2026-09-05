# turbowarp-preview-runtime

[日本語](README.ja.md)

`@kubohiroya/turbowarp-preview-runtime` provides app-neutral preview protocol and live reload primitives for TurboWarp applications.

It does not parse app DSLs, own diagnostics, read files, or render app-specific UI. App packages inject source frontend results, copy, diagnostics, and runtime actions.

## Scope

- Protocol version negotiation.
- Capability validation and negotiation.
- Session id and message type validation.
- Monotonic revision ordering.
- Single-connection ownership and stale session rejection.
- Disconnect callbacks for app-owned cleanup.
- Serialized operation queues.
- A small source lifecycle adapter for stage / defer / commit / disconnect.
- Simple reload anchor resolution.

## Boundary

The package owns protocol mechanics only. Consumers remain responsible for file watching, source compilation, diagnostics rendering, app-specific reload policy, source integrity projection, candidate id generation, restart choices, and any TurboWarp runtime mutations. The controller tracks the candidate a connection currently holds, but what a candidate *is* stays with the app.

Protocol errors use `PreviewProtocolError`. Codes default to `TWRP-PROTOCOL-*`; pass `errorCodePrefix` to report an app's own diagnostic namespace, for example `errorCodePrefix: 'K4'` to produce `K4-PROTOCOL-CANDIDATE`.

## Core Primitives

- `createPreviewProtocolController(options)` owns app-neutral handshake, disconnect, capability negotiation, session ownership, revision ordering, candidate tracking, and queueing.
- `readPreviewProtocolMessage(input, expectedType, allowedKeys)` validates generic message shape and rejects unknown keys.
- `validatePreviewSessionId(value)` and `validatePreviewRevision(value, latestRevision)` provide focused validation helpers.
- `negotiatePreviewProtocolVersion(requested, supported)` and `negotiatePreviewCapabilities(options)` expose the handshake validation pieces directly.
- `createPreviewOperationQueue()` serializes arbitrary async protocol operations and tracks work that settles outside the queue.
- `previewProtocolErrorCode(suffix, prefix)` builds a code in an app's own diagnostic namespace, so an app can raise the same failures the controller raises.

### Two-phase operations

An operation whose slow part must not hold the queue runs in two phases. Start it in one queued step,
`track` the completion so `whenIdle` still waits for it, then re-enter the queue and pass the
`connectionId` you captured so a connection replaced during the await is rejected:

```ts
const begun = preview.enqueue(() => {
  const message = preview.readMessage(incoming, 'tm3d.preview.render.patch', ['sessionId', 'revision', 'patch']);
  const active = preview.acceptRevision(message.sessionId, message.revision);
  return {active, applying: applyRenderPatch(active.sessionId, message.patch)};
});

const completion = begun.then(async ({active, applying}) => {
  const applied = await applying;
  return preview.enqueue(() => {
    // Throws TWRP-PROTOCOL-SESSION when another handshake replaced this connection.
    const current = preview.requireConnection(active.sessionId, active.connectionId);
    if (current.latestRevision !== active.revision) return null;
    return preview.acceptCandidate(active.sessionId, {id: applied.candidateId, revision: active.revision});
  });
});

preview.track(completion);
```

### Capabilities and candidates

- `preview.requireCapability(sessionId, capability)` rejects an operation the client never negotiated.
- `preview.acceptCandidate(sessionId, {id, revision})` binds a staged candidate to the connection.
- `preview.requireCandidate(sessionId, revision, candidateId)` rejects a stale or missing candidate.
- Accepting a newer revision discards the previous candidate, and `preview.clearCandidate(sessionId)` drops it explicitly.

Disconnecting a session that is already disconnected is a no-op, so cleanup and reconnect races do
not have to know whether a connection is still open. A disconnect naming a *different* session is
still rejected.

## Example

```ts
import {createPreviewProtocolController} from '@kubohiroya/turbowarp-preview-runtime';

const preview = createPreviewProtocolController({
  requiredCapabilities: ['transport.v1'],
  optionalCapabilities: ['render.patch.v1'],
  messageTypes: {
    handshake: 'tm3d.preview.hello',
    handshakeAck: 'tm3d.preview.hello.ok',
    disconnect: 'tm3d.preview.disconnect',
    disconnectAck: 'tm3d.preview.disconnect.ok'
  },
  getState: () => ({sceneReady: true}),
  onDisconnect: async () => {
    await disposePreviewCandidate();
  }
});

await preview.handshake({
  type: 'tm3d.preview.hello',
  protocolVersion: {major: 1, minor: 0},
  sessionId: 'dev',
  capabilities: ['transport.v1', 'render.patch.v1']
});

await preview.enqueue(async () => {
  const message = preview.readMessage(incoming, 'tm3d.preview.render.patch', [
    'sessionId',
    'revision',
    'patch'
  ]);
  const active = preview.acceptRevision(message.sessionId, message.revision);
  await applyRenderPatch(active.sessionId, message.patch);
});
```

## Source Lifecycle Adapter

`createPreviewProtocolSession(options)` is retained as a compatibility adapter for consumers that already model preview work as source `stage`, `defer`, `commit`, and `disconnect` operations. It is implemented on top of `createPreviewProtocolController`.

The adapter passes generic commit `options` through to the injected `liveReloadSession.commit(options)`. It also accepts the legacy `restart` key as a pass-through `{restart}` option for existing consumers. App-specific restart policy and source integrity decisions should be projected by the consuming app, not by this package.

Set `deferCapability` to reject `defer` unless the client negotiated that capability. `session.getState()` reports connection, revision, and candidate state, and `session.whenIdle()` resolves with that state once the queue and any tracked work are quiescent.

An app whose wire messages carry more than the adapter models — its own ack payloads, candidate ids, restart choices, or source integrity — should build directly on `createPreviewProtocolController` instead of extending this adapter. That keeps the app's payload semantics in the app and the protocol mechanics here.

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run release:check
```
