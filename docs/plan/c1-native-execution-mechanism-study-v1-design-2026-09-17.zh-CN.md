# C1 Native Execution Mechanism Study v1 — Design Contract

日期：2026-09-17（Asia/Shanghai）

| Field | Value |
|---|---|
| Contract ID | `C1_NATIVE_EXECUTION_MECHANISM_STUDY_V1` |
| Status | `DESIGN_ONLY` |
| Execution mode | `NO_PROVIDER` |
| Live execution | `FORBIDDEN` |
| Historical input | `READ_ONLY` |
| Historical verdict | `IMMUTABLE` |
| Primary question | `MECHANISM_ATTRIBUTION` |
| Fork role | **PRIMARY** after `C1_FEASIBILITY_CONSTRUCT_REPAIR_V1` synthetic closeout |
| Companion stub | `docs/plan/c1-prospective-construct-r0-stub-2026-09-17.zh-CN.md`（B only） |
| Predecessor construct | `C1_FEASIBILITY_CONSTRUCT_REPAIR_V1` = `SYNTHETIC_VALIDATION_PASS` |
| Predecessor anatomy | `docs/verification/cspv-c1-f1-32-failure-anatomy-v1-2026-09-15.zh-CN.md`（M = PARTIAL） |
| Machine index | `docs/plan/c1-native-execution-mechanism-study-v1-design-2026-09-17.json` |

## 0. Why A is primary now

Synthetic construct repair has closed the **C** debt at zero-Provider level:

```text
linkage / observability defect  ≠  execution infeasibility
```

The blocking unknown for any honest Runtime line is now **M**:

```text
semantic failure (Layer-1 FAIL)
        ↓
failure mechanism
        ↓
model/task-bound ?
tool/runtime-bound ?
context-runtime-actionable ?
        ↓
only the last class may enter R0 design eligibility
```

```text
A unblocks R0 eligibility
B consumes A
R0 must not be designed before Runtime-actionable mapping exists
```

## 1. Locks (non-negotiable)

```text
Provider live                 NOT AUTHORIZED
F1-40 live                    NO_GO
R0 / T0 / E1 live             HOLD
Historical F0/F1 verdicts     IMMUTABLE
Historical live-output/.audit READ_ONLY (if used)
E0 rebind for this study      FORBIDDEN
Synthetic construct retune    NOT unless integrity defect
Estimand is NOT               Runtime rescue / treatment effect
```

## 2. Estimand

**Primary estimand:** mechanism distribution and attribution among runs (and supporting trajectory events) that are **Layer-1 semantic feasibility FAIL** under the repaired construct.

**In scope:**

- What mechanisms co-occur with Layer-1 FAIL?
- Can mechanisms be attributed with predeclared rules (not narrative fit)?
- Which attributed mechanisms, if any, meet `RUNTIME_ACTIONABLE`?

**Out of scope (explicit non-claims for this design phase):**

```text
Runtime can rescue the run
R0 treatment effect
budget frontier should reopen
historical F1-32 should have passed
```

## 3. Unit of analysis

Two mandatory levels (a run is never forced into a single event label):

### 3.1 Run-level primary mechanism

```text
unit = one sealed run identity
output = primaryMechanismCode
         + secondaryMechanismCodes[]
         + confidence
         + RUNTIME_ACTIONABLE boolean (run-level aggregate rule)
```

Rules:

- Exactly one `primaryMechanismCode` **or** `MULTI_MECHANISM` / `UNKNOWN`.
- Secondaries allowed; must not silently overwrite primary.
- If evidence insufficient → `UNKNOWN` (fail-closed), not forced seed codes.

### 3.2 Trajectory event-level mechanism evidence

```text
unit = ordered trajectory event / span (tool call, edit cluster, probe burst, …)
output = eventMechanismCode
         + evidencePointers (immutable paths/offsets only)
         + supportsRunPrimary? boolean
```

Event codes **inform** run-level attribution; they do not automatically equal the run primary.

## 4. Mechanism codebook (seed — not yet study-grade)

Seed candidates from Failure Anatomy v1（**candidates only**）:

| Code | Working meaning (design draft) |
|---|---|
| `EDIT_THRASH` | Repeated low-yield edits / churn without semantic progress |
| `INCORRECT_FILE_TARGETING` | Edits or probes outside the required writable/semantic target |
| `INSUFFICIENT_CONVERGENCE` | Partial progress that never reaches oracle-satisfying state |
| `PREMATURE_COMPLETION` | Terminal/complete signaled while objective still unmet |
| `OBJECTIVE_MISS` | Pure task/oracle miss without dominant process pathology above |

**Mandatory open codes (must exist in any freeze of the codebook):**

| Code | Rule |
|---|---|
| `OTHER` | Fits none of the seeds; requires free-text rationale field |
| `UNKNOWN` | Evidence insufficient under adjudication rules |
| `MULTI_MECHANISM` | ≥2 seeds compete; primary cannot be singled out without violating rules |

**Boundary retained from A/B comparison:**

> Current seeds are **not yet study-grade**. Promoting a seed to study-grade requires frozen coding rules + adjudication PASS on a declared calibration set — not story fit to F1-32 anecdotes.

