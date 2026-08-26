# Context Runtime v0.3 — Final Synthesis

- **Decision:** `CLOSE AS STOPPED EXPERIMENT`
- **Synthesis date:** 2026-08-27
- **Integration baseline:** `branch glm/project-review-2026-08-27 @ 8b7d1c6b31ae6bb174afb2567dca4c5c603b6034`
- **Provider calls consumed by this synthesis:** `0`
- **Gate A adjudication:** [`context-selection-policy-gate-a-adjudication-2026-08-27.md`](./context-selection-policy-gate-a-adjudication-2026-08-27.md) — `PASS`
- **Gate B adjudication:** [`context-selection-policy-gate-b-adjudication.md`](./context-selection-policy-gate-b-adjudication.md) — `PASS`
- **Closure decisions:** [`context-runtime-v0.3-closure-decisions-2026-08-27.md`](./context-runtime-v0.3-closure-decisions-2026-08-27.md)

This document closes the Context Runtime v0.3 research program. It audits the
v0.3 milestone gate and the twelve direction questions against the verified
evidence chain, states what was and was not established, and records the v0.4
recommendation. Per the closure decisions record: Gate A `PASS`; CSPV-C0
`DEFERRED`; CR-012B `DEFERRED`; CR-013 `CANCELLED / FOLDED`; gate item 5
`WAIVED`.

Core conclusion:

```text
Infrastructure feasibility   PROVEN
Value hypothesis             NOT ESTABLISHED
Working Set Runtime -> v0.4 product path   NO_GO
```

The value hypothesis — that an external working-set runtime maintains or
improves coding-task reliability versus monotonic context growth plus
compaction — was never tested with model-facing evidence. The program stopped
before any Active rewrite. What remains is deterministic and offline evidence
of capability, plus two valid observational Native/Shadow pairs.

---

## 1. Milestone gate ledger

Source: [experiment plan §8](../plan/context-runtime-v0.3-experiment-plan.md),
items 1–11 at `docs/plan/context-runtime-v0.3-experiment-plan.md:699-709`.
Transcribed abbreviated; verdicts are this synthesis's own.

