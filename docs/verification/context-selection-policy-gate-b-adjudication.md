# Context Selection Policy — Gate B adjudication

- **Decision:** `PASS`
- **Adjudication:** Lead review completed
- **Current integration baseline:** `main@ca2c49c9c7bec45a0a45d924e871e42b629bb004`
- **B1 execution evidence:** [`context-selection-policy-gate-b1-run-1.md`](./context-selection-policy-gate-b1-run-1.md)
- **Provider calls during B1:** `0`
- **Live Shadow:** `NO_GO`
- **CSPV-C0:** `NOT AUTHORIZED`
- **CR-004 Active Rewrite:** `NO_GO`

## Decision basis

CSPV-B1 was executed with the frozen CSPV-B0 fixtures and frozen B0 oracle.
The B1 change added provider-neutral lifecycle semantic inputs and preserved
the existing availability, SourceVersion, provenance, replay and protection
invariants.

All seven frozen scenarios passed:

```text
S1 Distractor Elimination          PASS
S2 Wrong-path Recovery             PASS
S3 Mandatory under Budget Pressure PASS
S4 Superseded Evidence             PASS
S5 Unavailable Source              PASS
S6 Phase Shift                     PASS
Composite lifecycle chain          PASS
```

The aggregate evidence is:

```text
REMOVE:              12
REHYDRATE:            3
replay mismatches:    0
policy failures:      0
harness failures:     0
provider calls:       0
```

Availability handling, exact SourceVersion selection, provenance retention,
replay determinism and mandatory/pinned protection invariants remained
preserved throughout the suite.

The composite chain contains a valid lifecycle relation:

```text
ADD → KEEP → REMOVE → later-needed evidence → REHYDRATE → KEEP
```

The adversarial suite remains unchanged and catches all five frozen mutation
classes. The deterministic suite therefore provides credible Gate B evidence
for the current policy revision.

## Historical boundary

CSPV-B0 remains historical evidence classified as `POLICY_CAPABILITY_GAP`.
This adjudication does not rewrite B0 as a pass. The result is explicitly:

```text
CSPV-B0  HISTORICAL / POLICY_CAPABILITY_GAP
CSPV-B1  EXECUTED / PASS
Gate B   PASS
```

## Remaining gates

Gate B PASS does not authorize a live experiment. Gate A remains pending
because [PROPOSAL-032](../architecture/decisions/PROPOSAL-032-context-eviction-rehydration-policy-experiment.md)
is still `PROPOSED` and retains open questions about false-removal horizon,
`READ_AFTER_REMOVE` evidence and phase-signal provenance.

Before CSPV-C0 can be authorized, Gate A must be adjudicated and a separate
C0 run contract must be reviewed. That contract must bind a new run identity,
use Step Plan only with no fallback, separate scenario-run and provider-call
budgets, and fail closed at every gate. No provider execution is authorized
by this document.
