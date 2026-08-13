# CR-005 Wave A Run 2 — Shadow evidence adjudication

## 1. Adjudication scope

This is a credential-free audit of the already completed C2 and C3 Shadow
records from Run 2. It does not change the evaluator, rewrite the records, run
the provider, resume the checkpoint, or start a supplemental C4 run.

| Field | Value |
| --- | --- |
| Run | `wave-a-1786613262589-0262811a-ad35-4b8d-b745-4cda69e7b619` |
| Baseline | `main@b1984f794e3759421525abd7cefb416fb6606815` |
| Provider calls during adjudication | `0` |
| Records audited | C2 Shadow, C3 Shadow |
| Source artifact | Git-ignored `records.jsonl` / `progress.json` / `aggregate.json` |
| Run status | `STOPPED / TERMINAL` at C4 Native; unchanged |

The previous Run 2 stop evidence remains historical. This document only adds
a post-run evidence classification for the two completed Shadow records.

## 2. Adjudication policy

The audit applies the four Lead-approved checks to each recorded
`REVISION_MISMATCH` path:

1. the mismatch appears after the initial authoritative `AVAILABLE` state and
   after the runner's mutation-refresh boundary;
2. `admittedVersionId`, `lastAvailableVersionId`, and the admitted version
   remain identical;
3. a pinned `FULL` or `LINE_RANGE` representation uses that admitted version,
   with no materialization failure;
4. the saved Shadow Universe, Working Set, transition, and planning evidence
   replay deterministically.

The first condition is established from both the retained sequence order and
the runner invariant: `RepositoryMutationRefreshGate` only returns observed
paths after a completed `bash`, `edit`, or `write` tool, and the Shadow context
handler refreshes those paths before the next planner call. See
`research/context-benchmarks/src/live-runner.ts` around the mutation gate and
Shadow context boundary. The durable record does not retain the exact mutating
tool name, so that detail is intentionally not inferred.

## 3. Machine results

The existing pair gate was re-evaluated from the preserved records without
provider access. Both pairs returned `PASS` for identity, validity, fixture and
model matching, sanitization, materialization absence, and Shadow replay.

| Check | C2 Shadow | C3 Shadow |
| --- | --- | --- |
| Pair gate | `PASS` | `PASS` |
| Revision-mismatch paths | 7 | 5 |
| `REVISION_MISMATCH` observer entries | 28 | 26 |
| First `AVAILABLE` model-call sequence | 3 | 3 |
| First `UNAVAILABLE` model-call sequence | 5 | 4 |
| Last-known version preserved | `PASS` for all post-mismatch snapshots | `PASS` for all post-mismatch snapshots |
| Pinned representation | `FULL`, all checked paths | `FULL`, all checked paths |
| Materialization failures | 0 | 0 |
| Deterministic replay | `PASS` | `PASS` |
| Replay hash | `d3068c83d84883b91c6dff47de39efdb1c16b0dc195b6360ad97df29fcfbf858` | `4983687f0b1a102052a659de139e0ad695e7d86a6d12a6de752ddaaf1e85a1ad` |

For every mismatch path, an `AVAILABLE` state preceded the first
`UNAVAILABLE` state. Each subsequent Universe snapshot retained the same
non-null version in `admittedVersionId`, `lastAvailableVersionId`, and
`admittedVersion.versionId`; the corresponding conservative `KEEP` decision
used that same version; and the retained `FULL` representation listed that
version in `sourceVersionIds`.

## 4. Record-specific notes

### C2 Shadow

All seven observed repository paths first became `AVAILABLE` at planner
sequence 3 and first became `UNAVAILABLE` at sequence 5. The four subsequent
post-mismatch planner snapshots for every path retained the same pinned
version and `FULL` representation. The 28 observer failures are therefore
expected dirty-world `REVISION_MISMATCH` states, not materialization or replay
failures.

### C3 Shadow

All five observed repository paths first became `AVAILABLE` at planner
sequence 3 and first became `UNAVAILABLE` at sequence 4. Five post-mismatch
planner snapshots per path retained the same pinned version and `FULL`
representation.

The observer ledger contains one extra duplicate `src/cache.js`
`REVISION_MISMATCH` entry beyond the 25 path/snapshot occurrences represented
in the saved Universe snapshots. The durable observation schema does not attach
an observer entry to a model-call sequence, so the duplicate cannot be given a
false exact sequence. It occurs within the already-established post-mutation
unavailable interval; the next saved planner state still retains the same
last-known version and pinned representation, and the complete eight-call
Shadow trace replays deterministically. This is recorded as evidence-granularity
caveat, not dropped as if it did not exist.

## 5. Final classification

| Layer | C2 Shadow | C3 Shadow |
| --- | --- | --- |
| Task validity | `VALID` | `VALID` |
| Shadow evidence | `SHADOW_EVIDENCE_CAVEATED` | `SHADOW_EVIDENCE_CAVEATED` |
| Comparative eligibility | `USABLE_WITH_CAVEAT` | `USABLE_WITH_CAVEAT` |

The caveat means the records may enter the bounded Native-vs-Shadow
comparative set with explicit dirty-world / last-known semantics. They must not
be presented as clean observations, and this two-pair sample does not support
general retention, cost, token-saving, or model-quality claims.

## 6. Decision

```text
C2 Shadow: VALID / SHADOW_EVIDENCE_CAVEATED / USABLE_WITH_CAVEAT
C3 Shadow: VALID / SHADOW_EVIDENCE_CAVEATED / USABLE_WITH_CAVEAT
C4 Native: TASK_FAILURE / WRITABLE_PATH_SCOPE_FAILED
Run 2: STOPPED / TERMINAL / PRESERVE / NEVER RESUME
Run 3: NOT AUTHORIZED
Wave B: NO_GO
CR-004: NO_GO
```

No CR-005C evaluator repair is opened. The C4 failure remains a genuine model
task failure, and the two completed Shadow pairs remain part of Run 2 with the
adjudicated caveat.
