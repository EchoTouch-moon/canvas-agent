# CR-004 M6 mechanism-screen evidence — 2026-08-30

## Decision

```text
M6 Run 1 (cr004-m6-20260830-a6f4c2d9): EXECUTED / EXCLUDED
  reason: manifest omitted the required randomized arm-order binding
  classification: HARNESS_CONTRACT_FAILURE (historical evidence preserved)

M6 Run 2 (cr004-m6-20260830-b7e91c4a): EVIDENCE-CLOSED / INCONCLUSIVE
  harness binding: PASS
  task evidence: usable with four objective-oracle failures
  mechanism judgment: insufficient for superiority or efficiency claims

CR-004 Active Rewrite authorization: NO_GO
Additional M6 retry: NOT AUTHORIZED by this evidence
Wave B: NO_GO
Provider: Step Plan / step-3.7-flash only; no fallback
```

This document records the two executions made under the frozen M6 contract.
It does not rewrite either run's leg facts, manifest binding, or oracle
results, and does not treat `status=EXECUTED` as an oracle-success result.
The offline analyzer may add `analysis.json` and refresh `evidence-root.json`;
those derived files do not alter the execution facts. Raw report directories
remain local and untracked under
`research/context-benchmarks/reports/cr004-matrix/`, following the existing
raw-evidence policy.

## Frozen binding

```text
Contract: docs/plan/cr004-m6-mechanism-screen-run-contract-2026-08-30.md
Contract SHA-256: 514d62bd7661f651e884155e4e8476d7a0b5004d8c4d45728ac31445d012aa07
Design: L1/L2/L3 x NATIVE/ACTIVE_V2/ACTIVE_V3/ACTIVE_V4 x 4 repetitions
Legs: 48 per run
Arm order: seeded randomized within each task x repetition block
Provider: step-plan / step-3.7-flash
Fallback: none; fallbackUsed=false
Provider config hash: dbcbff3eb4549710faaa018aab784dbb56c3082dae673931c50cb15d999eabc8
```

The M6 code baseline adds only the explicitly registered experimental
`ACTIVE_V4` arm and its evidence telemetry. It does not change `policy-v0`,
the default Active policy, frozen task fixtures, CR-005 fixtures, or product
behavior.

## Run 1 — preserved but excluded

```text
Run identity: cr004-m6-20260830-a6f4c2d9
Code commit: 60993f51c2276fa8233c9fecde5cf8509cecd315
Legs: 48/48
Provider-call records: 686
Tool calls: 1,137
Wall clock: 2,836,514 ms
Oracle: NATIVE 12/12, ACTIVE_V2 12/12, ACTIVE_V3 12/12, ACTIVE_V4 11/12
```

The runner actually used the required randomized block order and recorded a
seed and realized arm order for every leg. However, the first-run
`manifest.json` did not record `design.armOrder`, so offline provenance
analysis emitted:

```text
recorded design armOrder '(none)' violates series M6 required 'randomized'
```

This is a harness evidence-binding defect, not evidence that the V4 policy
failed. The run is retained as historical execution evidence but excluded
from the clean comparative set. Its evidence root after offline analysis was:

```text
legsRoot: d55f5b0d0fbcc311f0f88983e689aa2586a0ec0c8e3bb6d172a86c3f463869d7
analysisSha256: bec1bd55763e53713ab2568cd35b0fda604af0e6f67efe522b9f8b4af3290611
```

The manifest writer was then corrected to record both the resolved arm order
and the environment arm-order binding. No historical leg fact or manifest was
modified; the post-run analysis and evidence-root files are retained as
derived audit artifacts.

## Run 2 — valid binding, limited mechanism exposure

```text
Run identity: cr004-m6-20260830-b7e91c4a
Code commit: 7cc1e6049b287ec0275cada53a9f14f05b2d7048
Legs: 48/48
Provider-call records: 678
Tool calls: 1,126
Wall clock: 2,880,463 ms
Matrix budget: 1,400 records / 18,000,000 ms
Provenance warnings: 0
Evidence-root verification: MATCH
```

All legs completed and all four arms used the same strict provider binding.
The four objective-oracle failures were:

```text
L1 NATIVE rep2       primary oracle exitCode=1; regression/writable PASS
L3 NATIVE rep2       primary oracle exitCode=1; regression/writable PASS
L2 ACTIVE_V3 rep1    primary oracle exitCode=1; regression/writable PASS
L1 ACTIVE_V3 rep4    primary oracle exitCode=1; regression/writable PASS
```

