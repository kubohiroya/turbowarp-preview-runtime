# turbowarp-preview-runtime

[日本語](README.ja.md)

`@kubohiroya/turbowarp-preview-runtime` provides app-neutral preview protocol and live reload primitives for TurboWarp applications.

It does not parse app DSLs, own diagnostics, read files, or render app-specific UI. App packages inject source frontend results, copy, diagnostics, and runtime actions.

## Scope

- Preview protocol capability negotiation.
- Session and revision validation.
- Source stage / defer / commit / disconnect message handling.
- Simple reload anchor resolution.
- App-neutral error classes and validation helpers.

## Boundary

The package owns protocol mechanics only. Consumers remain responsible for file watching, source compilation, diagnostics rendering, app-specific reload policy, and any TurboWarp runtime mutations.

## Example

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

## Development

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run release:check
```
