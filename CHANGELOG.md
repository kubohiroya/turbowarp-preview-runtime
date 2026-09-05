# Changelog

## Unreleased

- Add app-neutral preview protocol controller, operation queue, validation helpers, and negotiation primitives.
- Keep the source lifecycle session adapter as a compatibility wrapper over the new controller.
- Document migration notes for consuming apps while keeping app-specific preview policy outside this package.
- Add `errorCodePrefix` so an app reports protocol failures in its own diagnostic namespace, with `previewProtocolErrorCode` and `normalizePreviewErrorCodePrefix` exported for apps that raise the same failures themselves. Every validation helper takes an optional prefix, and the default stays `TWRP`.
- Add candidate tracking to the controller: `acceptCandidate`, `requireCandidate`, and `clearCandidate`, a `candidate` field on connection snapshots, and a new `-PROTOCOL-CANDIDATE` failure. Accepting a newer revision discards the previous candidate.
- Add `connectionId` to connection snapshots and an optional `expectedConnectionId` argument to `requireConnection`, so a two-phase operation can reject a connection that was replaced during an await.
- Add `requireCapability` to reject an operation the client never negotiated.
- Add `track` to the operation queue and the controller, so `whenIdle` also waits for work that settles outside the queue.
- Add `deferCapability`, `getState()`, and `whenIdle()` to the source lifecycle session adapter.

### Behavior change

- Disconnecting a session that is already disconnected is now a no-op instead of a `-PROTOCOL-DISCONNECTED` failure, so cleanup and reconnect races do not have to know whether a connection is still open. A disconnect naming a different session is still rejected with `-PROTOCOL-SESSION`.

## 0.1.0

- Initial public package shape for app-neutral TurboWarp preview protocol primitives.
- Add preview protocol session state, revision validation, capability normalization, and source lifecycle helpers.
- Add reload anchor resolution for consumers that provide live preview reload affordances.
