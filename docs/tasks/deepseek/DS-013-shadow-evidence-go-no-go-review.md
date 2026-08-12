# DS-013 — CR-003 Shadow Evidence Go/No-Go Review for CR-004

## Task owner

DeepSeek V4 Flash — independent Context Runtime evidence reviewer.

- **Review branch:** `agent/deepseek-ds-013-shadow-go-no-go-review`
- **Milestone:** Context Runtime v0.3 research
- **Task type:** evidence synthesis / architecture readiness review
- **Status:** ASSIGNED / READY AFTER THIS PACKET MERGES
- **Depends on:** CR-001, CR-002, CR-003A, DS-011 and CR-003B accepted; PR #22 merged
- **Base when authorized:** reviewed `main` after this task packet merges

The lead architect owns the final authorization decision. DeepSeek must not self-authorize CR-004.

---

# 1. Purpose

CR-003 Shadow planning is now implemented through the file-aware boundary. Before any active model-context rewrite begins, perform a formal evidence review answering two distinct questions:

```text
A. CR-004 IMPLEMENTATION AUTHORIZATION
   Is there enough reviewed architecture/evidence to authorize building a bounded Active Rewrite mechanism?

B. ACTIVE EXPERIMENT AUTHORIZATION
   Is there enough reviewed evidence and safety infrastructure to actually run a real model call with Canvas-rewritten semantic context?
```

Do not collapse these into one yes/no answer.

The review must be evidence-led. A small Shadow Working Set or successful smoke does not by itself justify active rewrite.

The central research rule remains:

> Token reduction alone is insufficient. The Runtime is promising only if context can be changed without degrading task reliability, provenance, replayability or protocol/tool continuity.

---

# 2. Required reading

Read these before writing the review:

- `AGENTS.md`
- `docs/architecture/context-runtime-v0.3-direction.md`
- `docs/architecture/decisions/PROPOSAL-030-context-source-universe-model.md`
- `docs/architecture/decisions/PROPOSAL-031-context-working-set-planner.md`
- `docs/plan/context-runtime-v0.3-experiment-plan.md`
- `docs/verification/context-runtime-cr-001-pi-shadow.md`
- `docs/verification/context-runtime-cr-002-acceptance.md`
- `docs/verification/context-runtime-cr-003a-acceptance.md`
- `docs/verification/context-runtime-ds-011-acceptance.md`
- `docs/verification/context-runtime-cr-003b-acceptance.md`
- `docs/verification/context-runtime-cr-003b-file-aware-shadow-planner.md`
- DS-008 through DS-012 task packets

Inspect the actual implementation corresponding to accepted evidence, especially:

- `packages/context-runtime/src/**`
- `packages/repository-observer/src/**`
- `packages/pi-context-integration/src/**`
- relevant tests and smoke harnesses

Do not rely on verification prose when the implementation can confirm or contradict it.

---

# 3. Strict scope

This is primarily a **review task**, not CR-004 implementation.

Allowed:

- read accepted code/docs/history;
- run existing deterministic tests;
- run existing credential-free smokes;
- run existing opt-in Pi + DeepSeek Shadow smokes if credentials are locally available;
- inspect metadata-only research traces if available locally and safe;
- create review tables / calculations / evidence summaries;
- add a tiny review-only helper script only if genuinely necessary to aggregate existing metadata, with no runtime behavior change;
- update review documentation and task-board status on the review branch.

Not authorized:

- modifying real Pi/model messages;
- adding an ACTIVE Working Set renderer;
- enabling Dynamic context mode;
- implementing provider payload rewrite;
- implementing CR-004 kill switch as production/runtime behavior;
- adding SUMMARY / COMPRESS / LLM summarization;
- adding SYMBOL / DIFF / AST / LSP / repository crawler;
- adding OpenCode/Codex integration;
- changing production persistence/public v0.2 contracts;
- declaring CR-004 authorized.

If the review concludes evidence is insufficient, document the smallest next evidence task. Do not fix the gap by silently starting CR-004.

---

# 4. Review verdict vocabulary

For each gate use exactly one status:

```text
PASS
PARTIAL
FAIL
NOT_EVIDENCED
NOT_APPLICABLE
```

For each of the two overall authorization questions use exactly one recommendation:

```text
GO
CONDITIONAL_GO
NO_GO
```

Definitions:

```text
GO
  All prerequisite gates for that authorization level are supported by accepted/repeatable evidence.

CONDITIONAL_GO
  Architecture is sufficient, but a small explicit set of preconditions must be implemented/verified before crossing the relevant boundary.
  Preconditions must be concrete and testable.

NO_GO
  One or more prerequisite evidence gates are materially absent or contradicted. More Shadow/baseline evidence is required before authorization.
```

Do not use `CONDITIONAL_GO` to hide a missing representative baseline corpus if the governing proposal explicitly requires one before the relevant authorization.

---

# 5. Mandatory PROPOSAL-031 ACTIVE gate audit

Audit all eight ACTIVE gates from PROPOSAL-031 §17 independently.

## Gate 1 — Native baseline corpus exists

Required question:

> Do we have a repeatable Native baseline corpus, not merely one-off smokes?

