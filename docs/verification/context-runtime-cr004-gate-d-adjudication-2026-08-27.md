# Context Runtime CR-004 — Gate D adjudication

- **Decision:** `PASS` — CR-004 readiness established; CR-004 moves to offline Stage 0 preparation
- **Adjudication:** Lead review completed 2026-08-27
- **Current integration baseline:** `branch glm/project-review-2026-08-27 @ 67ef9e58984a0c12a300c06d89b0517a84bd63a2`
- **Primary evidence:** [CSPV-C0 canary live runs 1–3](./cspv-c0-canary-runs-2026-08-27.md) (51 provider-call records, three single-use identities, strict Step Plan binding, `fallbackUsed=false`)
- **Contract:** [C0 run contract](../plan/cspv-c0-run-contract-2026-08-27.md) with pre-execution Amendments 1–2
- **Prior gates:** [Gate A](./context-selection-policy-gate-a-adjudication-2026-08-27.md) `PASS`, [Gate B](./context-selection-policy-gate-b-adjudication.md) `PASS`
- **Provider calls consumed by this review:** `0`
- **CR-004:** `NO_GO` → `STAGE_0_PREPARATION_ALLOWED` (this is not an Active authorization)
- **CSPV-C0:** `COMPLETE` (all four scenarios live `PASS`)

## Decision basis

Gate D asks whether the Phase 2 evidence demonstrates the eight readiness
criteria (rebaseline:199-217). The C0 canary evidenced seven of them on live
model-call traces through the unmodified deterministic policy; the eighth is
structurally unobservable in Shadow mode and is carried forward into the
CR-004 Stage 0/1 requirements instead of being waived.

| # | Criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | REMOVE observed in representative traces | `PASS` | REMOVE in every scenario: E1 (runs 1–2), E2 (runs 1–2), E3 (runs 2–3), E4 (run 3) |
| 2 | REHYDRATE observed after prior REMOVE | `PASS` | 6 qualifying pairs, 0 orphans: E2 (runs 1–2), E3 (run 3) |
| 3 | false-removal candidates measurable and auditable | `PASS` | 6 candidates, both horizon axes recorded; classification exercised at distance 1/1 and exactly at the contract boundary 3/3, all `HIGH_PRIORITY` |
| 4 | mandatory/pinned eviction = 0 | `PASS` | 0 across every boundary of every run |
| 5 | exact SourceVersion rehydration | `PASS` | `wrongVersionRehydrates = 0`; every REHYDRATE re-admitted the exact REMOVEd version |
| 6 | deterministic replay | `PASS` | `replayMismatches = 0` (re-plan of identical boundary inputs, logical-hash comparison) |
| 7 | no unexplained materialization failure | `NOT_OBSERVED-IN-SHADOW` (carried forward) | SHADOW mode never materializes (`policy-v0.ts` plans in `mode: 'SHADOW'`; materialization exists only in the Active admission path). Zero events, zero failures. Becomes a mandatory Stage 1 fail-closed stop condition. |
| 8 | reason-code coverage = 100% for active-set changes | `PASS` | coverage `1` in every scenario; 0 unexplained decisions; provenance `1` |

Representativeness caveat, recorded honestly: the live traces are the
contract's lifecycle corpus — scenario-shaped sessions designed to exercise
REMOVE/REHYDRATE phenomena (rebaseline Gate C definition), not arbitrary
organic coding sessions. Broader representativeness belongs to the Stage 1
canary design and must not be claimed from this evidence.

## What this adjudication permits

CR-004 Stage 0 — the offline safety seam, credential-free, zero rewritten
provider requests:

- Pi-only Active capability profile; every other harness stays out of scope.
- Native context remains the default; Active mode requires an explicit
  per-Run experimental opt-in.
- Mandatory/pinned items are re-asserted before any rewrite is composed.
- The composed rewrite binds its Working Set and Transition hashes.
- Continuity checks for tool-call/result pairs, the system instruction, and
  reasoning/opaque items.
- Any unsupported or inconsistent item triggers a pre-send fallback to the
  Native context — fail closed, never a partial rewrite.
- Kill-switch behavior verified by tests.
- No rewritten provider request is sent at any point in Stage 0.

Stage 0 requires its own bounded implementation and verification review
before anything else.

## What this adjudication does not permit

- No Active provider rewrite. CR-004 Stage 1 (the first Active canary)
  requires a separate Lead authorization with its own run contract, fresh run
  identity, budgets and fail-closed stop policy — including the carried-forward
  materialization stop condition.
- No quality, provider-cost or model-efficiency claim. Shadow is
  observational-only; the value hypothesis remains `NOT_ESTABLISHED`.
- Experiment-plan milestone item 5 remains open along the revived line; it can
  close only via a Stage 1 Active canary result or a new explicit waiver.
- This document does not amend the experiment plan, the rebaseline or any
  frozen run record.
