# CSPV-C0-L1 Live Evidence Report — 2026-09-01

## 1. Executive verdict

**C0-L1 live evidence acquisition is complete for this phase.**

The evidence covers the frozen C0 lifecycle scenarios through real
Step Plan-backed Pi execution. It is distributed across three independent,
single-use live identities and therefore does **not** claim a same-run E1–E4
baseline.

| Gate | Decision |
| --- | --- |
| Provider usage seam | `PASS` |
| Node24 runtime compliance | `PASS` for controlled runs |
| E1 controlled evidence | `ACQUIRED` |
| E2 controlled evidence | `ACQUIRED` |
| E3 controlled evidence | `ACQUIRED` |
| E4 controlled evidence | `ACQUIRED` |
| Provider usage coverage | `COMPLETE` |
| Replay integrity | `PASS` |
| Evidence persistence | `PASS` |
| Lifecycle observability | `PASS` |
| Same-run E1–E4 baseline | `NOT CLAIMED` |
| Policy effectiveness | `NOT CLAIMED` |

All runs used code revision
`2c346f4054acef21a3feaaf3957eac03cbc9a44c`, provider `step-plan`, model
`step-3.7-flash`, and `fallbackUsed=false`. This report is evidence-only and
was prepared with zero additional provider calls.

## 2. Run ledger

| Run | Runtime | Scenarios | Provider calls | Assistant usage rows | Provider-reported total tokens | Status | Evidence role |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| `c0-20260901-a4d9e7c2` | Node `v23.11.0` | E1 | 6 | 6/6 | 22,940 | `EXECUTED` | Usage seam validation; **non-baseline** |
| `c0-20260901-7b3e9a11` | Node `v24.19.0` | E1 | 4 | 4/4 | 15,058 | `EXECUTED` | Controlled E1 evidence |
| `c0-20260901-b6f2c8d0` | Node `v24.19.0` | E2–E4 | 16 | 16/16 | 58,304 | `EXECUTED` | Controlled E2–E4 evidence |

The Node23 run is retained as valid usage-seam evidence but is excluded from
the controlled benchmark baseline. The Node24 version was printed before each
controlled run (`v24.19.0`). The current runner does not yet include a
`nodeVersion` manifest field; this report does not retroactively amend the
runner.

The raw metadata artifacts remain in the local report directories under
`research/context-benchmarks/reports/cspv-c0/<run-id>/` according to the
existing raw-evidence policy. This report intentionally does not copy prompts,
assistant responses, raw provider payloads, credentials, authorization
headers, or tool arguments/results.

## 3. Provider usage evidence

Every observed terminal assistant response in the controlled Node24 runs had
a corresponding metadata-only usage row:

| Run | Input tokens | Output tokens | Cache-read tokens | Cache-write tokens | Total tokens | Usage coverage | Monetary cost |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Node24 E1 | 1,448 | 554 | 13,056 | 0 | 15,058 | `4/4 = 100%` | `UNAVAILABLE` |
| Node24 E2–E4 | 4,246 | 1,642 | 52,416 | 0 | 58,304 | `16/16 = 100%` | `UNAVAILABLE` |

The values above are provider-reported usage preserved by the Pi
`message_end` seam. They are observed token volumes across separate
single-use identities, not a single-run baseline, cost estimate, or token
savings claim. Monetary cost remains explicitly `UNAVAILABLE` under
[`C0_USAGE_CONTRACT_V1`](../plan/cspv-c0-provider-usage-contract-2026-09-01.md).

The controlled E1 run recorded 4 observations and 9 tool results. The
controlled E2–E4 run recorded 16 observations and 20 tool results. Both runs
reported `c0L1Observability.verdict=PASS`, with no stop condition, runner
failure, or evidence-write failure.

## 4. Lifecycle evidence

| Scenario | Provider calls | Chain | REMOVE | REHYDRATE | False-removal candidates | Replay mismatches | Additional evidence |
| --- | ---: | --- | ---: | ---: | ---: | ---: | --- |
| E1 | 4 | `PASS` | 2 | 0 | 0 | 0 | Distractor elimination; 14/14 active-set changes explained |
| E2 | 5 | `PASS` | 2 | 2 | 2 | 0 | Exact SourceVersion rehydration; 20/20 provenance resolved |
| E3 | 6 | `PASS` | 2 | 2 | 2 | 0 | Exact SourceVersion rehydration; 28/28 provenance resolved |
| E4 | 5 | `PASS` | 2 | 0 | 0 | 0 | Superseded evidence observed; 20/20 provenance resolved |

The E2 and E3 candidates are auditable `HIGH_PRIORITY` signals produced by a
later need after REMOVE. They are **not** treated as confirmed false removal:
the distinction between `rehydrate-demand`, `false-removal-candidate`, and
`confirmed-false-removal` remains in force.

Across the controlled runs:

- no mandatory or pinned eviction occurred;
- no orphan or wrong-version rehydration occurred;
- no unexplained decision or unexplained materialization failure was recorded;
- every transition replayed with zero mismatch;
- every requested scenario chain passed.

The live runs demonstrate that lifecycle transitions previously exercised only
through deterministic/synthetic execution also occur during real
provider-backed model interaction. The frozen C0 lifecycle events are still
queued through the sanctioned deterministic adapter seam; the provider-backed
Pi messages are real. This is lifecycle observability evidence, not evidence
that the model independently discovered or caused every lifecycle event.

## 5. Evidence quality and limitations

- E1–E4 are distributed across multiple single-use identities. No same-run
  E1–E4 baseline is claimed.
- The Node23 E1 run is retained only for usage-seam validation and is not
  eligible for controlled Node24 comparisons.
- The Node24 runs use repetition `1`; no statistical repeatability, confidence
  interval, or model generalization claim is made.
- No Native comparison exists in this evidence packet.
- Monetary provider cost was unavailable. No price, cost-saving, or token-
  reduction claim is made.
- Wall-clock, tool trajectory, and token volumes are descriptive observations;
  they are not comparative effectiveness results.
- `evaluator.overall=FAIL` appears in the supplementary scenario summaries when
  scenario-specific criteria are `NOT_OBSERVED`. This is distinct from the
  passing composite scenario chain and the passing C0-L1 usage/evidence
  observability verdict; it is not treated as an infrastructure failure.
- `c0L1Observability=PASS` is a usage-observability sub-verdict. It is not by
  itself a claim of policy effectiveness, task improvement, or causal benefit.

## 6. Gate decision and next phase

```text
C0-L1 LIVE EVIDENCE ACQUISITION: COMPLETE

Usage seam:                 PASS
Node24 controlled evidence: ACQUIRED
E1–E4 live coverage:        ACQUIRED across separate identities
C0-L1 repetition:           NOT REQUIRED
New C0-L1 provider calls:   STOPPED FOR THIS PHASE

Same-run baseline:          NOT CLAIMED
Policy effectiveness:       NOT CLAIMED
Native comparison:          NOT AVAILABLE
CR-004:                     NO_GO
```

The next experimental gate is a zero-provider **comparative/effectiveness
design** comparing unmanaged/native context with Context Runtime lifecycle
policy. It should define task outcome, provider usage, tool interaction,
latency, context churn, removal precision, rehydration recovery, and cold
context penalty before any further live authorization.

The C0 contracts remain frozen:

- [`CSPV-C0 run contract`](../plan/cspv-c0-run-contract-2026-08-27.md)
- [`C0-L1 provider usage contract`](../plan/cspv-c0-provider-usage-contract-2026-09-01.md)

No C0-L1 repetition, Wave A/Wave B execution, or CR-004 Active Rewrite is
authorized by this evidence synthesis.