A smoke proves integration, not benchmark reliability.

Evidence should identify:

- number of distinct tasks;
- task categories;
- repository revision reproducibility;
- Native repetitions per task, if any;
- task acceptance criteria / test oracle;
- Native success/failure outcomes;
- whether the same task can be rerun under fixed model/repository/tool policy/budget.

If accepted artifacts contain only small integration smokes, classify honestly. Do not upgrade smoke evidence into a representative corpus.

## Gate 2 — Shadow transitions deterministic

Prove or refute:

```text
same normalized Universe
+ same normalized PlanningRequest
+ same policy version
+ same prior Working Set
→ same semantic Working Set / transition identity
```

Include evidence for representationNeeds and SourceVersion advance.

## Gate 3 — REMOVE / REPLACE / COMPRESS explainable with provenance

Audit actual implemented decisions.

- REMOVE must have source/version evidence and reason codes.
- REPLACE must preserve representation/source provenance and reason codes.
- COMPRESS is not currently implemented; do not pretend otherwise. Determine whether its absence blocks the first Active experiment given the currently proposed CR-004 operation subset.

## Gate 4 — Rehydration paths implemented in research tooling

Distinguish:

```text
unit-test vocabulary support
vs
real observer history tracking
vs
actual active renderer restoration
```

The gate is about pre-ACTIVE research readiness, but the review must make clear what is and is not proven.

## Gate 5 — Mandatory / pinned protections test-locked

Verify ordinary planner pressure/exclusion cannot silently evict mandatory/pinned context, and conflict behavior is explicit.

## Gate 6 — Representation staleness detectable

Verify SourceVersion advance cannot silently KEEP stale FULL/LINE_RANGE data and that provenance is sufficient to detect stale representation state.

## Gate 7 — Tool-call / protocol continuity remains outside semantic Planner control

Audit the architecture boundary:

```text
semantic Working Set
!=
provider protocol state
```

Identify what Pi-specific continuity constraints an eventual Active renderer must preserve, such as:

- tool-call / tool-result pair integrity;
- message roles/order required by Pi/provider;
- system instructions;
- opaque provider state / reasoning items where applicable;
- retries and semantic-call identity.

Do not claim Active continuity is proven just because Shadow returns native messages unchanged.

## Gate 8 — Per-Run kill switch can restore Native behavior

Audit what exists today versus what CR-004 would still need.

Distinguish:

```text
Shadow integration can be disabled
vs
an Active rewrite path has a per-Run immediate native fallback/kill switch
```

If the latter does not exist yet, classify accordingly and decide whether that blocks:

- authorizing implementation, or
- executing the first Active experiment.

---

# 6. Additional CR-003 acceptance review

The experiment plan says CR-003 acceptance evidence includes a representative Shadow report/corpus. Audit this separately from the eight §17 gates.

At minimum assess:

## 6.1 Corpus representativeness

Compare existing evidence against the intended CR-005 pressure categories:

1. localized bug fix;
2. multi-file feature change;
3. failing-test diagnosis;
4. refactor with architectural constraints;
5. discovery across unrelated candidate files;
6. longer task with at least one wrong investigative path.

For each category mark:

```text
COVERED
PARTIAL
NOT_COVERED
```

Do not fabricate coverage from generic smoke prompts.

## 6.2 False-removal observability

Determine what current evidence actually supports for:

- REMOVE count;
- REHYDRATE count;
- rehydrated within 1 / 3 / 5 calls;
- repeated file/tool reads after removal;
- stale context retained;
- removal followed by task failure;
- removal followed by native-context recovery.

A unit test proving REHYDRATE mechanics is not a corpus-level false-removal rate.

## 6.3 Representation usefulness

Audit evidence for:

```text
FULL → LINE_RANGE
LINE_RANGE → FULL
SourceVersion advance replacement
```

Ask whether current evidence demonstrates only mechanical correctness or also real task usefulness.

## 6.4 Churn / continuity

Summarize available evidence for:

- KEEP continuity;
- ADD/REMOVE/REPLACE churn;
- stable-prefix estimate if actually available;
- unnecessary re-planning/replacement.

## 6.5 Native vs proposed metric scope

Preserve the accepted distinction:

```text
Native estimate = CR-001 agent-messages-pre-provider heuristic
Proposed estimate = semantic Shadow Working Set estimate
```

Do not report their ratio as provider token savings.

---

# 7. Repeatability check

Run, where available:

```bash
pnpm --filter @canvas-agent/context-runtime test
pnpm --filter @canvas-agent/repository-observer test
pnpm --filter @canvas-agent/pi-context-integration test
pnpm --filter @canvas-agent/repository-observer smoke:file-aware
pnpm check
```

If credentials are available and the existing smoke remains operable, also run:

```bash
CANVAS_CONTEXT_LIVE_SMOKE=1 pnpm --filter @canvas-agent/pi-context-integration smoke:deepseek:cr003b
```

The live smoke is supporting interoperability evidence only. It does not satisfy the representative baseline requirement by itself.

Do not create new paid/bulk benchmark runs in this packet unless explicitly authorized later.

---

# 8. Required risk review before CR-004