| # | Gate item (§8) | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | model-call-level observation from at least one open Agent harness | SATISFIED | CR-010: Pi `before_provider_request` capture of the actual openai-completions payload, G1–G4 PASS, P1–P8 PASS, `providerCalls = 0` (`context-runtime-cr-010-model-visible-request-parity.md:137-199`). CR-011: one real DeepSeek request, `providerCalls = 1`, `parity = PASS`, intended and observed hashes identical (`context-runtime-cr-011-real-provider-parity-smoke.md:83-98`). Historical antecedent: CR-001 Pi context shadow observation (`context-runtime-cr-001-pi-shadow.md:3`). |
| 2 | a repeatable Native benchmark | PARTIAL | Infrastructure frozen and repeatable: Wave A defined as exactly 10 records C2–C6 × {NATIVE, SHADOW} with fingerprinted fixtures and fail-closed gates, credential-free validator PASS C1–C6 (`context-runtime-cr-005-wave-a-execution-gate.md:20-21,107`). Execution stopped: Run 1 STOPPED at its first record (C2 Native `INVALID`, 1 record, 0 pairs — `context-runtime-cr-005-wave-a-run-1-c2-stop.md:22-34`); Run 2 STOPPED at C4 Native with 5 durable records of at most 10 and 2 valid pairs (`context-runtime-cr-005-wave-a-run-2-synthesis.md:9-17,30-37`). CR-005 closed `COMPLETE_AS_STOPPED_EXPERIMENT` (`context-runtime-v0.3-research-rebaseline-2026-08-13.md:26-28,63`). |
| 3 | Source Reconciliation and Universe revisions sufficient for replay | SATISFIED | CR-009: full provider-neutral loop `UniverseRevision → ProposedWorkingSet → AdmissionReceipt → CommittedWorkingSet → WorkingSetTransition → replay` verified; ADD/KEEP/REMOVE/REPLACE replay pass; serialization and content-addressed forged-ID rejection pass; `provider calls = 0` (`context-runtime-cr-009-core-state-machine-2026-08-14.zh-CN.md:11-39`). Saved live Shadow traces also replayed deterministically (`context-runtime-cr-005-wave-a-run-2-synthesis.md:110-111`). |
| 4 | a deterministic Shadow Working Set policy | SATISFIED | Gate B adjudication `PASS` on `policy-v0-gate-b1-source-lifecycle-signals`; all seven frozen scenarios PASS; adversarial oracle catches all five frozen mutation classes (`context-selection-policy-gate-b-adjudication.md:3,19-29,52-54`; `context-selection-policy-gate-b1-run-1.md:3-6,31-53`). |
| 5 | at least one real Dynamic rewrite experiment | WAIVED | CR-004 was never executed: `NOT EXECUTED / NO_GO` at rebaseline (`context-runtime-v0.3-research-rebaseline-2026-08-13.md:29-31,71`); `CR-004 Active Rewrite: NO_GO` in the Gate B adjudication (`context-selection-policy-gate-b-adjudication.md:10`); waived for closure per the closure decisions record. |
| 6 | ContextDecision / ContextTransition evidence for every rewrite | PARTIAL (deterministic-only) | CSPV-B1 deterministic suite: `REMOVE: 12`, `REHYDRATE: 3`, `replay mismatches: 0` across seven scenarios including the composite ADD → KEEP → REMOVE → REHYDRATE chain (`context-selection-policy-gate-b1-run-1.md:43-49`; `context-selection-policy-gate-b-adjudication.md:34-40,46-50`). CR-009 verifies same-version `REPLACE` transitions with replay (`context-runtime-cr-009-core-state-machine-2026-08-14.zh-CN.md:36`). No live rewrite evidence exists because no real rewrite ever ran (item 5 waived). |
| 7 | measured quality and context-efficiency results | NOT ESTABLISHED | Rebaseline: Phase 1 results "are not evidence that Dynamic context selection improves task quality, provider cost, or model efficiency" (`context-runtime-v0.3-research-rebaseline-2026-08-13.md:107-109`). Run 2 synthesis: no token or cost-saving claim; one repetition per strategy/category; no confidence interval or significance test warranted (`context-runtime-cr-005-wave-a-run-2-synthesis.md:136-143`). |
| 8 | cross-model evidence from at least two model families, or a documented reason | SATISFIED-BY-DOCUMENTED-REASON | Two-provider layer merged as infrastructure: `step-plan` / `step-3.7-flash` primary with `deepseek` fallback (`docs/architecture/model-provider-layer.md:13-22`). No cross-model run occurred: all live model evidence is `deepseek/deepseek-v4-flash` (`context-runtime-cr-005-wave-a-run-1-c2-stop.md:5`; `context-runtime-cr-011-real-provider-parity-smoke.md:89-92`); provider execution is `NO_GO` and Step Plan remains `CANDIDATE` with 0 calls (`context-runtime-v0.3-research-rebaseline-2026-08-13.md:225,283-287`; `docs/architecture/model-provider-layer.md:114-115`). The documented reason: the program stopped before any second-family execution was authorized. |
| 9 | a second-harness portability result or a documented abstraction failure | PARTIAL (offline-proven) | CR-012A: the same frozen `CommittedWorkingSet` is consumed by the Pi integration and by a Codex CLI bridge through a shared canonical layer with `Core Contract changes: NONE`; G1–G4 PASS; P1–P8 PASS with `providerCalls = 0`, `networkCalls = 0`, `codexExecCalls = 1` (`context-runtime-cr-012a-codex-context-conformance.md:8-27,88-119,165-171`). Boundary is explicit: a fake Codex executable capturing real stdin after the OS process boundary; no real Codex turn was executed (`context-runtime-cr-012a-codex-context-conformance.md:74-81,173-176`). Real-harness execution (CR-012B) is `DEFERRED`. Offline conformance is proven; live portability is not. |
| 10 | a decision on Codex / closed-Agent compatibility next | SATISFIED | Decision recorded: offline conformant (CR-012A `PASS / COMPLETE for the fake-Codex conformance boundary`, `context-runtime-cr-012a-codex-context-conformance.md:3`), live execution deferred with CR-012B listed as deferred work (`context-runtime-cr-012a-codex-context-conformance.md:188-193`) and `DEFERRED` in the closure decisions record. |
| 11 | a decision on remain-in-Canvas-Agent vs begin extraction | DECIDED-HERE | This synthesis records the Lead decision: retain `packages/context-runtime`, `packages/repository-observer` and `packages/pi-context-integration` (with the `context-conformance` and `codex-context-integration` research packages) as research assets behind the research boundary; do not extract into an independently consumable package or service now. Rationale: mechanics of reuse are proven (items 1, 3, 9) but the value that would justify extraction is not (item 7). |

