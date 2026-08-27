# Changelog

## Unreleased

- Add app-neutral preview protocol controller, operation queue, validation helpers, and negotiation primitives.
- Keep the source lifecycle session adapter as a compatibility wrapper over the new controller.
- Document migration notes for consuming apps while keeping app-specific preview policy outside this package.

## 0.1.0

- Initial public package shape for app-neutral TurboWarp preview protocol primitives.
- Add preview protocol session state, revision validation, capability normalization, and source lifecycle helpers.
- Add reload anchor resolution for consumers that provide live preview reload affordances.
