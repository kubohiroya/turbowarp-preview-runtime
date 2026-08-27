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

The package owns protocol mechanics only. Consumers remain responsible for file watching, source compilation, diagnostics rendering, app-specific reload policy, source integrity projection, candidate identity, restart choices, and any TurboWarp runtime mutations.

Protocol errors use `PreviewProtocolError` with package-level `TWRP-PROTOCOL-*` codes. Consumers that expose app diagnostics should map these errors to their own diagnostic namespace.

## Core Primitives

- `createPreviewProtocolController(options)` owns app-neutral handshake, disconnect, capability negotiation, session ownership, revision ordering, and queueing.
- `readPreviewProtocolMessage(input, expectedType, allowedKeys)` validates generic message shape and rejects unknown keys.
- `validatePreviewSessionId(value)` and `validatePreviewRevision(value, latestRevision)` provide focused validation helpers.
- `negotiatePreviewProtocolVersion(requested, supported)` and `negotiatePreviewCapabilities(options)` expose the handshake validation pieces directly.
- `createPreviewOperationQueue()` serializes arbitrary async protocol operations.

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

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run release:check
```
