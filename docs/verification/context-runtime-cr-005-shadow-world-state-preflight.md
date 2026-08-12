# CR-005 Shadow World-State Preflight Verification (DS-014)

- **Status:** READY FOR LEAD ARCHITECTURE REVIEW — bounded evidence-correctness repair
- **Author:** DeepSeek V4 Flash (research implementer, DS-014)
- **Branch:** `agent/deepseek-ds-014-cr005-shadow-world-state`
- **Base:** `main@0efc0961772c678683c7ead63ae07f045dc1184b`
- **Date:** 2026-08-12

---

## 1. Problem addressed

The first live C1 canary produced two `VALID` records with no credential/provider-payload
leak, but the Shadow evidence was not interpretable as Planner value:

1. `FileRepresentationProvider` required the *current mutable worktree* to equal the old
   clean revision (`baseCommit` + `treeHash` + `workingTreePatchHash`). After the Agent
   edited the fixture worktree, the expected null worktree patch hash no longer matched, so
   exact historical materialization failed with `REVISION_MISMATCH`, and every repository
   representation degraded to `REFERENCE`.
2. The live runner recorded authoritative `UNAVAILABLE` observations only as prose
   diagnostic strings; the external Pi integration seam accepted only `AVAILABLE`-like
   seeds, so the Universe could not represent the `AVAILABLE → UNAVAILABLE` transition even
   though PROPOSAL-030 reconciliation (`RETAIN_LAST_KNOWN`) already supports it.

## 2. Implementation scope (strict DS-014 whitelist)

| Area | File | Change |
|---|---|---|
| A. Exact historical materialization | `packages/repository-observer/src/representation-provider.ts` | Verify pinned tree instead of current worktree |
| A. helper | `packages/repository-observer/src/pinned-tree.ts` | New bounded, shell:false, allowlisted pinned `baseCommit^{tree}` reader |
| A. tests | `packages/repository-observer/tests/representation-provider.test.ts` | Missing-commit/wrong-tree/dirty-worktree/untracked tests |
| B. observation seam | `packages/pi-context-integration/src/extension/enriched-shadow-extension.ts` | `queueExternalObservations` accepts AVAILABLE/ABSENT/UNAVAILABLE + descriptor |
| B. tests | `packages/pi-context-integration/tests/enriched-shadow.test.ts` | AVAILABLE/ABSENT/UNAVAILABLE reconciliation tests |
| C. runner state | `research/context-benchmarks/src/live-runner.ts` | Enqueue exact observation regardless of status; candidate path only on AVAILABLE; bounded sanitized `repositoryObservations` |
| C. types | `research/context-benchmarks/src/types.ts` | Bounded `RepositoryObservationEvidence` (optional record field) |
| C. tests | `research/context-benchmarks/tests/{live-runner,separation}.test.ts` | Sanitization + candidate-admission tests |
| Doc | `docs/verification/context-runtime-cr-005-shadow-world-state-preflight.md` | This record |

No `packages/contracts/**`, `packages/worker-runtime/**`, `packages/domain/**`,
Persistence, Desktop, Planner policy, decision vocabulary, public Context Runtime
contracts, CR-004/Active/Dynamic code, manifests, task prompts or acceptance oracles were
touched.

## 3. A. Exact historical SourceVersion materialization

### Semantic change

Old design: pre-verify `revisionMatches` (reads current HEAD/worktree), read blob, post-verify
`revisionMatches`. A dirty worktree or moved HEAD broke exact materialization.

New DS-014 design for a CLEAN admitted Repository SourceVersion:

```text
verify pinned baseCommit object exists (cat-file -e, in readGitBlob)
→ read baseCommit^{tree} (bounded shell:false allowlisted git rev-parse)
→ compare to expectedRevision.treeHash          (fail closed on mismatch)
→ read baseCommit:path raw bytes (existing Git-blob boundary)
→ sha256(content) === sourceVersionContentHash  (fail closed on mismatch)
→ post-verify pinned tree again (race safety)
→ derive FULL / LINE_RANGE / REFERENCE
```

The immutable pinned blob is the source of truth. The current worktree and HEAD are never
consulted, so a later dirty worktree or moved HEAD does not block exact historical
materialization while the pinned object remains available and exact. Dirty
`expectedRevision` requests remain `DIRTY_REVISION_UNSUPPORTED`.

### Failure classification

| Condition | Reason |
|---|---|
| pinned commit missing / tree unreadable | `REPOSITORY_UNAVAILABLE` |
| pinned tree != expected `treeHash` | `REVISION_MISMATCH` |
| pinned tree changed between pre/post verify | `REVISION_CHANGED_DURING_OBSERVATION` |
| content hash mismatch | `CONTENT_HASH_MISMATCH` |
| dirty expected revision | `DIRTY_REVISION_UNSUPPORTED` |

### Deterministic tests (representation-provider.test.ts)

