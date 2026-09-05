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

この package が持つのは protocol mechanics だけです。file watch、source compile、diagnostics rendering、app 固有 reload policy、source integrity projection、candidate id の生成、restart choices、TurboWarp runtime mutation は consumer 側に残します。controller は connection が今どの candidate を持っているかを追跡しますが、candidate が何を意味するかは app 側のものです。

Protocol error は `PreviewProtocolError` を使います。code は既定で `TWRP-PROTOCOL-*` ですが、`errorCodePrefix` を渡すと app 自身の diagnostic namespace で報告できます。例えば `errorCodePrefix: 'K4'` は `K4-PROTOCOL-CANDIDATE` を生成します。

## Core Primitives

- `createPreviewProtocolController(options)` は app 非依存の handshake、disconnect、capability negotiation、session ownership、revision ordering、candidate tracking、queueing を持ちます。
- `readPreviewProtocolMessage(input, expectedType, allowedKeys)` は generic message shape を検証し、unknown key を拒否します。
- `validatePreviewSessionId(value)` / `validatePreviewRevision(value, latestRevision)` は focused validation helper です。
- `negotiatePreviewProtocolVersion(requested, supported)` / `negotiatePreviewCapabilities(options)` は handshake validation の部品です。
- `createPreviewOperationQueue()` は任意の async protocol operation を直列化し、queue の外で settle する work も追跡します。
- `previewProtocolErrorCode(suffix, prefix)` は app 自身の diagnostic namespace で code を組み立てるので、controller と同じ失敗を app 側からも投げられます。

### 二相 operation

遅い処理で queue を塞ぎたくない operation は二相に分けます。最初の queued step で開始し、完了を `track`
して `whenIdle` が待てるようにし、再度 queue に入るときに捕まえておいた `connectionId` を渡します。
await の間に connection が差し替わっていれば拒否されます。

```ts
const begun = preview.enqueue(() => {
  const message = preview.readMessage(incoming, 'tm3d.preview.render.patch', ['sessionId', 'revision', 'patch']);
  const active = preview.acceptRevision(message.sessionId, message.revision);
  return {active, applying: applyRenderPatch(active.sessionId, message.patch)};
});

const completion = begun.then(async ({active, applying}) => {
  const applied = await applying;
  return preview.enqueue(() => {
    // 別の handshake がこの connection を置き換えていれば TWRP-PROTOCOL-SESSION を投げます。
    const current = preview.requireConnection(active.sessionId, active.connectionId);
    if (current.latestRevision !== active.revision) return null;
    return preview.acceptCandidate(active.sessionId, {id: applied.candidateId, revision: active.revision});
  });
});

preview.track(completion);
```

### Capability と candidate

- `preview.requireCapability(sessionId, capability)` は client が negotiate していない operation を拒否します。
- `preview.acceptCandidate(sessionId, {id, revision})` は stage した candidate を connection に束縛します。
- `preview.requireCandidate(sessionId, revision, candidateId)` は stale または欠落した candidate を拒否します。
- 新しい revision を受け付けると前の candidate は破棄され、`preview.clearCandidate(sessionId)` で明示的にも落とせます。

既に切断済みの session への disconnect は no-op です。後片付けや再接続の race が、connection がまだ
開いているかどうかを知らなくて済みます。ただし *別の* session を指す disconnect は従来どおり拒否します。

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

`deferCapability` を設定すると、その capability を negotiate していない client の `defer` を拒否します。`session.getState()` は connection / revision / candidate の状態を返し、`session.whenIdle()` は queue と track 済みの work が静まった時点でその状態を返します。

adapter が持つ以上のものを wire message が運ぶ app — 独自の ack payload、candidate id、restart choice、source integrity など — は、この adapter を拡張せず `createPreviewProtocolController` の上に直接組んでください。payload の意味は app 側に、protocol mechanics はこちらに残ります。

## 開発

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run release:check
```