Codebook freeze is a **design review gate**, not automatic from this document’s existence.

## 5. Confounder / factor separation (required axes)

Every run-level record must separately mark these axes (may be `PRESENT` / `ABSENT` / `UNKNOWN`):

| Axis | Question |
|---|---|
| `MODEL_LIMITATION` | Failure plausible from model competence alone? |
| `TASK_AMBIGUITY` | Spec/oracle/target underspecified? |
| `TOOL_FAILURE` | Tool error observed (distinct from Layer-3 linkage completeness)? |
| `BUDGET_EXPOSURE` | Budget exhaustion or hard call-cap binding? |
| `CONTEXT_STATE_FAILURE` | Failure tied to missing/wrong/stale context state that was (or could be) runtime-visible? |

**Hard rule:** Layer-3 linkage incompleteness alone must **not** be coded as a Layer-1 failure mechanism. Use repaired construct layers; do not re-conflate C.

## 6. Runtime-actionability rule (critical product)

A mechanism (run- or event-level, then lifted to run aggregate) is `RUNTIME_ACTIONABLE` **iff all four** hold:

```text
RUNTIME_ACTIONABLE :=
  (1) mechanism has an observable runtime state
  AND (2) Runtime can intervene on that state
  AND (3) intervention occurs before semantic failure becomes irreversible
  AND (4) mechanism attribution does not depend on ground truth
          unavailable at runtime
```

四条缺一 → **not** Runtime-actionable.

### 6.1 Forbidden soft leap

```text
model cannot complete the refactor
  → “context should help”
  → Runtime-actionable
```

**Rejected.** Must name:

```text
which runtime-observable state
which intervention
which decision point (pre-irreversibility)
which attribution evidence is available without post-hoc ground truth
```

### 6.2 Recording requirement

If claiming `RUNTIME_ACTIONABLE=true`, the record must include:

```text
observableStateId
interventionId
decisionPointId
attributionEvidenceClass ∈ {RUNTIME_VISIBLE, SEALED_OFFLINE_ONLY, …}
```

If `attributionEvidenceClass = SEALED_OFFLINE_ONLY` → clause (4) fails → cannot be Runtime-actionable for R0 eligibility.

## 7. Evidence policy

```text
Allowed:
  read-only sealed F1-32 / related historical trajectories
  offline coding / typology design on immutable artifacts
  zero-Provider synthetic probes that do not mutate history

Forbidden:
  rewrite pointLabel / gate vectors / audit packages
  reuse consumed study identities for new live claims
  Provider calls under this design contract
  treating Anatomy narrative as finished attribution
```

Any path touching `.live-output` / `.audit` is **read-only** and must not be imported into construct-repair allowlisted loaders as writable corpora.

## 8. Adjudication / disagreement

Minimum bar for design freeze of coding rules:

1. **Dual coding** on a declared calibration subset **or**
2. A **deterministic referee rule** that resolves disagreements without author narrative.

Suggested referee order (design draft; freeze at review):

```text
1) UNKNOWN if either coder marks insufficient evidence
2) MULTI_MECHANISM if primaries differ and both are seed codes
3) else apply frozen priority table (to be filled at codebook freeze)
4) never break ties by “what would make R0 interesting”
```

Disagreement rate and unresolved `UNKNOWN`/`MULTI_MECHANISM` rates are **first-class outputs**, not nuisances to eliminate.

## 9. Promotion gate (A PASS → what?)

```text
A design PASS
  → unlocks: R0 DESIGN ELIGIBILITY REVIEW only

A design PASS
  ≠ R0 live
  ≠ Provider live
  ≠ F1-40
  ≠ automatic B full prospective contract authorization
```

**R0_DESIGN_ELIGIBLE** only if:

```text
A identifies ≥1 study-grade mechanism
that is RUNTIME_ACTIONABLE under the frozen four-clause rule
on a declared evidence set
with adjudication rules satisfied
```

Otherwise R0 remains `BLOCKED_PENDING_A`.

## 10. Design-phase deliverables (completion definition)

This design phase completes when review accepts:

1. This contract + machine index JSON committed.
2. Codebook freeze candidate (seeds + OTHER/UNKNOWN/MULTI + coding guide).
3. Run-level + event-level schemas.
4. Frozen `RUNTIME_ACTIONABLE` four-clause checklist form.
5. Confounder axis schema.
6. Adjudication protocol (dual-code or deterministic referee).
7. Explicit non-claims + route locks restated.
8. B stub remains stub (no sample/budget/Provider/R0 treatment inflation).

**Not required now:** live runner, Provider auth, R0 treatment design, prospective Native sample size.

## 11. Route after A design review

```text
Synthetic Construct Repair     CLOSED ✅
        ↓
A — Native Mechanism Study Design   ← PRIMARY (this doc)
        ↓
codebook + attribution + Runtime-actionability + promotion gate
        ↓
A design review
        ↓
only then:
  B prospective contract refinement (still design-only)
  + conditional R0 eligibility (if RUNTIME_ACTIONABLE ≥1 study-grade)
```

## 12. One-line stance

> **A measures why Layer-1 fails and whether any failure mechanism is honestly Runtime-actionable — it does not invent a rescue story.**