Gate summary: 5 SATISFIED (1, 3, 4, 10, plus 11 decided here), 1
SATISFIED-BY-DOCUMENTED-REASON (8), 3 PARTIAL (2, 6, 9), 1 NOT ESTABLISHED (7),
1 WAIVED (5). The §8 success conjunction is not met.

---

## 2. Direction questions ledger

Source: [direction doc §17](../architecture/context-runtime-v0.3-direction.md),
questions 1–12 at `docs/architecture/context-runtime-v0.3-direction.md:969-980`.
Transcribed abbreviated; answers are this synthesis's own.

| # | Question (abbreviated) | Verdict | Answer and evidence |
| --- | --- | --- | --- |
| 1 | Does non-monotonic Working Set management improve or preserve coding-task success vs native growth / compaction? | NOT ESTABLISHED | No model-facing experiment ran. CR-005 Shadow was observational-only with identity-equal model messages, so Native/Shadow differences are descriptive, not causal (`context-runtime-v0.3-research-rebaseline-2026-08-13.md:123-127`); Phase 1 results are not quality/cost/efficiency evidence (`:107-109`). |
| 2 | How much active context can be removed without increasing failure or repeated retrieval? | NOT ESTABLISHED | Live traces contain no REMOVE, read-after-remove or search-after-remove evidence; C5/C6 were never executed (`context-runtime-v0.3-research-rebaseline-2026-08-13.md:113-121`; `:69`). The deterministic suite proves REMOVE mechanics, not safe-removal magnitude (`context-selection-policy-gate-b1-run-1.md:56-61`). |
| 3 | Which context categories become stale most often? | NOT ESTABLISHED | Accepted Shadow telemetry holds only `ADD` (70) and `KEEP` (280) decisions — no lifecycle or staleness distribution exists (`context-runtime-cr-005-wave-a-run-2-synthesis.md:115-120`). |
| 4 | Which items are frequently removed and later rehydrated? | NOT ESTABLISHED | REHYDRATE was observed only in hand-authored deterministic traces (12 REMOVE / 3 REHYDRATE, `context-selection-policy-gate-b1-run-1.md:43-49`); zero such events occurred on live traces, so real-world frequency is unknown. |
| 5 | Can a deterministic policy make useful decisions at model-call granularity? | PARTIALLY ESTABLISHED | CSPV-B1 proves auditable KEEP/REMOVE/REHYDRATE decisions with reason codes, provenance, replay and protection invariants at trace granularity, provider-free (`context-selection-policy-gate-b1-run-1.md:13-53`). "Useful" for the agent is unproven: the suite explicitly does not establish task-quality, token-cost or causal false-removal claims (`:56-61`). |
| 6 | Does dynamic context reduce repeated file reads or tool calls? | NOT ESTABLISHED | Shadow never replaced the model's actual input, so call-count deltas cannot answer this (`context-runtime-v0.3-research-rebaseline-2026-08-13.md:123-127`); no Active run exists (CR-004 `NO_GO`, `:71`). |
| 7 | Does the result generalize from DeepSeek to at least one other model family? | NOT ESTABLISHED | All live evidence used `deepseek/deepseek-v4-flash`; the Step Plan provider layer was merged but never executed and remains `CANDIDATE` with 0 calls (`docs/architecture/model-provider-layer.md:13-22`; `context-runtime-v0.3-research-rebaseline-2026-08-13.md:283-287`). |
| 8 | Does the provider-neutral Runtime interface survive a second Agent integration such as OpenCode? | PARTIALLY ESTABLISHED | The frozen contract survived a second harness offline: CR-012A consumed the same `CommittedWorkingSet` through Pi and a Codex bridge with zero core-contract changes (`context-runtime-cr-012a-codex-context-conformance.md:8-27,165-171`). The boundary was a fake Codex executable; no real second-harness turn ran, and the OpenCode integration itself was never attempted (`:173-176,188-193`). |
| 9 | Does a mature native context manager reduce or eliminate Canvas Runtime gains? | NOT ESTABLISHED | There are no measured Canvas Runtime gains to compare against (gate item 7; `context-runtime-v0.3-research-rebaseline-2026-08-13.md:107-109`), and no comparison run against a mature native context manager was performed. |
| 10 | Can the same Runtime later integrate with Codex through a less direct Context Boundary? | PARTIALLY ESTABLISHED | Feasibility proven offline through `ExecutionContextBundleV2 → buildPrompt → runLocalCli stdin` with parity PASS on both paths (`context-runtime-cr-012a-codex-context-conformance.md:60-94`). A real authenticated Codex turn is deferred (CR-012B `DEFERRED`, `:188-193`). |
| 11 | Which ContextTransition explanations are useful to a developer rather than noise? | NOT ESTABLISHED | Reason codes and transition evidence exist in deterministic form (`context-selection-policy-gate-b1-run-1.md:20-23`), but no developer-facing evaluation was ever run; the plan's "no premature product UI" rule kept this unmeasured (`docs/plan/context-runtime-v0.3-experiment-plan.md:665-691`). |
| 12 | Does Context Runtime have enough independent value to become reusable infrastructure outside Canvas Agent? | NOT ESTABLISHED | Reuse mechanics are proven (provider-neutral core, cross-harness offline conformance — CR-009, CR-012A), but independent value is exactly the unproven hypothesis (`context-runtime-v0.3-research-rebaseline-2026-08-13.md:107-109`). Decision: retain in-repo as research packages; do not extract (gate item 11, decided here). |

