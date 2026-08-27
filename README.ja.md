# turbowarp-preview-runtime

[English](README.md)

`@kubohiroya/turbowarp-preview-runtime` は、TurboWarp app 向けの app 非依存 preview protocol / live reload primitive を提供します。

この package は app DSL の parse、diagnostics、file read、app 固有 UI を持ちません。source frontend result、copy、diagnostics、runtime action は app package から注入します。

## 役割

- preview protocol の capability negotiation。
- session / revision validation。
- source stage / defer / commit / disconnect message handling。
- 単純な reload anchor resolution。
- app 非依存の error class と validation helper。

## 境界

この package が持つのは protocol mechanics だけです。file watch、source compile、diagnostics rendering、app 固有 reload policy、TurboWarp runtime mutation は consumer 側に残します。

## 使用例

```ts
import {createPreviewProtocolSession} from '@kubohiroya/turbowarp-preview-runtime';

const session = createPreviewProtocolSession({
  liveReloadSession,
  requiredCapabilities: ['source.stage.v1', 'source.commit.v1'],
  optionalCapabilities: ['source.defer.v1']
});

await session.handshake({
  type: 'preview.handshake',
  protocolVersion: {major: 1, minor: 0},
  sessionId: 'dev',
  capabilities: ['source.stage.v1', 'source.commit.v1']
});
```

## 開発

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run release:check
```
