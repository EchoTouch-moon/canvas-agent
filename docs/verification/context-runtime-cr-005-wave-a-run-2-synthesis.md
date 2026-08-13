# CR-005 Wave A Run 2 — bounded evidence synthesis

## 1. Scope and data integrity

This synthesis covers the single authorized Run 2 execution after CR-005B was
merged. It is descriptive evidence, not a complete Wave A result and not a
provider-quality or cost claim.

| Field | Value |
| --- | --- |
| Baseline | `main@b1984f794e3759421525abd7cefb416fb6606815` |
| Harness | post-CR-005B |
| Run | `wave-a-1786613262589-0262811a-ad35-4b8d-b745-4cda69e7b619` |
| Authorized scope | C2–C6, Native/Shadow, at most 10 records |
| Terminal status | `STOPPED` at C4 Native record gate |
| Durable records | 5; record/progress IDs and order match |
| Checkpoint | `STOPPED`, `record_gate_failed`, 5 records |
| Raw provider payloads | Not retained |
| Credential-pattern scan | Clear |

The metadata checkpoint was copied into the repository's Git-ignored
`.live-output/wave-a/<run-id>/` directory. Its `records.jsonl` SHA-256 is
`b2b10e9f7d2e510b62f4d851c07e948a344904a1ba2ad74428237fe61dc49fc2`; the
checkpoint output count is five. Run 1's terminal checkpoint was not resumed
and its identity was not reused.

## 2. Progressive execution outcome

| Category / strategy | Status | Gate result |
| --- | --- | --- |
| C2 Native | `VALID` | record gate pass |
| C2 Shadow | `VALID` | record gate and pair gate pass |
| C3 Native | `VALID` | record gate pass |
| C3 Shadow | `VALID` | record gate and pair gate pass |
| C4 Native | `INVALID` / `TASK_FAILURE` | record gate failed |
| C4 Shadow | not executed | correctly suppressed |
| C5–C6 | not executed | correctly suppressed |

The stop happened after C4 Native was durably written. There were two
completed pairs and no provider task was started after the failed C4 record.
This confirms the CR-005A fail-closed boundary for this run: a failed record
did not consume C4 Shadow or later-category provider budget.

## 3. Failure diagnosis

C4 Native passed its objective and regression oracles, but wrote
`src/cli/normalize.js` in addition to the allowed domain paths:

```text
changed paths:
  src/cli/normalize.js
  src/domain/normalize.js
  src/domain/user.js
out-of-scope path:
  src/cli/normalize.js
```

The record therefore failed the writable-path validity gate and was correctly
classified as `TASK_FAILURE`. It is not a harness-contract failure, because
the objective/regression evidence was trustworthy and the failure was an
actual scope violation. The record remains excluded from validity-based
aggregation even though its objective criteria passed.

Run-level diagnostics were:

```text
total records:                 5
valid records:                 4
task failures:                 1
harness-contract failures:     0
aborted records:               0
materialization failures:      0
```

## 4. What the valid records do show

The post-CR-005B C2 contract probe passed for both C2 Native and C2 Shadow:
the objective/regression oracles passed, and the observable
`config → greeting → public index` checks returned true. This is evidence that
the repaired probe did not reproduce the prior C2 implementation-shape false
negative in these two records. It is not sufficient to establish general C2
validity beyond this run.

Both C3 records also passed their objective, regression, acceptance, and
writable-path checks. Thus the run produced two valid Native/Shadow pairs, but
not the ten-record Wave A matrix required for a full Wave A synthesis.

## 5. Shadow evidence quality caveat

The C2 and C3 Shadow records remained `VALID` under the current record-validity
predicate and both pair gates passed. They nevertheless retained repository
observer failures caused by `REVISION_MISMATCH`:

```text
C2 Shadow observation failures: 28
C3 Shadow observation failures: 26
aggregate observation failures: 54
```

These are preserved as evidence and are not silently treated as clean Shadow
observations. They did not trigger `HARNESS_CONTRACT_FAILURE` and did not
rewrite the Native/Shadow messages. Before any future live run, Lead should
decide whether this observer condition is an acceptable caveat for research
data or should become a separate validity/exclusion rule. That is a follow-up
policy question, not a post-hoc reclassification of this terminal run.

The subsequent zero-provider adjudication resolved that question for this
run: both records are `VALID / SHADOW_EVIDENCE_CAVEATED /
USABLE_WITH_CAVEAT`. Mismatch states followed initial `AVAILABLE` observations;
last-known versions and pinned representations were retained; materialization
failures were absent; and the saved Shadow traces replayed deterministically.
See the dedicated [Shadow evidence adjudication](context-runtime-cr-005-wave-a-run-2-shadow-adjudication.md)
for the per-path audit and the C3 duplicate-observation caveat.

The valid Shadow telemetry contained no `REMOVE`, `REHYDRATE`, read-after-
remove, search-after-remove, or representation-transition events. It recorded
70 `ADD` and 280 `KEEP` decisions, with 72 `FULL` and 278 `REFERENCE`
representations. With only two Shadow records and observer failures present,
these counts describe this run's trace; they do not support claims about
general retention, rehydration, or representation behavior.

## 6. Budget accounting and limitations

Authorization accounting includes the failed C4 Native record:

| Counter | Executed | Maximum |
| --- | ---: | ---: |
| Semantic calls | 38 | 160 |
| Tool calls/results | 74 / 74 | 640 |
| Record wall-clock time | 84,236 ms | 1,500,000 ms |

The aggregate's 28 semantic calls and 53 tool calls are valid-record-only
research totals; they intentionally exclude the invalid C4 Native record.
They must not replace the execution-budget totals above.

The aggregate also reports internal Native/Shadow estimate totals of 12,222
and 4,316 for the four valid records. These are different internal estimate
scopes, not provider token counts, prices, or demonstrated savings. No token
or cost-saving claim is made.

There is one repetition per strategy/category, only two completed category
pairs, and no complete C2–C6 matrix. No confidence interval, significance
test, variance estimate, or model-generalization claim is warranted.

## 7. Decision and next step

```text
Wave A Run 2:        STOPPED / TERMINAL / NEVER RESUME
Shadow adjudication: ACCEPTED
C2/C3 Shadow:        USABLE_WITH_CAVEAT
C4 Native:           genuine TASK_FAILURE
Wave A:              COMPLETE_AS_STOPPED_EXPERIMENT
Run 3:               NO_GO
Wave B:              NO_GO
CR-004:              NO_GO
```

No evaluator repair is required from the Run 2 evidence. No new provider
execution is authorized, and the Run 2 checkpoint must not be resumed. The
next step is the separate credential-free CR-005 interim evidence analysis;
it does not authorize another run.
