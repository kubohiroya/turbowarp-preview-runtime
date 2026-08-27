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

## 開発

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm run check
pnpm run release:check
```