Question summary: 0 ESTABLISHED, 3 PARTIALLY ESTABLISHED (5, 8, 10),
9 NOT ESTABLISHED. The direction doc's own rule — answers determine v0.4
scope, not assumptions (`docs/architecture/context-runtime-v0.3-direction.md:982`)
— therefore blocks a Working Set Runtime product advance.

---

## 3. What v0.3 established

1. **Provider-neutral observation with model-visible parity.** The Pi
   `before_provider_request` seam captures the actual OpenAI-compatible payload;
   offline parity held across P1–P8 and six negative mutation classes with
   `providerCalls = 0` (`context-runtime-cr-010-model-visible-request-parity.md:137-179,194-199`),
   and one real DeepSeek request reproduced identical intended and observed
   hashes (`2b2ecba3…9eeeb`, `context-runtime-cr-011-real-provider-parity-smoke.md:89-98`).
2. **A deterministic core state machine with replay.** Universe revision →
   proposal → admission → commit → transition → replay verified, including
   out-of-order observation rejection, stale-proposal admission, budget
   rejection, `REPLACE` on same-version representation change, and forged-ID
   rejection across all five serialized object classes; 0 provider calls
   (`context-runtime-cr-009-core-state-machine-2026-08-14.zh-CN.md:11-39`).
3. **Policy lifecycle capability in deterministic traces.** Gate B PASS:
   `REMOVE: 12`, `REHYDRATE: 3`, `replay mismatches: 0`, `policy failures: 0`
   across seven frozen scenarios, with mandatory/pinned protection and the
   adversarial oracle intact
   (`context-selection-policy-gate-b1-run-1.md:31-53`;
   `context-selection-policy-gate-b-adjudication.md:31-54`).
4. **Cross-harness offline conformance.** One frozen `CommittedWorkingSet`
   rendered through both the Pi adapter and a Codex CLI bridge against a shared
   canonical comparator, zero core-contract changes, G1–G4 and P1–P8 PASS,
   offline only (`context-runtime-cr-012a-codex-context-conformance.md:8-27,88-119,165-171`).
5. **Strict experiment-binding and fail-closed benchmark infrastructure.**
   `experiment-strict` provider preparation enforces
   `requestedProvider === actualProvider`, `fallbackUsed === false` and immutable
   binding metadata, failing with `PROVIDER_BINDING_FAILURE`
   (`docs/architecture/model-provider-layer.md:47-70`); the progressive Wave A
   gate stopped a failed record without consuming later-category provider budget
   (`context-runtime-cr-005-wave-a-run-2-synthesis.md:39-43`), and the
   credential-free validator plus frozen manifest/fingerprint checks passed
   C1–C6 (`context-runtime-cr-005-wave-a-execution-gate.md:107,118-132`).

---

## 4. What v0.3 did not establish

1. **Quality or efficiency value of dynamic context selection.** Phase 1
   stopped; its results "are not evidence that Dynamic context selection
   improves task quality, provider cost, or model efficiency"
   (`context-runtime-v0.3-research-rebaseline-2026-08-13.md:107-109`). No
   token, cost or significance claim is supportable from the two valid pairs
   (`context-runtime-cr-005-wave-a-run-2-synthesis.md:136-143`).
2. **Live behavior beyond the 2 valid Wave A pairs.** Wave A was defined as
   exactly 10 records; Run 1 stopped at its first record and Run 2 stopped at
   C4 Native with 5 durable records, 4 valid, 2 completed pairs (C2, C3)
   (`context-runtime-cr-005-wave-a-run-1-c2-stop.md:22-34`;
   `context-runtime-cr-005-wave-a-run-2-synthesis.md:9-17,30-37`). C5/C6 never
   ran; live telemetry contains no REMOVE, REHYDRATE, read-after-remove or
   search-after-remove events (`context-runtime-cr-005-wave-a-run-2-synthesis.md:115-120`).
