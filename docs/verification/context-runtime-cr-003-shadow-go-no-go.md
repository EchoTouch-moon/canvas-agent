# CR-003 Shadow Evidence Go/No-Go Review for CR-004

- **Status:** REVIEW COMPLETE — recommendations are advisory; the lead architect owns the final CR-004 authorization decision
- **Reviewer:** DeepSeek V4 Flash (independent evidence reviewer, DS-013)
- **Review branch:** `agent/deepseek-ds-013-shadow-go-no-go-review`
- **Date:** 2026-08-12
- **Review HEAD:** see handoff
- **Base reviewed:** `main@32001f8` (PR #22 CR-003B merged)

---

## 1. Accepted source artifacts reviewed

- Architecture/plans: `context-runtime-v0.3-direction.md`, `PROPOSAL-030`, `PROPOSAL-031`, `context-runtime-v0.3-experiment-plan.md`
- Acceptance docs: `context-runtime-cr-001-pi-shadow.md`, `context-runtime-cr-002-acceptance.md`, `context-runtime-cr-003a-acceptance.md`, `context-runtime-ds-011-acceptance.md`, `context-runtime-cr-003b-file-aware-shadow-planner.md`
- CR-003B acceptance record (`context-runtime-cr-003b-acceptance.md`): Decision ACCEPTED at HEAD `5ea61eb`, now present on `main` through PR #23 merge `38d096b318860262e5ddafd7d9fd32add98a2689`; the evidence artifact lag is closed.
- Packets DS-008 through DS-012.
- Actual implementation inspected (code, not prose):
  - `packages/context-runtime/src/planning/{policy-v0,planning-request}.ts`, `working-set/*`, `representation/*`, `metrics/*`
  - `packages/repository-observer/src/{repository-observer,representation-provider,git-blob-reader}.ts`
  - `packages/pi-context-integration/src/extension/{shadow-planner,enriched-shadow}-extension.ts`, `smoke/*`
  - tests: `planner.test.ts`, `representation-provider.test.ts`, `shadow-planner.test.ts`, `repository-observer.test.ts`

## 2. Rerun commands / results (repeatability, this review)

```bash
pnpm --filter @canvas-agent/context-runtime test        86 passed
pnpm --filter @canvas-agent/repository-observer test    35 passed
pnpm --filter @canvas-agent/pi-context-integration test 52 passed
pnpm --filter @canvas-agent/repository-observer smoke:file-aware   EXECUTED
pnpm check                                                GREEN (643 tests + build)
```

Live Pi + DeepSeek smoke not rerun this review (credential-optional, supporting only).

## 3. PROPOSAL-031 §17 ACTIVE gate matrix

| # | Gate | Status | Evidence (accepted, verified in code/tests) |
|---|------|--------|----------------------------------------------|
| 1 | Native baseline corpus exists | **FAIL** | No benchmark/corpus directory exists anywhere in the repo. Every live smoke uses the SAME micro-task (notes.md ls/read/write; or single greet.ts read). No task categories, no repetitions per task, no acceptance oracle, no fixed model/repo/tool-policy/budget matrix. `experiment-plan.md` line 366 explicitly gates CR-004 on "a reviewed Shadow corpus and repeatable Native baseline" — absent. Smoke ≠ benchmark corpus. |
| 2 | Shadow transitions deterministic | **PASS** | `planner.test.ts`: same normalized inputs + policyVersion → same Working Set/Transition logicalHash (#1); deterministic tie-break (#2); policyVersion change → distinguishable identity (#19); planningRequestHash ignores list ordering; representationNeeds now central-enforced into the hash (CR-003B rev.3); SourceVersion advance → `REPLACE(SOURCE_VERSION_ADVANCED)` (#27/28). |
| 3 | REMOVE/REPLACE/COMPRESS explainable with provenance | **PASS (for REMOVE/REPLACE)** | `policy-v0.ts`: REMOVE carries previousItem sourceVersionIds + representationId + reason (SOURCE_ABSENT / EXPLICIT_EXCLUDE / BUDGET_PRESSURE); REPLACE preserves representation/source provenance + reason (REPRESENTATION_NARROWED / DETAIL_REQUIRED / SOURCE_VERSION_ADVANCED). COMPRESS is NOT implemented (contract vocabulary only) — absence does not block the proposed CR-004 operation subset (KEEP/ADD/REMOVE/REPLACE/REHYDRATE, no COMPRESS). |
| 4 | Rehydration paths implemented in research tooling | **PARTIAL** | Unit tests + observer history tracking prove REHYDRATE mechanics end-to-end (`planner.test.ts` #11; `shadow-planner.test.ts` observer end-to-end). **No corpus-level false-removal/rehydration rate** (no corpus exists). No active renderer restoration path (N/A pre-active, but must be built before Active). |
| 5 | Mandatory / pinned protections test-locked | **PASS** | `policy-v0.ts`: MANDATORY (P0) cannot be evicted (eviction filters NORMAL only); MANDATORY+exclude → `PlanningConflictError` (explicit, not silent); PINNED survives normal eviction. Tests #4/#5/#7. |
| 6 | Representation staleness detectable | **PASS** | `isRepresentationFresh` + `SOURCE_VERSION_ADVANCED` REPLACE: changed SourceVersion → old representation stale, fresh v2 representation replaces it (planner #14/#27-28; provider CONTENT_HASH_MISMATCH fail-closed). |
| 7 | Tool-call / protocol continuity outside semantic Planner | **PASS** | The architectural boundary is clean: no renderer/protocol code exists; both Pi extension factories return `event.messages` unchanged; Planner consumes only normalized semantic state. **Active renderer continuity remains NOT_EVIDENCED**: Shadow returning native messages unchanged does not prove preservation of tool-call/tool-result pairs, message roles/order, system instructions, opaque provider state, retries/semantic-call identity. That renderer does not exist, and this remains a separate pre-Active safety gap. |
| 8 | Per-Run kill switch can restore Native behavior | **FAIL** | Only the Shadow integration can be disabled (by not configuring the planner extension) and smokes gate on `CANVAS_CONTEXT_LIVE_SMOKE`. **No per-Run Active rewrite path and no immediate Native fallback/kill switch exists.** Blocks the first Active *experiment* (B), and is a required precondition to *authorize implementation of the Active path* (A) as a bounded packet. |

## 4. CR-003 representative-corpus matrix (CR-005 task categories)

| Category | Coverage | Evidence |
|---|---|---|
| localized bug fix | **NOT_COVERED** | no such task ever run |
| multi-file feature change | **NOT_COVERED** | no multi-file task |
| failing-test diagnosis | **NOT_COVERED** | no test-run task |
| refactor with architectural constraints | **NOT_COVERED** | none |
| discovery across unrelated candidate files | **NOT_COVERED** | CR-003B Git smoke has a single `src/auth.ts`; discovery is not exercised |
| longer task with a wrong investigative path | **NOT_COVERED** | no such task |

All six intended CR-005 pressure categories are currently **NOT_COVERED**. All live smokes are single-session micro-tasks and do not constitute a representative corpus.

## 5. False-removal / rehydration evidence assessment

- REMOVE count: 0 in all live smoke traces (decisions are ADD/KEEP only).
- REHYDRATE count: 0 in all live smoke traces.
- rehydrated within 1/3/5 calls: **NOT_EVIDENCED** (no corpus; only unit-test mechanics).
- repeated file/tool reads after removal: **NOT_EVIDENCED**.
- stale context retained: **NOT_EVIDENCED** at corpus level (staleness detectability is proven at unit level, Gate 6).
- removal → task failure / native-context recovery: **NOT_EVIDENCED**.
- A unit test proving REHYDRATE mechanics is **not** a corpus-level false-removal rate.

## 6. Representation usefulness assessment

- FULL ↔ LINE_RANGE ↔ FULL and SourceVersion-advance replacement are mechanically correct and test-locked (planner #20-28; Git smoke).
- **Task-quality benefit is NOT demonstrated**: no coding task was completed under FULL vs LINE_RANGE to show reliability/success impact. Mechanism correctness ≠ task-quality proof.

## 7. Churn / continuity assessment

- KEEP continuity proven at unit + observer level (unchanged history → KEEP).
- ADD/REMOVE/REPLACE churn counted in `ShadowPlanningMetrics`; live smokes show ADD then KEEP continuity.
- stable-prefix estimate: not available.
- unnecessary re-planning: not measured at corpus level.

## 8. Native vs proposed metric scope statement

- `nativeContextEstimate` = CR-001 `agent-messages-pre-provider` heuristic (e.g. 104 in latest cr003b smoke).
- `proposedSemanticTokenEstimate` = semantic Shadow Working Set estimate (e.g. 18).
- These scopes differ; their ratio is **NOT** provider token savings and must not be reported as such.

## 9. Risk register (before CR-004)

| # | Risk | Current evidence | Failure mode | Severity | Detected before provider call | Fallback | Required CR-004 invariant/test |
|---|------|------------------|--------------|----------|-------------------------------|----------|--------------------------------|
| 1 | Mandatory instruction accidentally omitted | MANDATORY protected in policy (PASS Gate 5) | silent drop of P0 task instruction in Active renderer | High | only if renderer re-validates | Native fallback | renderer must re-assert mandatory keys; test that a plan missing mandatory is rejected |
| 2 | Tool-call/tool-result protocol break | no Active renderer exists (Gate 7) | Active edit splits tool-call/result pairs | High | renderer capability check | Native fallback | adapter/renderer owns protocol spine; Active can only change semantic messages outside protocol pairs |
| 3 | Stale file representation rendered | staleness detectable (PASS Gate 6) | Active renders v1 while Universe has v2 | Medium | yes (freshness check) | replace/native | every Active item freshness-checked vs admitted SourceVersion |
| 4 | False removal causes repeated reads / wrong edit | REMOVE=0 in live corpus | Planner removes needed file → model re-reads / mis-edits | Medium-High | corpus metric | native | corpus-level rehydrate/read-after-removal telemetry |
| 5 | Materialization/repository observation unavailable | observer fail-safe + fail-closed | file source unavailable mid-run | Medium | yes (UNAVAILABLE) | REFERENCE / native | observer failure → non-canonical fallback |
| 6 | Planner/renderer disagreement on Working Set identity | content-addressed WS/decision ids | plan id used for previous-set/transition drifts | Medium | yes (hash compare) | native | renderer binds exact WS logicalHash; mismatch → native |
| 7 | Dynamic mode changes task result while "saving tokens" | no corpus baseline | token drop but task fails | High | needs oracle | native | Native vs Dynamic same acceptance criteria; success metric gates |
| 8 | Kill switch / fallback fails | no Active kill switch exists (Gate 8) | rewritten context leaks to provider on error | High | needs pre-send check | — | per-Run flag + pre-send native fallback + test that aborts before send |
| 9 | Provider protocol feature can't represent semantic WS | no renderer | e.g. tool continuity / thinking items not safely re-expressed | High | renderer capability profile | native | capability matrix; unsupported WS shape → native |
| 10 | Metrics overclaim savings | scopes differ (sec 8) | native vs proposed ratio reported as savings | Medium | doc/audit | — | report scopes separately; never ratio as billing |

## 10. Recommendation A — CR-004 implementation authorization

**NO_GO**

The governing experiment plan states that CR-004 cannot start until CR-003 has a reviewed Shadow corpus and repeatable Native baseline. Gate 1 is **FAIL**, and the representative corpus required by that gate does not exist. Therefore the named CR-004 implementation task cannot be authorized now. The architecture boundary (semantic WS ≠ protocol) is sound, determinism/protection/staleness are test-locked, and the CR-003B implementation is merged, but those facts do not override the governing authorization gate.

The bounded design below remains valuable as a **future packet outline**, not as current authorization. If a later lead Go/No-Go passes after the corpus work, the packet's first stage may implement testable renderer capability checks, the per-Run kill switch, and mandatory re-assertion while still sending no rewritten provider call.

**Future packet constraints — not current authorization:**

- Pi only; one explicit per-Run experimental flag; default Native.
- FULL / LINE_RANGE / REFERENCE only; KEEP / ADD / REMOVE / REPLACE / REHYDRATE only.
- No SUMMARY / COMPRESS / opaque LLM summarization.
- Mandatory instructions always preserved (renderer re-asserts).
- Tool/protocol continuity owned by the adapter/renderer; semantic Planner never touches provider protocol state.
- Any planner/renderer/materializer inconsistency → Native fallback.
- Complete ContextTransition telemetry; per-Run kill switch that restores Native before the provider call.
- CR-004 packet must first land the renderer capability profile + kill switch as testable, still-not-sending code.

**Preconditions for any later authorization (must be in the packet and testable):**

1. A renderer capability profile enumerating which semantic Working Set shapes are safely expressible in Pi protocol (incl. tool-call/result pairs, system instructions, reasoning items).
2. A per-Run Native-default kill switch with a pre-send abort test.
3. Renderer re-validation that mandatory/pinned items survive; any missing → Native.

## 11. Recommendation B — first real Active experiment authorization

**NO_GO**

The representative Native baseline corpus does not exist (Gate 1 FAIL) and the experiment plan explicitly requires "a reviewed Shadow corpus and repeatable Native baseline" before CR-004 can start (line 366). A real rewritten model call cannot be authorized today.

Every precondition that must be green before the first rewritten provider call:

1. Repeatable Native baseline corpus across the six CR-005 task categories with acceptance oracles and fixed model/repo/tool-policy/budget (CR-005 first).
2. A reviewed representative Shadow corpus from that baseline with REMOVE/REHYDRATE/KEEP/REPLACE telemetry and rehydrate-within-1/3/5 and read-after-removal metrics.
3. CR-004 renderer + kill switch implemented and test-locked (still not sending).
4. A Dynamic-vs-Native comparison on the same corpus showing Dynamic preserves acceptance while reducing irrelevant active context.
5. Tool/protocol continuity invariants locked for the Pi renderer.
6. Metric-scope guardrails documented (native vs proposed never reported as billing).

## 12. Required next move (one, with dependency order)

```text
BUILD_NATIVE_SHADOW_CORPUS_FIRST
  then RE-RUN_LEAD_GO_NO_GO
  if gates pass, AUTHORIZE_CR004_PACKET
    then CR-004 packet stage 1: renderer capability profile + per-Run kill switch
    and mandatory re-assertion, still no rewritten provider call
  after the safety gate passes, RUN_FIRST_REAL_ACTIVE_EXPERIMENT
```

The first blocking dependency is **a repeatable Native baseline corpus (CR-005) across the six task categories**, because it is the explicit gate in `experiment-plan.md` line 366 and it is required for both corpus-level false-removal metrics and any future Dynamic-vs-Native success claim.

## 13. Future CR-004 packet outline (bounded, not authorized)

- Scope: Pi only, Shadow→Active renderer seam, one explicit per-Run experimental flag, Native default.
- Allowed representations: FULL / LINE_RANGE / REFERENCE only.
- Allowed operations: KEEP / ADD / REMOVE / REPLACE / REHYDRATE only.
- Deliverables: renderer capability profile; per-Run kill switch (pre-send abort); mandatory/pin re-assertion; full ContextTransition telemetry; Native fallback on any inconsistency.
- Exclusions: COMPRESS/SUMMARY/opaque LLM summarization, SYMBOL/DIFF/AST, OpenCode/Codex, production persistence, v0.2 contract changes.
- Not self-authorizing: this outline is advisory for the lead and does not authorize CR-004 implementation.

## 14. Known evidence limitations

- All live smokes are single micro-tasks; no representative corpus.
- No corpus-level false-removal / rehydration / read-after-removal data.
- No Active renderer or kill switch exists; Shadow pass-through cannot prove Active protocol safety.
- Recommendation A/B rely on `experiment-plan.md` line 366 as the governing gate.

## 15. Scope confirmation

```
No real Pi/model context was rewritten.
No Active Working Set renderer was implemented.
No provider payload rewrite was implemented.
No per-Run Active kill switch was added as runtime behavior.
No SUMMARY/COMPRESS/LLM summarization was added.
No SYMBOL/DIFF/AST/crawler/index was added.
No OpenCode/Codex integration was added.
No production persistence/public v0.2 contract was changed.
CR-004 was not authorized by this review.
```

DeepSeek recommends; the lead architect decides.
