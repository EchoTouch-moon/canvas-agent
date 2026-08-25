# CSPV-B1 — lifecycle semantic input repair, Run 1

- **Status:** EXECUTED — PASS
- **Baseline:** `main@47cff1554bb9b0cc0e38763283c42a391ade06fb`
- **B0 evidence:** preserved as historical `POLICY_CAPABILITY_GAP`
- **B1 policy version:** `policy-v0-gate-b1-source-lifecycle-signals`
- **Provider calls:** `0`
- **Live Shadow:** `NO_GO`
- **CR-004 Active Rewrite:** `NO_GO`

## Scope

This run uses the frozen CSPV-B0 fixtures and the frozen B0 oracle without
changing either. The only new input is a provider-neutral adapter signal that
preserves lifecycle meaning before the request reaches `policy-v0`:

```text
frozen trace event
    → sourceLifecycleSignals
    → policy-v0
    → decision + reason code
```

The policy no longer infers `RULED_OUT`, `SUPERSEDED`,
`NEW_FAILURE_EVIDENCE`, `PHASE_IRRELEVANT` or `DETAIL_REQUIRED` from a generic
`excludedSourceKeys` value. Budget arbitration also removes provisional
same-subject decisions before emitting `REMOVE`, preserving `KEEP XOR REMOVE`.

## Frozen scenarios

| Scenario                           | Classification | Policy failures | Harness failures | Records |
| ---------------------------------- | -------------- | --------------: | ---------------: | ------: |
| S1 Distractor Elimination          | PASS           |               0 |                0 |       8 |
| S2 Wrong-path Recovery             | PASS           |               0 |                0 |       6 |
| S3 Mandatory under Budget Pressure | PASS           |               0 |                0 |       8 |
| S4 Superseded Evidence             | PASS           |               0 |                0 |       5 |
| S5 Unavailable Source              | PASS           |               0 |                0 |       4 |
| S6 Phase Shift                     | PASS           |               0 |                0 |       6 |
| Composite lifecycle chain          | PASS           |               0 |                0 |      46 |

Aggregate:

```text
classification:      PASS
REMOVE:              12
REHYDRATE:           3
replay mismatches:   0
provider calls:      0
```

The existing adversarial oracle suite remains unchanged and catches all five
frozen mutations. The B0 test remains green as a historical capability-gap
run, so this evidence does not rewrite or erase the original B0 result.

## Interpretation boundary

This is credential-free deterministic evidence that the policy can consume
explicit lifecycle semantics while preserving availability, SourceVersion,
provenance, replay and protection invariants. It does not authorize a live
Shadow canary, prove model-facing context changes, or establish task-quality,
token-cost or causal false-removal claims.

## Next gate

Gate B is now eligible for Lead adjudication as `PASS`. Gate A remains a
separate required adjudication because PROPOSAL-032 is still a research
proposal. CSPV-C0 requires a reviewed run contract, explicit provider-call
budget and a new authorization; it is not unlocked by this document alone.