Create a concise risk register containing at least:

```text
risk
current evidence
failure mode
severity
whether detected before provider call
fallback
required CR-004 invariant/test
```

Must cover:

1. mandatory instruction accidentally omitted;
2. tool-call/tool-result protocol break;
3. stale file representation rendered;
4. false removal causes repeated reads or wrong edit;
5. materialization/repository observation unavailable;
6. planner/renderer disagreement about Working Set identity;
7. Dynamic mode changes task result while appearing to save tokens;
8. kill switch/fallback fails;
9. provider-specific protocol feature cannot represent semantic Working Set safely;
10. metrics overclaim savings because scopes differ.

---

# 9. Two independent final recommendations

The final review must contain both.

## Recommendation A — CR-004 implementation authorization

Question:

> Is it reasonable to authorize implementation of a bounded Active Rewrite mechanism, while still preventing real rewritten calls until safety gates are met?

If `GO` or `CONDITIONAL_GO`, state the maximum safe initial implementation scope.

A bounded recommendation should generally prefer:

```text
Pi only
one explicit per-Run experimental flag
default Native
no opaque summarization
FULL / LINE_RANGE / REFERENCE only
KEEP / ADD / REMOVE / REPLACE / REHYDRATE only
native fallback on any planner/materializer/renderer inconsistency
mandatory instructions always preserved
tool/protocol continuity owned by adapter/renderer
complete transition telemetry
```

Do not authorize more because the enum contains more values.

## Recommendation B — first real Active experiment authorization

Question:

> May we actually send Canvas-rewritten semantic context to a real model now?

This recommendation must be stricter.

If `CONDITIONAL_GO`, enumerate every precondition that must be green before the first rewritten provider call.

If the Native baseline corpus requirement is not met, do not ignore it.

---

# 10. Required next-step recommendation

Return exactly one recommended next move:

```text
1. AUTHORIZE_CR004_PACKET
2. BUILD_NATIVE_SHADOW_CORPUS_FIRST
3. CLOSE_SAFETY_GAPS_FIRST
4. REVISE_ARCHITECTURE_FIRST
```

If more than one issue exists, choose the earliest dependency and list later dependencies underneath it.

Examples:

```text
BUILD_NATIVE_SHADOW_CORPUS_FIRST
  then CLOSE_SAFETY_GAPS_FIRST
  then AUTHORIZE_CR004_PACKET
```

or

```text
AUTHORIZE_CR004_PACKET
  packet must implement kill switch + renderer capability checks before any active call
```

---

# 11. Required output artifact

Create:

```text
docs/verification/context-runtime-cr-003-shadow-go-no-go.md
```

The document must contain:

1. review branch + final HEAD;
2. exact accepted source artifacts reviewed;
3. rerun commands/results;
4. eight PROPOSAL-031 ACTIVE gate matrix;
5. CR-003 representative-corpus matrix;
6. false-removal / rehydration evidence assessment;
7. representation usefulness assessment;
8. churn / continuity assessment;
9. Native-vs-proposed metric scope statement;
10. risk register;
11. Recommendation A (`GO` / `CONDITIONAL_GO` / `NO_GO`);
12. Recommendation B (`GO` / `CONDITIONAL_GO` / `NO_GO`);
13. the one required next move;
14. if applicable, a bounded outline for the future CR-004 packet;
15. known evidence limitations;
16. explicit statement that no real context rewrite was implemented or executed by DS-013.

Use concrete commit/PR/test/smoke references. Separate accepted facts from inference.

---

# 12. Evidence quality rules

The review must follow these rules:

- **Accepted artifact > handoff prose.** Verify against code/tests/docs where possible.
- **Repeatable test > one-time observation.** Label one-time live evidence as such.
- **Smoke != benchmark corpus.** Never treat them as equivalent.
- **Mechanism correctness != task-quality proof.** FULL→LINE_RANGE mechanically working does not prove it improves a coding task.
- **Shadow safety != Active safety.** Returning native messages unchanged cannot prove an eventual renderer preserves protocol continuity.
- **Semantic estimate != provider token count.** Do not calculate fake savings.
- **Missing evidence stays missing.** Do not infer PASS from lack of failures.
- **No self-authorization.** DeepSeek recommends; the lead architect decides.

---

# 13. Stop conditions

Stop and surface an architecture issue if the review requires any of the following to reach a conclusion:

- changing public v0.2 contracts;
- implementing active message rewrite;
- implementing provider-specific protocol rewrite;
- running a large paid benchmark corpus not explicitly authorized;
- introducing LLM-based summarization/planning;
- introducing a new Agent harness;
- changing the accepted Shadow Planner policy merely to improve the review outcome.

---

# 14. Handoff contract

Return:

1. branch + final HEAD, pushed and clean;
2. modified files;
3. rerun test/smoke evidence;
4. ACTIVE gate matrix summary;
5. corpus coverage summary;
6. key evidence gaps;
7. risk register summary;
8. Recommendation A;
9. Recommendation B;
10. required next move;
11. any future CR-004 packet constraints;
12. explicit scope confirmation.

Do not self-merge and do not declare CR-004 authorized.
