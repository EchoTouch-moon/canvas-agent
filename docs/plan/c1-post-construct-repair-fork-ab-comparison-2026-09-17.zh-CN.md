# C1 Post–Construct-Repair Fork Comparison — A vs B (Design-Only)

日期：2026-09-17（Asia/Shanghai）

| Field | Value |
|---|---|
| Predecessor | `C1_FEASIBILITY_CONSTRUCT_REPAIR_V1` |
| Predecessor status | `SYNTHETIC_VALIDATION_PASS` / `syntheticPhase=CLOSED` |
| Validation head | `96fe079fdf1dbe3ebdf5902751138702c8b96fcf` |
| Closeout head | `e8dac1555687466592f53b921b916e3def1b6155` |
| Closeout comment | `#143` / `5690678021` |
| Mode | **DESIGN-ONLY** — no Provider, no live, no historical rewrite |
| Decision status | `COMPARISON_OPEN` — choose one primary fork before drafting full study design |

## 0. Shared locks (both forks)

```text
Provider live                NOT AUTHORIZED
F1-40 live                   NO_GO
R0 / T0 / E1 live            HOLD
Historical F0/F1             IMMUTABLE
E0 rebind for this work      FORBIDDEN
Synthetic construct retune   NOT unless new evidence-integrity defect
```

What synthetic PASS already proved (do not re-claim):

```text
constructSeparability
deterministicAdjudication
historicalNonInterference
```

What it did **not** prove (do not smuggle in):

```text
Runtime effectiveness
real-task feasibility
budget frontier reopening
```

## 1. The two forks

### A — Native execution mechanism study design

**Scientific question (from Failure Anatomy M):**

> In regimes where Layer-1 semantic feasibility fails (esp. t2-like tasks), what
> **execution mechanisms** produce failure — and are any of them attributable to a
> **Runtime-actionable surface** rather than pure model/task limitation?

Anatomy residue this answers:

```text
M = PARTIAL_MECHANISM_CANDIDATES_IDENTIFIED
candidates (not yet study-grade):
  edit thrash, incorrect file targeting, insufficient convergence,
  premature completion, objective miss
```

**Primary estimand (design target):** mechanism attribution / typology under the
**repaired** Layer-1/2/3 reporting — not linkage-as-feasibility.

**Not the estimand:** rescue effect, R0 treatment effect, budget sensitivity.

### B — Prospective construct validation / R0 design-only

**Scientific question (from Failure Anatomy C → prospective use):**

> Given the repaired Layer-1/2/3 construct is synthetically separable, what is the
> **minimal prospective validation design** (new identity, new binding) that can
> stress the construct on real Native trajectories — and under what conditions
> would an **R0 Runtime rescue design** even become discussable?

Anatomy residue this answers:

```text
C = CONTRACT_REPAIR_CANDIDATE  →  now synthetically PASS
next: prospective application of the repaired construct
R0: still design-only; live only if mechanism maps to Runtime-actionable surface
```

**Primary estimand (design target):** prospective measurement integrity of the
repaired construct on Native (still may be design-only / zero-Provider harness
first); R0 remains a **conditional** side-branch, not the default deliverable.

**Not the estimand:** reopening F1 budget frontier; rewriting F1-32.

## 2. Side-by-side comparison

