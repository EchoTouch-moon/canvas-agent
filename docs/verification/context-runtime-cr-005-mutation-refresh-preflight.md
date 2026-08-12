# CR-005 Mutation Refresh Preflight

- **Status:** CREDENTIAL-FREE READY / LIVE RERUN NOT AUTHORIZED
- **Branch:** `codex/cr005-mutation-refresh-gate`
- **Base:** `main@a359636609856977a98a883831392084f7cb4a4d`
- **Date:** 2026-08-13
- **Provider calls during remediation:** 0
- **Trigger:** replacement canary run 1 failed closed after exactly two records

## 1. Problem closed

Replacement run 1 produced two individually `VALID` C1 records but failed the aggregate
world-state gate. The Shadow Agent read five fixture files before editing, then changed
`src/discount.js` and completed its checks without any post-edit repository read.

The live runner previously invoked `RepositoryObserver` only after a `read` tool result. The
dirty world therefore remained unobserved, so the run could not prove
`UNAVAILABLE(REVISION_MISMATCH)`, `RETAIN_LAST_KNOWN` or pinned Git-blob recovery.

This was a trigger-coverage failure. It was not evidence that DS-014 passed or failed.

## 2. Bounded remediation

`RepositoryMutationRefreshGate` is an in-memory, per-run, one-shot signal:

1. a completed `edit`, `write` or `bash` marks a possible repository mutation;
2. at the next Shadow model-call boundary, the runner first waits for all earlier read
   observations;
3. it then takes a sorted, deduplicated snapshot of paths admitted from actual Agent reads;
4. those paths pass through the same existing `queueRepositoryRead` authority boundary;
5. the refreshed state is consumed before `planner.observeModelCall`;
6. taking the signal clears it, so an unchanged later boundary does not refresh again.

The refresh is conservative for `bash`: even an error may have partially mutated a repository,
so the runner does not trust command success as proof of immutability.

## 3. Separation and security invariants

- The refresh set is derived only from `observedRepositoryPaths`, which is populated after a
  real Agent read produces an authoritative `AVAILABLE` observation.
- Manifest `knownCandidatePaths`, `knownRelevantPaths` and `knownIrrelevantPaths` remain outside
  the Planner candidate and mutation-refresh paths.
- Repository-relative normalization, absolute-path rejection, observation sanitization,
  credential-free child environments and metadata-only durable records are unchanged.
- Native messages and Shadow messages remain identity-equal to their input; this patch does not
  activate Shadow working sets.
- No Product MVP package, public contract, database schema or Renderer surface changed.

## 4. Deterministic regression evidence

The runner tests now cover:

- only `edit`, `write` and `bash` produce mutation refresh paths;
- paths are deduplicated and sorted;
- `read` and `grep` do not produce mutation refreshes;
- an edit signal recorded before an earlier read observation settles sees the later admitted
  path at the model boundary;
- the signal is consumed exactly once;
- clean admission followed by a dirty edit works without a reread and still yields
  `UNAVAILABLE(REVISION_MISMATCH)` → retained exact SourceVersion → pinned `FULL`
  representation of the original bytes.

## 5. Credential-free verification

All commands used Node `v24.15.0`.

```text
@canvas-agent/context-benchmarks typecheck     PASS
@canvas-agent/context-benchmarks test          40/40 PASS
benchmark:validate                             PASS (C1-C6)
pnpm check                                     PASS (697 tests + build)
git diff --check                               PASS
```

The first sandboxed validator attempt was blocked before execution because `tsx` could not
create its local IPC pipe (`listen EPERM`). The same credential-free command was rerun with
local IPC permission and passed all six corpus categories. It did not use network or Provider
access.

## 6. Frozen next gate

No live/provider call is authorized by this remediation. After Lead review, CI and merge, a
replacement rerun would require a new explicit authorization for exactly another two records
and for sending the same synthetic C1 fixture to DeepSeek.

```text
replacement run 1                FAIL / STOP (2 records consumed)
mutation refresh preflight       CREDENTIAL-FREE READY
replacement rerun                NOT AUTHORIZED
remaining CR-005 22 records      NO_GO
CR-004 Active rewrite            NO_GO
```

See also:

- [replacement canary run 1](./context-runtime-cr-005-replacement-canary-run-1.md)
- [DS-014 world-state preflight](./context-runtime-cr-005-shadow-world-state-preflight.md)