3. **Real Dynamic rewrite.** CR-004 was bypassed and never executed or
   validated (`context-runtime-v0.3-research-rebaseline-2026-08-13.md:33-36,71`);
   waived at closure.
4. **Real Codex execution.** CR-012A proved the fake-Codex stdin boundary only;
   no real Codex CLI turn, provider SDK or network transport was involved
   (`context-runtime-cr-012a-codex-context-conformance.md:74-81,173-176`);
   CR-012B is `DEFERRED`.
5. **Cross-model generalization.** All live model evidence is
   DeepSeek-only; the two-provider layer is unexercised infrastructure
   (`docs/architecture/model-provider-layer.md:13-22`;
   `context-runtime-v0.3-research-rebaseline-2026-08-13.md:283-287`).

---

## 5. Recommendation for v0.4

1. **Do not advance the Working Set Runtime to the v0.4 product path.** The
   gate conjunction (§8) is unmet and 9 of 12 direction questions are NOT
   ESTABLISHED. Capability evidence is deterministic-only; value evidence is
   absent.
2. **Retain the research packages behind the research boundary.**
   `packages/context-runtime`, `packages/repository-observer`,
   `packages/pi-context-integration`, with `packages/context-conformance` and
   `packages/codex-context-integration`, remain in-repo research assets. Do not
   extract an independently consumable package or service (gate item 11,
   decided here).
3. **Recorded revival path, if the hypothesis is ever revisited.** The cheapest
   honest entry point is a single authorized Active canary via the recorded
   Gate C → D path: Gate C bounded Shadow lifecycle canary (E1–E4) requiring a
   separate Lead decision and provider/cost authorization, then Gate D CR-004
   readiness review with its eight minimum evidence conditions
   (`context-runtime-v0.3-research-rebaseline-2026-08-13.md:180-217`). Any new
   run needs a new run identity and bounded authorization; terminal Wave A
   checkpoints are never resumable (`:219-231`). See the
   [closure decisions](./context-runtime-v0.3-closure-decisions-2026-08-27.md).
4. **Product path continues unaffected.** The shipped product line is governed
   by [Product MVP v0.2 operator guide](../operator/product-mvp-v0.2.md); this
   closure changes no product contract.

---

## 6. Evidence index

Verification documents consulted for this synthesis, one verdict each:

| Document (all under `docs/verification/`) | Verdict |
| --- | --- |
| `context-selection-policy-gate-b-adjudication.md` | PASS |
| `context-selection-policy-gate-b1-run-1.md` | PASS |
| `context-runtime-cr-001-pi-shadow.md` | EVIDENCE-READY |
| `context-runtime-cr-005-wave-a-execution-gate.md` | READY |
| `context-runtime-cr-005-wave-a-run-1-c2-stop.md` | STOPPED |
| `context-runtime-cr-005-wave-a-run-2-c4-stop.md` | STOPPED |
| `context-runtime-cr-005-wave-a-run-2-shadow-adjudication.md` | USABLE_WITH_CAVEAT |
| `context-runtime-cr-005-wave-a-run-2-synthesis.md` | STOPPED |
| `context-runtime-cr-009-core-state-machine-2026-08-14.zh-CN.md` | VERIFIED |
| `context-runtime-cr-010-model-visible-request-parity.md` | PASS |
| `context-runtime-cr-011-real-provider-parity-smoke.md` | PASS |
| `context-runtime-cr-012a-codex-context-conformance.md` | PASS |

Non-verification sources consulted:

- `docs/plan/context-runtime-v0.3-experiment-plan.md` (§8 gate items, 695–711)
- `docs/architecture/context-runtime-v0.3-direction.md` (§17 questions, 967–982)
- `docs/research/context-runtime-v0.3-research-rebaseline-2026-08-13.md`
- `docs/architecture/model-provider-layer.md`
- `docs/operator/product-mvp-v0.2.md`

Referenced closure records with fixed filenames:
`context-selection-policy-gate-a-adjudication-2026-08-27.md` (Gate A `PASS`)
and `context-runtime-v0.3-closure-decisions-2026-08-27.md` (CSPV-C0 `DEFERRED`,
CR-012B `DEFERRED`, CR-013 `CANCELLED / FOLDED`, gate item 5 `WAIVED`).

No provider call was made by this synthesis. No number in this document
originates outside the cited artifacts.
