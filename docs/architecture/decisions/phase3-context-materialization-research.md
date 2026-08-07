# Context materialization / resolution boundary — pre-research

- **Status:** Research note — no contract change in Phase 3
- **Author:** DeepSeek V4 Flash
- **Date:** 2026-08-08
- **Basis:** PROPOSAL-022 (approved with required changes)

## Problem

Phase 3's Composer freezes candidates that the renderer builds from authoritative
data the UI already received over IPC (TaskSpec content → `USER_INPUT`; NodeVersion
content → `NODE_VERSION`). But the freeze contract still accepts free-form:

```ts
snapshot.freeze({
  items: [{
    itemType: 'NODE_VERSION',
    sourceRef: 'nv_123',
    resolvedContent: '<anything the renderer sends>',
    authority, priority, ...
  }]
})
```

Schema-wise `resolvedContent` is not verified against the persisted NodeVersion it
claims to reference. A renderer (or a future compromised path) could freeze content
that does not match the authoritative source. This is not a Phase 3 blocker, but it
matters once "trusted context freeze" is a real requirement.

## Options

### A — Renderer sends content, Main validates

Renderer keeps sending `resolvedContent`; Main verifies, for typed sources, that
`resolvedContent === persisted(title/body)` (or its hash) before freezing.

- Pros: no contract change; catches drift.
- Cons: still trusts renderer to pick the right `sourceRef`; large content rides
  the IPC envelope; validation is per-item special-casing.

### B — Renderer sends typed source selections, Main materializes (preferred)

```ts
snapshot.freeze({
  selections: [
    { itemType: 'NODE_VERSION', sourceId: 'nv_xxx' },
    { itemType: 'TASK_INSTRUCTION', sourceId: 'spec_yyy' }
  ]
})
```

Main resolves each selection from authoritative persistence:

```text
resolve → copy content → hash → freeze
```

- Pros: renderer never fabricates content; content never crosses the IPC boundary
  in the freeze payload; Main is the single authority for what gets frozen; clean
  future path for `context.resolve` / repository content.
- Cons: freeze becomes an async materialization on Main; needs a
  `ContextResolver` that knows how to materialize each item type (TaskSpec,
  NodeVersion now; RepositoryContent later); a small contract change.

## Recommendation

Keep Phase 3 on the current contract (items with `resolvedContent`). Before a
"trusted context freeze" requirement lands, adopt **option B** behind a new
`context.resolve`-style boundary. Specifically:

1. Add a Main-side `ContextResolver` that, given typed selections, returns
   authoritative `(sourceRef, resolvedContent, authority, priority)` — this is the
   single place repository content will be read later.
2. Evolve `snapshot.freeze` (or add `snapshot.freezeFromSelections`) to accept
   selections and materialize on Main.
3. Keep `resolvedContent`-based freeze for tooling/tests.

Do not implement any of this in Phase 3 — it is deliberately parked until the
trusted-freeze requirement is triggered.

## Trigger

"Trusted context freeze" becomes required when a Snapshot's frozen items must be
verifiable against the authoritative graph without trusting the renderer — i.e.
the same point at which multi-user permissions or audited context become a
requirement.
