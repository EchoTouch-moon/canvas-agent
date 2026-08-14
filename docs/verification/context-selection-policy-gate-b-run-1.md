# CSPV-B0 — Executable Deterministic Transition Suite Run 1

- **Status:** EXECUTED — `POLICY_CAPABILITY_GAP`
- **Baseline:** `main@428fa796fb605fd3bb6a7b9fb54487c77a517707`
- **Branch:** `codex/context-selection-gate-b-executable-suite`
- **Policy:** existing `policy-v0`, read-only during this run
- **Provider calls:** `0`
- **Pi / live Shadow integration:** not executed
- **CR-005 manifests and fixtures:** unchanged
- **CR-004 Active Rewrite:** `NO_GO`

This is the first credential-free executable run of the frozen Gate B suite.
The suite measures the current policy against the PROPOSAL-032 oracle. It does
not change the oracle to make the current implementation pass.

## Scope and implementation boundary

The implementation adds only synthetic test fixtures, a trace driver, a
machine-checkable oracle, replay checks, adversarial oracle mutation checks and
this evidence document. The following files remained read-only:

```text
packages/context-runtime/src/planning/policy-v0.ts
packages/context-runtime/src/planning/planning-request.ts
packages/pi-context-integration/**
CR-005 manifests and fixtures
```

Synthetic representations are created from the exact admitted
`SourceVersionId`; no provider, model message, repository fixture or live
adapter is involved.

## Run result

| Measure                                          |                      Result |
| ------------------------------------------------ | --------------------------: |
| Scenario traces                                  |       7 (S1–S6 + composite) |
| `REMOVE` decisions observed                      |                          12 |
| `REHYDRATE` decisions observed                   |                           3 |
| Replay mismatches                                |                           0 |
| Protected-source evictions                       |                           0 |
| Wrong `SourceVersion` rehydrates                 |                           0 |
| Lost rehydration provenance                      |                           0 |
| `UNAVAILABLE → SOURCE_ABSENT` misclassifications |                           0 |
| Oracle mutation checks                           | 5 / 5 caught the corruption |
| Provider calls                                   |                           0 |

The executable suite therefore produced both required lifecycle decisions and
deterministic replay evidence, but the overall Gate B result is not `PASS`:

```text
Gate B0: POLICY_CAPABILITY_GAP
```

## Scenario adjudication

| Scenario                  | Classification          | Main finding                                                                                                                                               |
| ------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1 Distractor Elimination | `POLICY_CAPABILITY_GAP` | The current policy emits `EXPLICIT_EXCLUDE`, not frozen `RULED_OUT`.                                                                                       |
| S2 Wrong-path Recovery    | `POLICY_CAPABILITY_GAP` | `REHYDRATE` is emitted with `EXPLICIT_EXCLUDE` provenance, not the frozen later-need reason.                                                               |
| S3 Mandatory under Budget | `POLICY_CAPABILITY_GAP` | The budget boundary records contradictory `KEEP` and `REMOVE` decisions for the same normal subject in one transition. Protected sources were not evicted. |
| S4 Superseded Evidence    | `POLICY_CAPABILITY_GAP` | The old source is removed and the new source is added, but the frozen `SUPERSEDED` / `NEW_FAILURE_EVIDENCE` reasons are not emitted.                       |
| S5 Unavailable Source     | `PASS`                  | Last-known evidence remains active and no `SOURCE_ABSENT` is inferred from `REVISION_MISMATCH`.                                                            |
| S6 Phase Shift            | `POLICY_CAPABILITY_GAP` | The lifecycle can be produced, but `PHASE_IRRELEVANT` and `DETAIL_REQUIRED` are not preserved as frozen reasons.                                           |
| Composite chain           | `POLICY_CAPABILITY_GAP` | `REMOVE → later-needed → REHYDRATE` is observable and replayable, but the same reason-code and budget-decision gaps remain.                                |

These are policy-capability findings under a trusted synthetic harness, not
harness-contract failures. The suite produced no provider or materialization
failure and did not modify policy code.

## Normalized evidence

Each decision is recorded with:

```text
sequence
universeRevision
previousWorkingSetId
event
decisionKind
sourceKey
sourceVersionId
representationId / representationKind
reasonCodes
originatingRemoveTransitionId
laterNeedEvidenceRef
fromWorkingSetHash / toWorkingSetHash
transitionId / transitionHash
```

Every observed `REHYDRATE` in the run links to a prior `REMOVE`, retains a
later-needed evidence reference and restores the exact synthetic admitted
version. The composite replay produced identical decision records and
transition hashes on both executions.

## Adversarial oracle checks

The oracle was deliberately mutated in five ways, and every mutation failed
as required:

```text
expected SourceVersion v3 → v2       MUST FAIL
REHYDRATE → ADD                      MUST FAIL
delete originating REMOVE reference  MUST FAIL
UNAVAILABLE → SOURCE_ABSENT          MUST FAIL
remove a protected source            MUST FAIL
```

## Decision and next gate

The result is a valid B0 experiment outcome. It does not authorize a policy
repair. Preserve this evidence and stop the B0 implementation run here:

```text
CSPV-B0: POLICY_CAPABILITY_GAP
CSPV-B1: NOT AUTHORIZED
CSPV-C0: NOT STARTED
Live Shadow: NO_GO
CR-004: NO_GO
```

If a later Lead decision opens CSPV-B1, it must use the same frozen traces and
oracle, change only the policy layer explicitly authorized for B1, and rerun
this suite without provider calls.