For these legs, `status=COMPLETED`, replay mismatches were zero, and no
provider/runtime abort or harness contract failure was recorded. They remain
real task-oracle failures and are not relabeled as policy or harness failures.

The clean run's aggregate oracle counts were:

| Task | NATIVE | ACTIVE_V2 | ACTIVE_V3 | ACTIVE_V4 |
| --- | ---: | ---: | ---: | ---: |
| L1 | 3/4 | 4/4 | 3/4 | 4/4 |
| L2 | 4/4 | 4/4 | 3/4 | 4/4 |
| L3 | 3/4 | 4/4 | 4/4 | 4/4 |

The V4 arm therefore has 12/12 objective-oracle passes in this one run, but
the cell size is four and the paired task outcomes are not sufficient to
establish superiority, efficiency, causality, or CR-004 readiness.

## ACTIVE_V4 mechanism telemetry

Aggregate values below are descriptive observations from the clean run. Token
figures are internal context-estimator values, not provider-token or price
measurements.

| Task | V4 legs | Sends / attempts | Removed blocks | Batch deferrals | Re-reads of removed targets | Boundary drops |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| L1 | 4 | 2 / 2 | 6 | 4 | 0 | 0 / 2 |
| L2 | 4 | 1 / 1 | 2 | 1 | 0 | 0 / 1 |
| L3 | 4 | 0 / 0 | 0 | 0 | 0 | 0 / 0 |

Across 12 V4 legs, only three rewrites were sent and five edit boundaries
were held below the fixed two-candidate threshold. L3 supplied no V4 rewrite
exposure. Every Active cell in this run had zero observed boundary drops in
the internal trajectory measure. This means the run demonstrates that the
fixed threshold arm can execute safely and produce the intended telemetry;
it does not yet demonstrate that batching yields a net context reduction or
improves task behavior.

For context, the clean-run internal estimator means for
`observedTokenEstimateSum` were:

```text
NATIVE:     129,550
ACTIVE_V2:   95,036
ACTIVE_V3:  158,615
ACTIVE_V4:  119,155
```

These are run-local descriptive estimates with four repetitions per cell.
They must not be reported as token savings or cost savings.

## Research interpretation

The reliable conclusion is narrower than “V4 is better”:

1. The corrected runner can bind and replay the 48-leg M6 matrix without
   fallback, provenance warning, budget breach, or evidence-root mismatch.
2. The V4 threshold mechanism is observable and remains within the existing
   transactional Active safety path.
3. The live L-series workload does not expose V4 evenly: L3 produced no
   rewrite, and the total number of V4 sends is small.
4. Native and V3 each have two objective-oracle failures in the valid run;
   four repetitions here, together with the observed task/provider variance,
   do not support a causal explanation for that difference.
5. No claim is made that batching is efficient, that it reduces provider
   tokens, or that it is ready for CR-004 Active Rewrite.

## Next gate

The next research task should be a new, separately frozen mechanism-exposure
design rather than a retry of an individual M6 leg. It should increase the
probability of observing eligible stale-pair batches and explicitly measure
whether a sent rewrite produces a net working-set decrease, while preserving
Native controls and the existing replay/safety gates. Any new arm, task
fixture, threshold, or live provider execution requires a new contract and a
new run identity. Until that design is reviewed, M6 follow-up, Wave B, and
CR-004 remain `NO_GO`.

## Evidence roots

```text
Run 1: research/context-benchmarks/reports/cr004-matrix/cr004-m6-20260830-a6f4c2d9/
  codeCommit: 60993f51c2276fa8233c9fecde5cf8509cecd315
  provider records: 686
  provenance: warning; excluded

Run 2: research/context-benchmarks/reports/cr004-matrix/cr004-m6-20260830-b7e91c4a/
  codeCommit: 7cc1e6049b287ec0275cada53a9f14f05b2d7048
  legsRoot: 564deaad1c8880a0866908877cc3636e7a68ebf5671a75857b41ff42aeb0b340
  analysisSha256: 76c448696c1c863b0946386e337a60bcb3a9801b9b0e17264dfd80dac74c363c
  provider records: 678
  provenance: clean; evidence-root verification MATCH
```
