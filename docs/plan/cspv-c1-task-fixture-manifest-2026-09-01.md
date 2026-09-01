# C1-A Task / Fixture Manifest — Draft

## Decision boundary

| Field | Value |
| --- | --- |
| Status | `DRAFT — LEAD REVIEW REQUIRED` |
| Package | `C1-A — Task / Fixture Manifest` |
| Protocol | `C1_PROTOCOL_V1` |
| Base revision | `main@e6763734934f3b6cac6bf65df3dbd94d57f2dc59` |
| Corpus shape | 4 strata × 1 task identity |
| Provider execution | `NO_GO` |
| Runtime treatment implementation | `NOT AUTHORIZED` |
| CR-004 Active Rewrite | `NO_GO` |

This manifest operationalizes
[`C1_PROTOCOL_V1`](./cspv-c1-comparative-effectiveness-protocol-2026-09-01.md).
The machine-readable companion is
[`c1-effectiveness-v1.json`](../../research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json).
Neither artifact authorizes live execution. C1-B must later bind provider,
model, runtime, repetition count, budgets, randomization seed, and final
adjudication parameters.

## 1. Selection principles

The corpus is intentionally small and is selected to create legitimate
opportunities for Native and Runtime to differ while keeping task outcome
adjudicable. Every task has a frozen objective and regression oracle, an
explicit relevant/distractor classification, a ground-truth basis for removal
judgments, task-semantic phase boundaries, and a declared Cold Context
Penalty eligibility state.

The task identities are new C1 bindings to immutable repository fixture
snapshots. They do not reuse C0 live evidence, C0 queued lifecycle-event
adapters, provider payloads, or prior run identities. Changing any referenced
file requires a new manifest version.

| Task | Stratum | Main effect opportunity |
| --- | --- | --- |
| `c1-t1-localized-distractor-v1` | localized investigation + distractors | eliminate unrelated scheduler utilities while retaining the pagination path |
| `c1-t2-multi-file-migration-v1` | multi-file / multi-source reasoning | coordinate one shared contract across nine call-site files |
| `c1-t3-failure-recovery-v1` | failure diagnosis + recovery | reproduce, diagnose, patch, and verify a cache-hit failure |
| `c1-t4-delayed-context-recovery-v1` | phase transition / delayed-context demand | rule out a wrong path, then recover the parser implementation |

## 2. Identity and hash policy

The JSON manifest records the base revision, fixture/reference Git tree object
IDs, canonical content hashes, exact prompt hashes, oracle commands, source
classifications, phase boundaries, and endpoint eligibility.

```text
fixtureTreeObjectId
  = git rev-parse <baseRevision>:<fixture-directory>

fixtureContentSha256
  = SHA-256(sorted newline-delimited list of
            '<file SHA-256>  <fixture-relative path>')

promptSha256
  = SHA-256(exact UTF-8 prompt bytes, no trailing newline)
```

A hash mismatch is an identity/harness failure, not a model task failure.

## 3. Task bindings

### T1 — Localized investigation with distractors

```text
taskId:        c1-t1-localized-distractor-v1
fixture:       research/context-benchmarks/corpus/L3-noisy-bug-hunt/fixture
reference:     research/context-benchmarks/corpus/L3-noisy-bug-hunt/reference
write target:  src/scheduler/paginator.js
primary:       node --test test/pagination.test.js
regression:    node --test test/regression.test.js
```

The pinned defect is the paginator's inclusive upper-bound calculation; the
primary test requires half-open windows and full-page scheduler behavior. The
objective path is `paginator.js → scheduler.js → job.js → pagination.test.js`.
The unrelated backoff, priority-queue, sliding-window, recurrence, hash,
dead-letter, and legacy scheduler modules are explicit distractors. Their
removal is eligible for Removal Precision only after the objective path is
established. No nominal later-needed source is declared, so rehydration is
`NOT_ESTIMABLE` and Cold Context Penalty is `NOT_APPLICABLE`.

Phase boundaries are `REPRODUCE` (primary failure recorded), `LOCALIZE`
(paginator path established), and `PATCH_VERIFY` (target edited and both
oracles invoked).

### T2 — Multi-file / multi-source migration

```text
taskId:        c1-t2-multi-file-migration-v1
fixture:       research/context-benchmarks/corpus/L1-multi-file-refactor/fixture
reference:     research/context-benchmarks/corpus/L1-multi-file-refactor/reference
primary:       node --test test/format-price.test.js
regression:    node --test test/regression.test.js
```

The task migrates `formatPrice` to the options-based contract and all expected
model, service, and facade call sites. The nine expected writable paths and
the full options/locale oracle define success; partial migration is not
success. Report/export modules, the deprecated tax table, and the XML adapter
are explicit distractors and may not be edited. `utils/money.js` and the
regression test are required later for verification. Removal Precision is
eligible; no nominal REMOVE-to-later-need interval is declared, so
rehydration is `NOT_ESTIMABLE` and Cold Context Penalty is `NOT_APPLICABLE`.

Phase boundaries are `CONTRACT`, `MIGRATE`, and `VERIFY`.

### T3 — Failure diagnosis and recovery

```text
taskId:        c1-t3-failure-recovery-v1
fixture:       research/context-benchmarks/corpus/C3-failing-test-diagnosis/fixture
reference:     research/context-benchmarks/corpus/C3-failing-test-diagnosis/reference
write target:  src/cache.js
primary:       node --test test/cache.test.js
regression:    node --test test/regression.test.js
```