| Axis | A — Native mechanism study design | B — Prospective construct / R0 design-only |
|---|---|---|
| Core question | *Why* Layer-1 fails (mechanism) | *How* to apply repaired construct prospectively; when R0 is even eligible |
| Anatomy line | **M** | **C → prospective**; R0 only if M later maps to Runtime |
| Depends on synthetic PASS? | Yes (need clean Layer-1 vs L3 split to attribute) | Yes (construct must be frozen before prospective use) |
| Immediate live need? | **No** — design packet first | **No** — design packet first |
| Typical design cost | Medium–high: task panel, failure typology, coding rubric, anti-confounds vs linkage | Medium: prospective contract skeleton, binding/identity rules, gate mapping, R0 *eligibility* criteria |
| Evidence before any future live | Mechanism codebook + at least offline/annotated trajectory typology; optional zero-Provider mechanism probes | Full prospective contract + binding template + owner-auth scope; R0 needs A-like Runtime mapping first |
| Risk if chosen alone | May delay putting repaired construct into a prospective Native contract | May design R0 prematurely without Runtime-actionable mechanism |
| Risk if skipped | Future R0/live may still lack causal/mechanism story | Repaired construct stays “lab-only”; Native contracts keep old conflation risk |
| Feeds the other? | A **unblocks** honest R0 eligibility inside B | B **consumes** A when deciding whether R0 design is warranted |

## 3. Cost sketch (design-only phase)

### A — expected design deliverables

1. Mechanism study protocol (scope, non-claims, historical immutability).
2. Failure typology codebook aligned to Layer-1 FAIL cases (t2-first).
3. Explicit separation: mechanism codes ≠ Layer-3 linkage incompleteness.
4. Sampling plan from **immutable** F1-32 / related sealed evidence (read-only).
5. Decision rule: when a mechanism is “Runtime-actionable” vs model/task-bound.
6. Stop rule: what evidence is enough to *start* an R0 **design** (still not live).

**Cost drivers:** annotation rigor, inter-rater rules, avoiding post-hoc story fitting.

### B — expected design deliverables

1. Prospective Native feasibility contract outline using Layer-1/2/3.
2. New study identity / binding / surface policy (no reuse of consumed IDs).
3. Mapping table: old F0/F1 fields → new layers (illustrative only; no rewrite).
4. Zero-Provider or harness validation plan *for prospective contract* (if needed).
5. R0 design-only appendix: **eligibility gate** = Runtime-actionable mechanism from A.
6. Explicit NO_GO list: F1-40, Provider live, historical mutation.

**Cost drivers:** contract completeness, binding discipline, resisting “just run live.”

## 4. Evidence required before any future live (either fork)

Common bar:

```text
new contract text frozen
new binding / identity scheme frozen
owner authorization covering exact executable revision + budget
Provider live still separately authorized (not implied by design PASS)
historical F0/F1 untouched
```

Fork-specific bar:

| Before… | Need… |
|---|---|
| Any A-derived live mechanism experiment | A design PASS + authorization; usually still not first step |
| Prospective Native feasibility live (B path) | B contract/binding PASS + auth; prefer A at least design-complete if estimand mixes mechanism |
| R0 live | A shows Runtime-actionable surface **and** B/R0 design PASS **and** dedicated R0 auth |

## 5. Recommendation frame (not a live authorization)

**Default sequencing (design-only):**

```text
1) Keep synthetic construct frozen (no further retune)
2) Run a short A/B decision: primary fork for the next written design
3) Prefer A as the next *authoring* focus if the open scientific debt is M
   Prefer B as the next *authoring* focus if the open debt is “put repaired
   construct into a prospective Native contract skeleton”
4) Do not open R0 live design as a standalone primary without A’s Runtime mapping
```

**Practical split that preserves both lines:**

- **Primary:** choose A *or* B as the next full design doc.
- **Secondary note:** the other fork gets a 1-page dependency stub only.
- **R0:** remains an eligibility appendix under B, fed by A — never a live sneak path.

## 6. Decision checklist (fill when choosing)

- [ ] Primary fork selected: `A` / `B`
- [ ] Secondary stub only for the other fork
- [ ] Confirm no Provider / F1-40 / R0-T0-E1 live in the next authoring sprint
- [ ] Confirm synthetic corpus/adjudicator remain immutable unless integrity defect
- [ ] Name the next design doc path + owner review gate

## 7. One-line contrast

> **A asks why semantic failure happens; B asks how to measure feasibility going forward — and when (if ever) Runtime rescue is even a legitimate design object.**

Both are design-only. Neither reopens the budget frontier.
