# CR-005 Interim Evidence Analysis — C1–C4

## 1. Decision summary

This is a credential-free, descriptive analysis of the evidence already
produced by CR-005. It does not run the provider, resume a checkpoint, retry
C4, change the evaluator, or authorize another experiment.

The current research status is:

```text
CR-005 Wave A:          COMPLETE_AS_STOPPED_EXPERIMENT
C1:                     bounded Native/Shadow canary evidence
C2:                     Native/Shadow pair PASS
C3:                     Native/Shadow pair PASS
C4:                     Native TASK_FAILURE / writable-scope violation
C5–C6:                  no live evidence
Wave A Run 1:           TERMINAL / NEVER RESUME
Wave A Run 2:           TERMINAL / NEVER RESUME
New provider execution: NO_GO
Wave B:                 NO_GO
CR-004:                 NO_GO
```

This is not a complete ten-record Wave A result and is not a claim that
Shadow is better than Native. The evidence is sufficient for an interim
research decision, not for a general performance, cost, or model-quality
claim.

## 2. Provenance and validation boundary

| Evidence              | Baseline                                        | Records | Source integrity                                                                                        |
| --------------------- | ----------------------------------------------- | ------: | ------------------------------------------------------------------------------------------------------- |
| C1 replacement canary | `main@08b13dee2a712c5b0715a645443f72d07ea44072` |       2 | `cr005-1786554086587.jsonl`, SHA-256 `2a639659b51c4acb4cb6902b783fb01d36502784eff0cab489dc78cb00c11d78` |
| Wave A Run 2 C2–C4    | `main@b1984f794e3759421525abd7cefb416fb6606815` |       5 | `records.jsonl`, SHA-256 `b2b10e9f7d2e510b62f4d851c07e948a344904a1ba2ad74428237fe61dc49fc2`             |

All records use `deepseek/deepseek-v4-flash`, repetition 1, and retained
metadata reports `rawProviderPayloadsCaptured=false`. C1 and C2–C4 were run
under different research baselines; C1 is therefore reported as bounded
coverage, not merged into the same execution identity as Wave A Run 2.

The analysis inputs were read from the Git-ignored live-output artifacts and
the corresponding verification documents. Provider calls during this audit:
`0`.

## 3. Record-level descriptive comparison

The workload columns are observed runner counters, not provider billing
metrics. `Tool calls/results` follows the durable record accounting used by
the runner. `Wall clock` is the recorded per-record elapsed time.

| Category / strategy | Status                     | Semantic calls | Tool calls/results | File reads | Searches | Repeated access | Wall clock | Evidence note                                          |
| ------------------- | -------------------------- | -------------: | -----------------: | ---------: | -------: | --------------: | ---------: | ------------------------------------------------------ |
| C1 Native           | `VALID`                    |              7 |                 12 |          5 |        0 |               0 |   13.742 s | all gates pass                                         |
| C1 Shadow           | `VALID`                    |              9 |                 13 |          6 |        0 |               1 |   18.163 s | bounded canary; expected dirty-world mismatch evidence |
| C2 Native           | `VALID`                    |              5 |                 13 |          7 |        0 |               0 |   10.415 s | all gates pass                                         |
| C2 Shadow           | `VALID`                    |              8 |                 16 |          7 |        0 |               0 |   30.110 s | `USABLE_WITH_CAVEAT`; 28 mismatch observations         |
| C3 Native           | `VALID`                    |              7 |                 11 |          6 |        0 |               1 |   10.106 s | all gates pass                                         |
| C3 Shadow           | `VALID`                    |              8 |                 13 |          6 |        0 |               1 |   14.050 s | `USABLE_WITH_CAVEAT`; 26 mismatch observations         |
| C4 Native           | `INVALID` / `TASK_FAILURE` |             10 |                 21 |          7 |        2 |               0 |   19.555 s | objective passed; writable scope failed                |

For the three available Native/Shadow pairs, Shadow had higher observed
semantic calls, tool calls/results, and wall clock in every pair:

| Pair              | Semantic delta (Shadow − Native) | Tool delta | File-read delta | Wall-clock delta |
| ----------------- | -------------------------------: | ---------: | --------------: | ---------------: |
| C1                |                               +2 |         +1 |              +1 |         +4.421 s |
| C2                |                               +3 |         +3 |               0 |        +19.695 s |
| C3                |                               +1 |         +2 |               0 |         +3.944 s |
| Descriptive total |                               +6 |         +6 |              +1 |        +28.060 s |

The total is only a compact description of three different tasks, with C1
from a separate baseline. It must not be interpreted as a controlled
corpus-level effect or a cost result.

## 4. Functional validity and scope adherence

The C1, C2, and C3 Native/Shadow records all passed objective, regression,
acceptance, and writable-path checks. C2's repaired observable
`config → greeting → public index` probe passed for both strategies in the
available pair.

C4 provides the important counterexample. Its objective and regression
oracles passed, and the produced implementation changed:

```text
src/cli/normalize.js
src/domain/normalize.js
src/domain/user.js
```

