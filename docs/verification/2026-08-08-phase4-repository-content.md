# Phase 4 #2 verification packet — RepositoryContent + context.resolve

- **Status:** VERIFIED / CLOSED
- **Date:** 2026-08-08
- **Basis:** PROPOSAL-023 (REPOSITORY_CONTENT + `context.resolve` implemented per the frozen Phase 4 #2 direction)
- **Repository:** https://github.com/EchoTouch-moon/canvas-agent

## Requirement → evidence map

| Frozen decision / invariant | Evidence | Status |
|---|---|---|
| `REPOSITORY_CONTENT = REFERENCE / P2` | resolver materializes itemType REPOSITORY_CONTENT, authority REFERENCE, priority P2 | **PASS** (resolver + workspace-service tests, E2E) |
| Full `ContextResolutionScope` for `context.resolve` | `contextResolveSchema` carries projectId/taskId/taskSpecVersionId/baseBaselineId/expectedRepositoryRevisionId + `SourceReference[]` | **PASS** (contracts) |
| Clean revision only; dirty rejected | `workingTreePatchHash !== null` → `ValidationError('repository_content_dirty_revision_unsupported')` | **PASS** (resolver test) |
| Path discovery = text input only | Live view resolve box; no `repository.list` / tree browser added | **PASS** |
| Async ripple (sequential) | `resolve`/`materialize`/`freezeSnapshot`/`resolveContext` async; materialize awaits selections sequentially | **PASS** (typecheck + tests) |
| A. preview ≠ freeze trust | `context.resolve` returns items; freeze only accepts `SourceReference` selections and re-resolves; `resolvedContextItemSchema` cannot be submitted to `snapshot.freeze` | **PASS** (contracts + E2E) |
| B. canonical repo path | schema refine + resolver guard reject absolute/`..`/`//`/`\`/NUL/empty | **PASS** (contracts + resolver tests) |
| C. `repo://` segment codec | segment-wise `encodeURIComponent`; parse decodes/validates/re-encodes with exact match | **PASS** (contracts round-trip incl. space/unicode) |
| D. UTF-8 + 512 KiB cap, fail-closed | byte-safe `git cat-file` + fatal TextDecoder; real tests commit a 512 KiB+1 file → `repository_content_too_large` and a `0xff 0xfe 0xff` blob → `repository_content_not_utf8` | **PASS** (resolver tests) |
| E. error separation | invalid path → ValidationError; dirty → ValidationError; missing file at valid commit → NotFoundError; unavailable pinned commit / git infra → InternalError | **PASS** (resolver tests incl. ghost-commit InternalError) |
| project-scoped preview | unified `validateContextResolutionScope` at resolve/materialize entry (Task→project, TaskSpec→task, Baseline→project+ACTIVE, RepositoryRevision exists); cross-project `context.resolve` rejected | **PASS** (resolver tests) |
| encoded-path UI round-trip | Live Add uses `parseSourceRef(preview.sourceRef)` (decoded path), never `sourceRef.replace('repo://', '')`; E2E resolves `docs/context file.md` → `repo://docs/context%20file.md` → freeze → dispatch | **PASS** (E2E) |
| drive-style paths rejected | `isCanonicalRepositoryPath` rejects `C:/foo`, `C:\foo` | **PASS** (contracts tests) |

## Runtime evidence

`pnpm --filter @canvas-agent/desktop e2e:live` (real Electron, Playwright):

```text
[e2e] PASS project hydration
[e2e] PASS composer real candidates
[e2e] PASS repository content resolve -> add selection   ← docs/context file.md via context.resolve
[e2e] PASS real snapshot freeze (node version + repo content)
[e2e] PASS execution dispatch -> SUCCEEDED evidence
[e2e] ALL PASSED
```

`CANVAS_AGENT_PHASE3_SMOKE=1` PASSED. `pnpm check` green (184 tests: domain 5,
contracts 30, persistence 42, worker-runtime 19, desktop 88).

## Verification note

CI publishes commit status on the PR. The E2E drives a space-containing pinned
path (`docs/context file.md`) so the `repo://` codec is exercised end to end.
