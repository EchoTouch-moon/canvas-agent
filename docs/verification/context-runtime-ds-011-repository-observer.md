# DS-011 Verification — Authoritative Repository Observer

- **Status:** EVIDENCE READY — not self-accepted; awaits lead architect review
- **Packet:** `docs/tasks/deepseek/DS-011-repository-observer.md`
- **Owner:** DeepSeek V4 Flash — Context Runtime research implementer
- **Branch:** `agent/deepseek-ds-011-repository-observer`
- **Date:** 2026-08-11
- **Dependency:** CR-003A / DS-010 accepted and merged (PR #18)

---

## 1. Implementation boundary and package placement

New top-level workspace package `packages/repository-observer`, parallel to
`packages/pi-context-integration`. Dependency direction:

```text
repository-observer → context-runtime   (SourceObservation / Universe / representation)
repository-observer → worker-runtime    (revision reading: readRepositoryRevision)
repository-observer → contracts          (isCanonicalRepositoryPath / sourceRefToString / RepositoryRevisionContract)
context-runtime -X-> git / repository-observer
```

`packages/context-runtime` was **not** modified by DS-011. The Observer is the
repository-authority boundary: it owns canonical path validation, revision
verification, filesystem/Git reads and repository-specific reason codes.

## 2. Exact RepositoryRevision binding strategy

- `RepositoryObservationRequest.expectedRevision` is a full
  `RepositoryRevisionContract` (`baseCommit`, `treeHash`, `workingTreePatchHash`).
- Revision is verified **before** file reads and **after** all reads
  (race-safety). Any mismatch (baseCommit, treeHash, or
  workingTreePatchHash) fails closed.
- Mismatch outcomes are never AVAILABLE/ABSENT.

## 3. Clean / dirty revision support status

- **Clean** (`workingTreePatchHash === null`): fully supported. Files read via
  `git cat-file blob <baseCommit>:<path>` under the exact verified revision.
- **Dirty** (`workingTreePatchHash !== null`): **fail-closed** with
  `UNAVAILABLE(DIRTY_REVISION_UNSUPPORTED)`. A dirty revision represents commit
  + working-tree delta; this bounded implementation does not silently read
  baseCommit as current state. Documented as the DS-011 bounded decision.

## 4. Race-detection strategy

Pre-read `verifyRepositoryRevision` (reuses worker-runtime `readRepositoryRevision`
field-by-field) → read all requested blobs → post-read verify. If the repository
changed during the window, the whole batch is re-emitted as
`UNAVAILABLE(REVISION_CHANGED_DURING_OBSERVATION)` rather than trusting stale
AVAILABLE/ABSENT. Tested via expected-vs-actual revision mismatch.

## 5. Path canonicalization / safety behavior

- Uses `isCanonicalRepositoryPath` (contracts) — rejects `..` traversal,
  absolute paths, drive-letter escapes and non-canonical spellings.
- sourceKey reuses `sourceRefToString({ kind: 'REPOSITORY_CONTENT', path })`
  (`repository/file://<path>` scheme), consistent with the v0.2 SourceReference
  codec.
- Non-canonical paths → `UNAVAILABLE(NON_CANONICAL_PATH)`.

## 6. contentHash semantics

- `contentHash = sha256Hex(<exact observed UTF-8 content>)` for supported text
  files.
- No timestamp, model-call sequence, absolute machine path, username, or
  workspace root enters the hash (tested: two observations at different
  timestamps of the same revision yield the same hash).
- `SourceVersionId = H(sourceKey, contentHash)` remains the Runtime identity
  rule; DS-011 does not redefine it.
- Binary/non-UTF-8 content → `UNAVAILABLE(UNSUPPORTED_BINARY)`; oversized files
  → `UNAVAILABLE(FILE_TOO_LARGE)` (512 KB byte-safe bound).

## 7. AVAILABLE / ABSENT / UNAVAILABLE producer semantics

| Status | Producer condition | Evidence |
|---|---|---|
| AVAILABLE | verified revision + path exists + bounded supported content | test 6/7/8 |
| ABSENT | verified revision + `git cat-file blob` authoritatively reports missing | test 9 |
| UNAVAILABLE | revision mismatch / race / non-canonical / read failure / too large / unsupported binary / dirty unsupported | tests 2/4/5/10/13 |

A read failure is never ABSENT; ABSENT requires authoritative git confirmation
at a verified revision.

## 8. Universe reconciliation evidence

Through existing `applySourceObservations` + `sourceDescriptors` (no second
Universe implementation):

```text
AVAILABLE v1                     → INITIALIZE / admit V1
unchanged AVAILABLE              → NO_CHANGE / stable admitted V1
changed at new revision          → UPDATE / admit V2
UNAVAILABLE (read failure)       → RETAIN_LAST_KNOWN / retained V2
authoritative deletion (ABSENT)  → REMOVE / clears admitted version
```

Test 11/12 asserts INITIALIZE → UNAVAILABLE retains admittedVersionId →
ABSENT clears it.

## 9. Pi hint vs Repository Observer authority

Test 16/17 proves:

- A Pi-derived `repository/file://a.ts` hint (simulated as a current target)
  with **no** Observer observation does not create a canonical Universe source.
- The same path with a Repository Observer AVAILABLE observation becomes a
  canonical source (`provenance = REPOSITORY_OBSERVER`).

Authority transition comes from the Observer, not from the hint. No Pi
attribution rules were modified.

## 10. Accepted Planner interoperability evidence

Test 18 proves the canonical repository source is consumable by the accepted
Policy V0 through generic Universe/PlanningRequest interfaces: Observer admits
`repository/file://a.ts` → Universe revision → request pins that sourceKey →
Policy V0 emits a REFERENCE representation / Shadow Working Set item. No
repository-specific logic was added to Policy V0. No FULL/SYMBOL/DIFF/
REPLACE/COMPRESS behavior.

## 11. Package tests / typechecks / pnpm check

```bash
pnpm --filter @canvas-agent/repository-observer test        17 passed
pnpm --filter @canvas-agent/repository-observer typecheck   PASS
pnpm --filter @canvas-agent/context-runtime test           78 passed (regression, unchanged)
pnpm --filter @canvas-agent/context-runtime typecheck       PASS
pnpm check                                                  GREEN (613 tests + build)
```

Coverage of the DS-011 required deterministic tests (1-20) is present across
the repository-observer suite, including canonical path identity, revision
match/mismatch, race detection, AVAILABLE/ABSENT/UNAVAILABLE semantics,
Universe transitions, dirty fail-closed, contentHash stability, Pi-hint
non-promotion, Planner interoperability, and the structural no-contract-change
assertions.

## 12. Real temporary-Git smoke

```text
Command: pnpm --filter @canvas-agent/repository-observer smoke:git-repo
SMOKE_STATUS: EXECUTED
AVAILABLE a.ts status=AVAILABLE
dirty status=UNAVAILABLE reason=DIRTY_REVISION_UNSUPPORTED
deleted status=ABSENT
```

Real `git init/commit` transitions with no model credentials. No repository raw
file content is committed; only statuses/hashes are printed.

## 13. Known limitations / proposal mismatches

- **Dirty revisions fail closed** (documented DS-011 decision). Exact dirty
  working-tree observation (verify patch hash then read workspace path with
  post-read race check) is a follow-up if CR-003B requires it.
- Repository observer is **path-targeted, not a crawler**: only requested
  bounded path sets are inspected. No symbol/AST index, embeddings, vector/graph
  ranking or background watcher.
- `UNSUPPORTED_BINARY` / `FILE_TOO_LARGE` treat those files as UNAVAILABLE
  rather than attempting partial content — consistent with fail-closed truth.
- `REVISION_CHANGED_DURING_OBSERVATION` is exercised through expected-vs-actual
  mismatch; a true mid-window mutation race is structurally prevented by the
  same pre/post verification.

## 14. Scope confirmation

```
No CR-003B file-aware policy was implemented.
No FULL/SYMBOL/DIFF representation selection was implemented.
No REPLACE/COMPRESS behavior was implemented.
No real Pi/model context was rewritten.
No production persistence schema was added.
No v0.2 RepositoryRevision/ContextSnapshot/ExecutionRequest public contract was changed.
No OpenCode/Codex integration was added.
CR-004 was not started.
```

DS-011 evidence ready for lead architecture review. DeepSeek does not
self-declare DS-011 accepted.
