# Phase 4 #1 verification packet — Context resolver / materialization

- **Status:** VERIFIED / CLOSED
- **Date:** 2026-08-08
- **Basis:** PROPOSAL-023 (approved with required changes)
- **Repository:** https://github.com/EchoTouch-moon/canvas-agent

## Requirement → evidence map

| PROPOSAL-023 invariant / decision | Evidence | Status |
|---|---|---|
| Public `snapshot.freeze` is selection-based only (B1) | `snapshotFreezeSchema` carries `selections`; content-bearing `items` removed from the public contract | **PASS** (contracts tests) |
| `freezeContextSnapshot(items)` kept as internal persistence primitive | `packages/persistence/src/commands/snapshot.ts` unchanged; used directly by tooling/tests | **PASS** |
| No reserved future kinds | `sourceReferenceSchema` = TASK_SPEC_VERSION + NODE_VERSION only; REPOSITORY_CONTENT/ARTIFACT/USER_INPUT rejected | **PASS** (contracts tests) |
| `context.resolve` deferred | no new command added | **PASS** |
| A. metadata-free selections | `ContextSelection = { source, selectionReason? }`; schema rejects extra metadata | **PASS** |
| B. scope-parameterized resolver | `ContextResolver.resolve(scope, ref)` with the full snapshot binding | **PASS** |
| C. `ResolvedContextItem.itemType` | resolver output includes itemType | **PASS** |
| D. pinned TaskSpec auto-materialized | resolver always emits USER_INPUT/TASK_INSTRUCTION/P0 at position 0; renderer never submits it | **PASS** (workspace-service + resolver tests, E2E) |
| E. NodeVersion must belong to baseBaseline | wrong-project → ValidationError; non-member → ValidationError | **PASS** (resolver tests) |
| F. no duplicate sources | `duplicate_context_source` ValidationError on canonical sourceRef key | **PASS** (resolver tests) |
| Canonical hash-stable materialization | resolvedContent matches the aggregate's own canonical content; `contentHash === version.contentHash` asserted | **PASS** (workspace-service test) |
| Strict canonical encoding | `sourceRefToString`/`parseSourceRef` round-trip; raw ids / unknown schemes rejected | **PASS** (contracts tests) |

## Runtime evidence

`CANVAS_AGENT_PHASE3_SMOKE=1` (now selection-based):

```text
[phase3-smoke] snapshot frozen PASSED   ← pinned task spec + NODE_VERSION selection materialized
[phase3-smoke] execution outcome=SUCCEEDED
[phase3-smoke] PASSED
```

`pnpm --filter @canvas-agent/desktop e2e:live` (real Electron, Playwright):

```text
[e2e] PASS project hydration
[e2e] PASS composer real candidates        ← pinned task spec row + baseline node versions only
[e2e] PASS real snapshot freeze            ← snapshot.freeze(selections) → FROZEN
[e2e] PASS execution dispatch -> SUCCEEDED evidence
[e2e] PASS claim granted / verification exit 0 / outcome badge
[e2e] ALL PASSED
```

## Verification note

`pnpm check` green (168 tests); CI will publish commit status on the PR.
The renderer's Composer shows the pinned TaskSpecVersion as a required,
non-submitted row; only baseline node versions are selectable sources.