The ground truth requires a cache hit to return the stored value without
invoking the factory and requires `clear()` to invalidate the entry. This is a
deliberately narrow diagnosis task with no source distractor whose removal
can be adjudicated without inventing relevance. Removal Precision and
Rehydration Recovery Rate are `NOT_ESTIMABLE`; Cold Context Penalty is
`NOT_APPLICABLE`.

Phase boundaries are `REPRODUCE`, `DIAGNOSE`, `PATCH`, and `VERIFY`.

### T4 — Phase transition and delayed-context recovery

```text
taskId:        c1-t4-delayed-context-recovery-v1
fixture:       research/context-benchmarks/corpus/C6-wrong-path-rehydration/fixture
reference:     research/context-benchmarks/corpus/C6-wrong-path-rehydration/reference
write target:  src/parser/evaluate.js
primary:       node --test test/evaluate.test.js
regression:    node --test test/regression.test.js
```

The public API, tokenizer, evaluator, and both tests form the relevant path.
`src/search/cache.js` is the explicit plausible-but-unrelated distractor and
the only correct-removal candidate for Removal Precision. It may be removed
after `WRONG_PATH_TRIAGE`. `src/parser/evaluate.js` is not a correct-removal
candidate; a Runtime `REMOVE` of it at the pre-registered boundary immediately
after `WRONG_PATH_TRIAGE` and before parser diagnosis is a premature-removal
event for the separate rehydration analysis. It must remain recoverable and,
if removed, later be restored by `REHYDRATE` with the exact required
SourceVersion and representation before parser diagnosis continues. The
pre-registered lineage is:

```text
REMOVE(src/parser/evaluate.js)
  → later need during RECOVERY
  → REHYDRATE(src/parser/evaluate.js)
  → parser recovery
```

If that originating `REMOVE` does not occur in the frozen window, rehydration
and Cold Context Penalty are `NOT_ESTIMABLE`. A first-time `ADD` is never a
rehydrate.

Phase boundaries are `INVESTIGATE`, `WRONG_PATH_TRIAGE`, `RECOVERY`, and
`VERIFY`. This is the only task with a nominal Cold Context Penalty interval:

```text
A (both arms)
  shared semantic boundary at completion of WRONG_PATH_TRIAGE, immediately
  before parser diagnosis. Runtime is eligible only if it issues the
  pre-registered REMOVE(src/parser/evaluate.js) at this boundary; Native
  records the same boundary without lifecycle events.

B (both arms)
  first focused-oracle invocation after the parser-fix write to
  src/parser/evaluate.js. When A is eligible, Runtime must first
  REHYDRATE(src/parser/evaluate.js) from that originating REMOVE with the
  exact required SourceVersion and representation; earliest invocation is the
  tie-break.

Native
  use the same task-semantic milestones; do not invent REMOVE/REHYDRATE
  events
```

If either arm cannot identify both anchors, or the interval is ambiguous
without the frozen tie-break, or Runtime does not issue the pre-registered
REMOVE and linked REHYDRATE, Rehydration Recovery Rate and Cold Context
Penalty are `NOT_ESTIMABLE`.

## 4. Cross-task endpoint policy

All tasks are eligible for task outcome, provider usage, and agent behavior,
subject to C1 evidence-validity rules. Lifecycle eligibility is task-specific:

| Task | Removal Precision | Rehydration Recovery Rate | Cold Context Penalty |
| --- | --- | --- | --- |
| T1 | eligible | `NOT_ESTIMABLE` | `NOT_APPLICABLE` |
| T2 | eligible | `NOT_ESTIMABLE` | `NOT_APPLICABLE` |
| T3 | `NOT_ESTIMABLE` | `NOT_ESTIMABLE` | `NOT_APPLICABLE` |
| T4 | eligible | eligible | eligible |

`NOT_APPLICABLE` means the task was not designed to create that lifecycle
event. `NOT_ESTIMABLE` means the endpoint could apply but valid evidence or
common anchors were not present. Neither state is converted to zero or used
to silently exclude the task's other endpoints.

## 5. Freeze and exclusion gates

Before C1-A can be marked `FROZEN`, Lead review must confirm for every task:

```text
fixture/reference hashes resolve at baseRevision
prompt bytes match promptSha256
objective and regression oracles are executable and distinct
expected writable paths are complete and scope-bounded
relevant/distractor classification has a ground-truth basis
any source used to adjudicate REHYDRATE has an originating REMOVE relation;
a first-time ADD is never a REHYDRATE
phase boundaries are task-semantic and replayable
Cold Context A/B anchors are common to both arms where eligible
Removal Precision ground truth is explicit
```

The following exclude the affected task from the corresponding confirmatory
endpoint and are reported as identity/harness issues, never as model task
failures:

- fixture/reference tree or content hash mismatch;
- prompt hash mismatch;
- unavailable or non-distinct objective/regression oracle;
- inability to materialize the exact fixture snapshot;
- missing or ambiguous anchor without a pre-registered tie-break;
- attempted write outside `expectedWritablePaths`.

An objective failure with complete, valid evidence remains a task outcome. The
manifest does not authorize retry-until-success behavior.

## 6. Next gate

```text
C1-A manifest review              PENDING
C1-A frozen corpus                NOT YET
C1-B analysis/run contract        NOT STARTED
C1-C treatment readiness          HOLD
C1 live                          NO_GO
Provider execution                NO_GO
CR-004 Active Rewrite             NO_GO
```

After this manifest is reviewed and frozen, C1-B may instantiate `N_pairs`,
AB/BA quotas, endpoint hierarchy, thresholds, budgets, and the exact analysis
matrix. No Provider call may occur merely because this manifest exists.