The frozen writable scope allowed the two domain paths but not
`src/cli/normalize.js`. The result was therefore an actual
`WRITABLE_PATH_SCOPE_FAILED` / `TASK_FAILURE`, not a harness-contract
failure. This separates functional correctness from task-contract
correctness: an objective PASS is insufficient when the frozen modification
boundary is violated.

The progressive gate then stopped after writing C4 Native. C4 Shadow and C5–C6
were not started, so no later provider budget was consumed.

## 5. Shadow world-state and representation evidence

The available Shadow traces contain only `ADD` and `KEEP` decisions:

| Evidence slice          | `ADD` | `KEEP` | `FULL` | `LINE_RANGE` | `REFERENCE` |
| ----------------------- | ----: | -----: | -----: | -----------: | ----------: |
| C1 Shadow               |    31 |    141 |     34 |            0 |         138 |
| C2–C3 Shadow            |    70 |    280 |     72 |            0 |         278 |
| C1–C3 descriptive total |   101 |    421 |    106 |            0 |         416 |

There were no `REMOVE`, `REHYDRATE`, read-after-remove, search-after-remove,
or recorded representation-transition events in these traces. Consequently,
the current evidence does not test the central C5/C6 questions about
irrelevant-context filtering, false removal, or rehydration.

C1's replacement gate recorded 16 expected post-edit
`UNAVAILABLE(REVISION_MISMATCH)` observations with no materialization failure.
The C2/C3 adjudication found 54 corresponding mismatch observations, also
with zero materialization failures and deterministic replay. For C2/C3,
the Lead-approved classification is:

```text
Task validity:      VALID
Shadow evidence:    SHADOW_EVIDENCE_CAVEATED
Comparative set:    USABLE_WITH_CAVEAT
```

The caveat records dirty-world / last-known-version semantics and the extra
C3 observer-entry granularity issue. It does not erase or silently clean the
historical observations.

For the two valid Wave A Run 2 pairs, the existing aggregate records internal
context estimates of `12,222` for Native and `4,316` for Shadow. These are
runtime estimator values under different context policies. They are not
provider token counts, prices, or demonstrated savings, and no such claim is
made here.

## 6. What can be concluded now

The evidence supports four bounded conclusions:

1. The progressive gate is operationally effective: it preserved C2/C3
   evidence, captured the C4 scope failure, and prevented C4 Shadow/C5/C6
   execution after the failed Native record.
2. In the three available pairs, Shadow completed the task gates but used
   more observed semantic/tool interactions and more wall-clock time than
   Native. This is descriptive evidence only.
3. The Shadow traces exercised last-known-version retention and mostly
   `REFERENCE` representations, but did not exercise removal or rehydration.
4. C4 shows that rule/scope adherence is an independent benchmark outcome;
   functional oracle success cannot substitute for the frozen writable-path
   contract.

These results do not establish a Native-vs-Shadow quality winner, token
reduction, cost reduction, generalization to the six-category corpus, or
readiness for Active context rewriting.

## 7. Statistical and experimental limitations

- There is one repetition per strategy and category.
- Only C1–C3 have a Native/Shadow pair; C4 has Native-only evidence.
- C1 is a bounded replacement canary on a different baseline from Wave A
  Run 2.
- C5 and C6 have no live records, so removal and rehydration metrics are not
  estimable.
- The sample is too small for variance estimates, confidence intervals,
  significance tests, or model-level generalization claims.
- The run's authorized execution accounting was 38 semantic calls, 74
  tool calls/results, and 84,236 ms across five records. The invalid C4
  record remains included in this budget accounting even though it is excluded
  from valid-only aggregation.

## 8. Frozen next decision

The interim analysis is complete as an evidence-only result. No evaluator
repair or retry is opened, and no new provider authorization follows from
this document.

```text
CR-005B:                    CLOSED
Wave A Run 1:               TERMINAL / PRESERVED
Wave A Run 2:               TERMINAL / PRESERVED
Shadow adjudication:        ACCEPTED
CR-005 Wave A:              COMPLETE_AS_STOPPED_EXPERIMENT
Run 3:                      NOT_AUTHORIZED
Wave B:                     NO_GO
CR-004:                     NO_GO
```

The next research choice, if reopened later, is a new explicitly scoped
experiment for the missing C5/C6 coverage. It must not be represented as a
continuation of Run 2, and it must receive a separate provider and cost
decision.

## 9. Evidence references

- `docs/verification/context-runtime-cr-005-replacement-canary-run-2.md`
- `docs/verification/context-runtime-cr-005-wave-a-run-2-c4-stop.md`
- `docs/verification/context-runtime-cr-005-wave-a-run-2-shadow-adjudication.md`
- `docs/verification/context-runtime-cr-005-wave-a-run-2-synthesis.md`
- `research/context-benchmarks/.live-output/replacement-canary/cr005-1786554086587.jsonl`
- `research/context-benchmarks/.live-output/wave-a/wave-a-1786613262589-0262811a-ad35-4b8d-b745-4cda69e7b619/records.jsonl`
