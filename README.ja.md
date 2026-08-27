# turbowarp-preview-runtime

[English](README.md)

`@kubohiroya/turbowarp-preview-runtime` は、TurboWarp app 向けの app 非依存 preview protocol / live reload primitive を提供します。

この package は app DSL の parse、diagnostics、file read、app 固有 UI を持ちません。source frontend result、copy、diagnostics、runtime action は app package から注入します。

## 役割

- protocol version negotiation。
- capability validation / negotiation。
- session id / message type validation。
- monotonic revision ordering。
- single-connection ownership と stale session rejection。
- app 所有 cleanup のための disconnect callback。
- serialized operation queue。
- source stage / defer / commit / disconnect 用の薄い互換 adapter。
- 単純な reload anchor resolution。

## 境界

この package が持つのは protocol mechanics だけです。file watch、source compile、diagnostics rendering、app 固有 reload policy、source integrity projection、candidate identity、restart choices、TurboWarp runtime mutation は consumer 側に残します。

Protocol error は `PreviewProtocolError` と package-level の `TWRP-PROTOCOL-*` code を使います。app diagnostics として見せる場合は、consumer 側の diagnostic namespace へ map してください。

## Core Primitives

- `createPreviewProtocolController(options)` は app 非依存の handshake、disconnect、capability negotiation、session ownership、revision ordering、queueing を持ちます。
- `readPreviewProtocolMessage(input, expectedType, allowedKeys)` は generic message shape を検証し、unknown key を拒否します。
- `validatePreviewSessionId(value)` / `validatePreviewRevision(value, latestRevision)` は focused validation helper です。
- `negotiatePreviewProtocolVersion(requested, supported)` / `negotiatePreviewCapabilities(options)` は handshake validation の部品です。
- `createPreviewOperationQueue()` は任意の async protocol operation を直列化します。

## 使用例

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

`createPreviewProtocolSession(options)` は、preview work を source `stage` / `defer` / `commit` / `disconnect` として扱う既存 consumer のための互換 adapter として残しています。この adapter は `createPreviewProtocolController` の上に実装されています。

Adapter は generic な commit `options` を injected `liveReloadSession.commit(options)` へ渡します。また既存 consumer との互換のため、legacy な `restart` key も `{restart}` option として pass-through します。app 固有の restart policy や source integrity decision は、この package ではなく consumer 側で project してください。

## 開発

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run release:check
```