- clean source admitted → worktree edited → old `FULL` still materializes exact old bytes (5c);
- untracked file elsewhere does not block exact old blob materialization (5d);
- missing pinned commit fails closed `REPOSITORY_UNAVAILABLE` (5);
- wrong expected tree hash fails closed `REVISION_MISMATCH` (5b);
- mismatched SourceVersion content hash fails closed (4);
- binary/oversized/range behavior unchanged (8, 8b, 14);
- post-read pinned-tree change fails closed via seam (6b);
- dirty revision remains unsupported (7).

## 4. B. External observation seam supports all observation states

`EnrichedPiShadowObserver` gained `queueExternalObservations(items)` where each item is
`{ observation: SourceObservation; descriptor: ContextSourceDescriptor }`. `SourceObservation`
is the existing discriminated union — `AVAILABLE` (contentHash), `ABSENT`, `UNAVAILABLE`
(reasonCode). The `queueExternalSeeds` convenience wrapper is retained and now delegates to
the new seam.

At the next model-call boundary the queued items are consumed exactly once (deduplicated by
sourceKey, sorted deterministically) and applied through the **existing** `applySourceObservations`
reconciliation — no second reconciliation implementation was added:

- `AVAILABLE` admits/advances the source version (`INITIALIZE` / `NO_CHANGE` / `UPDATE`);
- `UNAVAILABLE` updates observation status/reason but retains the last admitted version
  (`RETAIN_LAST_KNOWN`, `lastAvailableVersionId` preserved);
- `ABSENT` follows existing absence semantics (`REMOVE`);
- only `AVAILABLE` external observations feed `recentEvidenceSourceKeys`;
- Pi messages remain identity-equal and unchanged.

### Deterministic tests (enriched-shadow.test.ts)

- AVAILABLE admits a version (DS-014 seam 1);
- UNAVAILABLE after AVAILABLE retains last admitted version (2);
- UNAVAILABLE distinct from ABSENT; ABSENT clears admitted version (3);
- per-sourceKey dedup + consume-exactly-once (4);
- UNAVAILABLE/ABSENT not promoted to recent evidence (5); AVAILABLE is (6);
- queued observation surfaced verbatim in `sourceObservations`/`sourceDescriptors` (7);
- Pi message identity preserved (8).

## 5. C. Benchmark runner records state, not only prose

`live-runner.ts` `queueRepositoryRead` now:

- enqueues the exact `SourceObservation` + descriptor **regardless** of
  AVAILABLE/ABSENT/UNAVAILABLE;
- adds a path to the Planner candidate set **only after** an authoritative AVAILABLE
  observation (candidate admission requires AVAILABLE);
- retains the bounded sanitized `observationFailures` diagnostic for UNAVAILABLE/exception
  analysis;
- records a bounded, sanitized `repositoryObservations` state ledger per path
  (`{ path, status, reasonCode }`, max 64 entries, fixture root redacted to `<fixture>`);
- never exposes evaluator-known candidate/relevant paths to the Planner;
- never persists source content, raw Pi/provider payloads, credentials or absolute temp roots.

### Deterministic tests

- `live-runner.test.ts`: sanitization of retained observation paths (no absolute temp roots,
  control chars collapsed, 160-char bound);
- `separation.test.ts`: candidate admission still requires AVAILABLE — a queued UNAVAILABLE
  observation yields an `UNAVAILABLE` Universe entry with no admitted version, no
  representation and no `ADD` decision.

## 6. Credential-free acceptance results

```text
pnpm --filter @canvas-agent/repository-observer test        38 passed
pnpm --filter @canvas-agent/pi-context-integration test     61 passed
pnpm --filter @canvas-agent/context-benchmarks test         26 passed
pnpm --filter @canvas-agent/context-benchmarks benchmark:validate  PASS (all 6 categories)
pnpm check                                                  GREEN (28/28 steps, 643+ tests + build)
git diff --check                                            OK
```

Total context-benchmarks corpus categories validated: C1–C6 fixture oracles fail,
regression/reference oracles pass, identities reproduce.

## 7. Public/stable type change

No public or stable contract type changed. `RepositoryObservationEvidence` is a new
research-only type in `research/context-benchmarks/src/types.ts`; the run-record field is
optional so hand-built records in non-live tests remain valid.

## 8. Live/provider call count

**Zero provider calls during implementation.** The replacement canary is not authorized by
this packet; the lead architect decides after review and cost authorization.

## 9. Final state

```text
CR-005 remaining matrix   NO_GO
CR-004                    NO_GO
provider calls            0 during implementation
```

## 10. Remaining risk and canary authorization request

Risk: the observer still fails closed on a dirty *expected revision*, but the fixture
identity's clean revision remains materializable from the pinned object; the runner now
represents the dirty-world observation as explicit `UNAVAILABLE` with last-known version
preserved. Remaining risk is low but only a live canary can confirm the end-to-end signal.

Authorization request: after lead architecture review and explicit cost authorization,
rerun exactly `C1 × repetition 1 × {NATIVE, SHADOW} = 2 records` as the replacement canary.
The canary passes only if both records are `VALID`, post-edit file evidence no longer
degrades to `REFERENCE` due to revision ambiguity, and the dirty-world state appears as
`UNAVAILABLE` with last-known SourceVersion preserved. If the new canary still degrades
post-edit file evidence, stop; do not run the remaining 22 records.
