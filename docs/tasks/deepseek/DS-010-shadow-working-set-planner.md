# DS-010 — Shadow Working Set Planner Kernel

## Task owner

DeepSeek V4 Flash — Context Runtime research implementer. The lead architect owns architecture acceptance, policy promotion, and any authorization to move from Shadow Mode into active context rewrite.

- **Implementation branch:** `agent/deepseek-ds-010-shadow-working-set-planner`
- **Milestone:** Context Runtime v0.3 research
- **Status:** ASSIGNED / READY AFTER THIS PACKET MERGES
- **Depends on:** CR-002 / DS-009 accepted and PR #16 merged to `main@2279884cfdb23fc041d8eafd826a1a8c397f8a2a`
- **Implements:** bounded first slice of CR-003 from `docs/plan/context-runtime-v0.3-experiment-plan.md`
- **Follows:** `docs/architecture/decisions/PROPOSAL-031-context-working-set-planner.md`
- **Does not authorize:** Repository Observer, active model-context rewrite, CR-004, OpenCode/Codex integration, production persistence

> Create the implementation branch from updated `main` only after this task packet is merged. Do not branch DS-010 from this task-packet branch or from the old DS-009 implementation branch.

## Goal

Build the minimum provider-neutral, deterministic Shadow Working Set Planner kernel required to answer:

> Given an exact `ContextUniverseRevision`, a normalized planning request, an optional previous Shadow Working Set, and a semantic token budget, can Canvas deterministically propose what should remain active, what should become cold, what should be rehydrated, and why — without changing the real Pi model request?

This task is **Shadow planning only**.

It must preserve the separation established by CR-002:

```text
Source Observation
        ↓
Source Reconciliation
        ↓
Context Universe
        ↓
──────────────────────────────
Working Set Planning   ← DS-010 starts here
        ↓
Shadow Context Working Set
        ↓
Context Decision / Transition
```

The Universe describes what is currently known. The Working Set describes what the Planner proposes should be active now.

The task succeeds by making planning deterministic, explainable and benchmarkable — not by maximizing token reduction.

## CR-002 evidence that constrains this task

CR-002 established that:

- `ObservedContextElement != ContextSource`;
- `ContextSourceVersion` identity is stable and source-scoped;
- `AVAILABLE`, `ABSENT` and `UNAVAILABLE` have distinct reconciliation semantics;
- Universe revisions are immutable, logically hashable and replayable from seed + ordered observation batches;
- snapshot-seeded and run-derived sources are distinguishable by explicit provider-neutral descriptor/provenance;
- Pi-specific attribution vocabulary is isolated to `packages/pi-context-integration`;
- `packages/context-runtime` production code and tests are provider-neutral;
- exact run-event sources (`run/tool-call://*`, `run/tool-result://*`) are trustworthy at the Pi seam;
- `repository/file://*` identities derived from Pi tool arguments are only `DERIVED_HINT` until a real Repository Observer authoritatively observes current file state;
- current run-event `contentHash` is source-local and must not be treated as a global cross-source content-addressing/dedup guarantee;
- event-log-only persisted Universe replay is not implemented.

These limitations are part of the DS-010 input contract, not defects to “fix” by broadening this task.

## Read first

Architecture and accepted evidence:

- `CONTRIBUTING.md`
- `docs/architecture/context-runtime-v0.3-direction.md`
- `docs/architecture/decisions/PROPOSAL-030-context-source-universe-model.md`
- `docs/architecture/decisions/PROPOSAL-031-context-working-set-planner.md`
- `docs/plan/context-runtime-v0.3-experiment-plan.md`
- `docs/verification/context-runtime-cr-002-source-universe-shadow.md`
- `docs/verification/context-runtime-cr-002-acceptance.md`
- `docs/tasks/deepseek/DS-009-context-source-universe-shadow.md`

Current implementation:

- `packages/context-runtime/**`
- `packages/pi-context-integration/**`

Use v0.2 `ContextSnapshot`, `ExecutionRequest`, priority and authority semantics only as read-only semantic reference. Do not change those public contracts.

## Central architecture rules

### 1. Shadow means the real model request is unchanged

At every Pi `context` boundary:

```text
Native Pi AgentMessage[]
        |
        +--> returned unchanged to Pi / provider
        |
        +--> observed by Context Runtime
                    |
                    v
              Universe revision
                    +
              PlanningRequest
                    +
              Previous Shadow Working Set
                    |
                    v
              Deterministic Planner
                    |
                    v
              Shadow Working Set
              + Decisions
              + Transition
```

No DS-010 code may remove, replace, compress, reorder or inject real Pi messages.

### 2. Planner may select only trustworthy Universe state

The Planner must not convert a Pi resource hint into canonical source truth.

Allowed planning inputs in DS-010:

- snapshot-like seed entries already admitted to the Universe;
- EXACT run-event entries already admitted to the Universe;
- explicit deterministic test fixtures representing valid Universe entries.

Not allowed as canonical planner inputs:

- `DERIVED_HINT` repository/file paths that have not been admitted by an authoritative source observer;
- free-form assistant/user prose converted into fake sources;
- provider payload fragments that bypass the Universe;
- arbitrary content hashes used as source identity.

If a useful first file-aware policy requires authoritative current repository state, stop that part of the work and record it as a Repository Observer dependency. Do not silently promote hints.

### 3. First policy must be deterministic and inspectable

Do not use an LLM, embedding model, vector store, graph ranking model, learned scorer, or opaque heuristic agent to choose the Working Set in DS-010.

For the same normalized:

```text
ContextUniverseRevision
+
ContextPlanningRequest
+
Previous Working Set
+
policyVersion
```

Planner output must be identical, including deterministic ordering and logical hash.

### 4. Membership and representation remain separate

The Planner must preserve two different questions:

```text
A. Should this source/version be active now?
B. If active, which representation should be used?
```

Do not hide an irrelevant source behind a cheap `METADATA` representation and call that a good membership decision.

DS-010 may keep representation behavior deliberately narrow while the architecture is proved.

## Required research vocabulary

Exact exported/public names are not frozen, but implementation must preserve the concepts below.

### 1. ContextPlanningRequest

Minimum experimental fields should be sufficient to normalize one planning boundary without provider-specific messages.

Conceptual shape:

```ts
interface ContextPlanningRequest {
  runtimeSessionId: string
  recompositionSequence: number
  taskRef?: string
  taskPhase: 'INVESTIGATE' | 'PLAN' | 'IMPLEMENT' | 'DEBUG' | 'VERIFY' | 'GENERAL'
  budget: ContextBudget
  pinnedSourceKeys: readonly string[]
  excludedSourceKeys: readonly string[]
  currentTargetSourceKeys: readonly string[]
  latestVerificationSourceKeys: readonly string[]
  previousWorkingSetId: string | null
}
```

For the live Pi shadow seam, missing normalized task semantics must default conservatively (for example `GENERAL`, empty target lists). Do not parse free-form prompt text to invent targets/phases in this task.

### 2. ContextRepresentation

A `ContextSourceVersion` is source truth; a representation is model-usable form.

Minimum experimental representation fields:

```ts
interface ContextRepresentation {
  id: string
  kind: 'REFERENCE' | 'METADATA' | 'FULL' | 'SYMBOL' | 'LINE_RANGE' | 'DIFF' | 'SUMMARY'
  sourceVersionIds: readonly string[]
  contentHash: string
  tokenEstimate: number
  lossiness: 'NONE' | 'BOUNDED' | 'LOSSY'
  derivation: unknown
}
```

Requirements:

- exact `SourceVersion` provenance is mandatory;
- representation identity is immutable/deterministic;
- changed source version must make stale representations detectable;
- derived authority must never silently increase;
- raw representation content does not need production persistence in DS-010.

DS-010 does **not** need to prove every representation kind. The first policy may primarily use `REFERENCE` / `METADATA` / fixture-backed research representations. `REPLACE` and `COMPRESS` may remain contract/test vocabulary if there is not yet trustworthy file-level material to exercise them honestly.

### 3. ContextWorkingSet

Must be immutable and bind to the exact Universe revision from which it was planned.

At minimum record:

```text
workingSetId
runtimeSessionId
sequence
plannedFromUniverseSequence
plannedFromUniverseHash
previousWorkingSetId
policyVersion
planningRequestHash
ordered items
totalTokenEstimate
budget
mode = SHADOW
logicalHash
createdAt / observed planning boundary time
```

Working Set items must point to representations and exact source/version provenance, not arbitrary text.

### 4. ContextDecision

Initial semantic vocabulary remains:

```text
KEEP
ADD
REMOVE
REPLACE
COMPRESS
REHYDRATE
```

DS-010 Policy V0 must at least emit and test:

```text
ADD
KEEP
REMOVE
REHYDRATE
```

`REPLACE` / `COMPRESS` types may exist without being common Policy V0 outputs if the current trustworthy source material cannot support them honestly.

Every decision must carry machine-readable reason code(s), policy version, relevant subject refs and estimated token delta where applicable.

Minimum initial reason vocabulary may include architecture-equivalent codes for:

```text
MANDATORY_INSTRUCTION
USER_PINNED
CURRENT_TARGET
LATEST_FAILURE
PREVIOUSLY_ACTIVE
RECENT_RUN_EVIDENCE
SOURCE_ABSENT
SOURCE_UNAVAILABLE_CONSERVATIVE_KEEP
BUDGET_PRESSURE
REHYDRATION_TRIGGERED
EXPLICIT_EXCLUDE
```

If new experimental reason codes are introduced, document them as provisional CR-003 evidence rather than silently treating PROPOSAL-031 as frozen.

### 5. ContextTransition

Must represent one deterministic semantic transition:

```text
Previous Working Set (or null)
        ↓
ContextDecision[]
        ↓
New Working Set
```

Record at minimum:

```text
transitionId
runtimeSessionId
sequence
fromWorkingSetId
toWorkingSetId
ordered decisions
fromTokenEstimate
toTokenEstimate
policyVersion
trigger/evidence refs
logical hash or equivalent deterministic identity
```

## Required implementation

### 1. Add provider-neutral experimental planner modules

Primary direction:

```text
packages/context-runtime/src/
  representation/
  planning/
  working-set/
  metrics/          (only if needed for bounded Shadow metrics)
```

Do not force this exact folder shape if repository conventions suggest an equivalent provider-neutral organization.

Core must not import Pi/OpenCode/Codex/provider types.

### 2. Implement deterministic identity and normalization helpers

Add deterministic hashing/normalization for:

- `ContextPlanningRequest`;
- representations;
- Working Set items/order;
- Working Set logical hash;
- ContextDecision / transition identity where useful.

Requirements:

- canonical stable ordering;
- deterministic tie-breaking;
- policy version participates in plan identity;
- timestamps/session IDs must not accidentally enter semantic hashes unless explicitly intended and documented;
- equivalent normalized inputs must replay to equivalent plan output.

### 3. Implement Policy V0

Policy V0 should be deliberately simple.

Recommended first-pass pipeline:

```text
1. Map hard mandatory/protection state.
2. Apply explicit pins.
3. Detect pin/exclude vs mandatory conflicts explicitly; do not silently violate hard protection.
4. Apply explicit excludes to ordinary candidates.
5. Admit current targets when they are valid canonical Universe sources.
6. Admit latest verification/failure evidence when provided as canonical source keys.
7. Prefer still-useful previous Working Set membership to reduce churn.
8. Admit recent trustworthy run-event evidence deterministically.
9. Treat confirmed ABSENT as non-active unless intentionally historical.
10. Treat UNAVAILABLE conservatively; never erase last-known canonical knowledge.
11. If over semantic budget, evict lowest-value NORMAL candidates deterministically.
12. Preserve enough history/refs for later REHYDRATE decisions.
```

Suggested deterministic ordering inputs:

```text
protection
explicit pin
current-target relation
latest-verification relation
baseline priority (when explicitly present)
observation availability/freshness
previous membership
run-event recency
token estimate
canonical sourceKey / representationId tie-break
```

Authority is a trust/conflict property, not a generic relevance score. Do not collapse authority, priority, relevance and protection into one number.

### 4. Implement mandatory / pin / exclude semantics

At minimum prove:

- `MANDATORY` cannot be removed by ordinary budget eviction;
- `PINNED` survives normal ranking/eviction;
- explicit exclude removes an ordinary eligible item;
- mandatory + exclude conflict produces an explicit planning conflict/error/decision path rather than silently dropping mandatory context;
- no normal budget policy can override the hard mandatory rule.

For initial mapping, snapshot Task Instruction / P0 may map to `MANDATORY` when that semantic metadata is explicitly available. Do not infer mandatory state from source-key text patterns.

### 5. Implement Working Set continuity and REHYDRATE

Use previous Shadow Working Set when provided.

At minimum support deterministic fixture evidence for:

```text
Call N:
  source A active

Call N+1:
  source A removed/cold due to explicit exclusion or budget pressure

Call N+2:
  source A becomes pinned/current target again
        ↓
  REHYDRATE source A
```

Record original removal reason and rehydration reason in a machine-readable way sufficient for future false-removal metrics.

Do not claim causal “false removal” automatically; only preserve evidence/proxies.

### 6. Bind every plan to the exact Universe revision

Planner output must record the exact Universe sequence/hash.

Requirements:

- Planner cannot use a SourceVersion absent from the input Universe revision unless an explicitly modeled historical rehydration rule permits an addressable historical version;
- a plan created from Universe revision N cannot masquerade as a plan for N+1;
- changed source version must make stale representation provenance detectable;
- deterministic tests must cover stale representation detection.

### 7. Integrate Shadow planning at the Pi semantic seam without rewriting context

Extend the experimental Pi integration only enough to:

```text
observe model call
→ advance/read current Universe revision
→ construct a minimal normalized PlanningRequest
→ invoke provider-neutral Planner
→ record Shadow Working Set + Transition metadata
→ return original Pi context unchanged
```

Live defaults should remain conservative:

- `taskPhase = GENERAL` unless an explicit structured phase hint already exists;
- no free-form prompt parsing for targets;
- no resource hint promotion;
- no provider payload enters core Planner input;
- no semantic rewrite is applied.

### 8. Produce bounded Shadow metrics

For each model-call boundary, record enough metadata to compare Native observation size vs proposed semantic Working Set estimate.

At minimum:

```text
modelCallSequence
universeSequence / hash
nativeContextEstimate (existing CR-001 scope, clearly labeled)
workingSetId
total proposed semantic token estimate
ADD count
KEEP count
REMOVE count
REHYDRATE count
REPLACE/COMPRESS count if any
churn count
decision reason-code counts
```

Do not claim provider-billed token savings. Native CR-001 estimate remains scoped to `agent-messages-pre-provider`; Shadow Working Set estimate is a semantic planning metric.

### 9. Add deterministic multi-boundary fixture tests

Credential-free tests must cover at least:

1. same normalized Universe + PlanningRequest + previous Working Set + policyVersion => same Working Set logical hash;
2. deterministic tie-breaking for equal-ranked candidates;
3. Working Set binds exact Universe sequence/hash;
4. mandatory item survives severe budget pressure;
5. pin survives normal eviction;
6. exclude removes ordinary candidate;
7. mandatory/exclude conflict is explicit and deterministic;
8. ABSENT source is not treated as currently active ordinary evidence;
9. UNAVAILABLE preserves conservative last-known semantics and uses explicit reason code when retained;
10. previous active item receives `KEEP` when still selected;
11. active → removed/cold → relevant again produces `REHYDRATE` rather than an indistinguishable first `ADD`;
12. every membership change has a machine-readable decision reason;
13. token estimates/deltas match selected representations;
14. changed SourceVersion invalidates/stales a representation derived from the old version;
15. representation provenance references exact SourceVersion IDs;
16. derived representation authority cannot silently increase;
17. Planner cannot select a non-admitted `DERIVED_HINT` as canonical source input;
18. core tests contain no Pi-specific vocabulary/types;
19. Pi shadow extension returns semantic context unchanged;
20. policyVersion change produces a distinguishable plan/Working Set identity.

### 10. Run one opt-in Pi + DeepSeek CR-003A Shadow smoke

When credentials are intentionally available, run a small Pi + DeepSeek smoke that exercises multiple model calls and records Shadow plans.

The smoke must prove:

- real Pi context still passes through semantically unchanged;
- Universe continues advancing normally;
- one Shadow Working Set is produced per selected planning boundary (or an explicitly documented reuse strategy if identical plans share identity);
- decisions/reason counts are metadata-only;
- no raw prompt/tool-result content or credentials are persisted in committed evidence;
- repository/file `DERIVED_HINT` entries are not silently treated as canonical planner sources.

If credentials are unavailable, report `SKIPPED`; deterministic tests remain mandatory.

### 11. Produce CR-003A verification evidence

Create:

```text
docs/verification/context-runtime-cr-003-shadow-planner.md
```

It must contain:

- exact implementation branch/HEAD;
- exact Pi package/version used if Pi integration changes are exercised;
- exact DeepSeek provider/model for live smoke if executed;
- implemented experimental planning types and boundaries;
- deterministic Policy V0 pipeline and tie-breaking rules;
- reason-code vocabulary actually emitted;
- protection / pin / exclude behavior;
- Universe binding and representation freshness behavior;
- deterministic fixture commands/results;
- live smoke status and metadata-only per-call Shadow timeline;
- Native estimate vs proposed Working Set estimate with scope labels;
- churn / ADD / KEEP / REMOVE / REHYDRATE counts;
- any `REPLACE` / `COMPRESS` evidence, or an explicit statement that they remain unexercised contract vocabulary;
- known mismatches discovered against PROPOSAL-031;
- explicit statement that repository/file canonical current state still requires a Repository Observer if not implemented elsewhere;
- recommendation for the next bounded step: Repository Observer first vs file-aware CR-003B;
- explicit statement that CR-004 Active Rewrite is **not** authorized by DS-010 evidence alone.

DeepSeek must not self-authorize CR-004.

## Authorized files

Primary scope:

- `packages/context-runtime/**`
- `packages/pi-context-integration/**` only for Shadow planning integration/metadata output
- deterministic fixtures/tests adjacent to those packages
- `docs/verification/context-runtime-cr-003-shadow-planner.md`

Status/evidence scope:

- `docs/plan/context-runtime-v0.3-experiment-plan.md` CR-003A evidence/status only
- `docs/tasks/README.md` DS-010 status/evidence only
- `pnpm-lock.yaml` / package-local config only if a justified dependency change is needed

Avoid new dependencies. No embedding/vector/graph/provider SDK dependency is expected.

Do not modify without stopping for architecture approval:

- `apps/desktop/**`
- `packages/worker-runtime/**`
- `packages/persistence/**`
- existing `packages/contracts/**` public schemas
- existing `packages/domain/**` public model
- v0.2 ContextSnapshot / SourceReference / ExecutionRequest semantics

## Explicit prohibited scope

DS-010 must **not**:

- rewrite, delete, replace, reorder or inject real Pi context/messages;
- start CR-004 Active Working Set Rewrite;
- implement a production protocol renderer;
- implement a Repository Observer or claim authoritative current repository/file state from Pi resource hints;
- promote `DERIVED_HINT` to canonical source identity;
- parse free-form model prose to derive current targets, task phase or source identity;
- use an LLM as Planner;
- use embeddings, vector DB, graph DB, learned ranking or opaque agentic selection;
- add production SQLite Runtime tables;
- freeze public Context Runtime SDK/contracts;
- modify `ContextSnapshot` or `ExecutionRequest v2`;
- integrate OpenCode;
- integrate Codex Gateway;
- build Desktop/Canvas UI;
- claim provider-billed token savings from Shadow estimates;
- claim a removal is causally harmful/useful without preserved evidence;
- self-authorize CR-004.

## Acceptance criteria

1. `packages/context-runtime` remains Pi/OpenCode/Codex/provider neutral in production and tests.
2. Pi model-call context remains semantically unchanged by the DS-010 integration.
3. Experimental `ContextPlanningRequest`, `ContextRepresentation`, `ContextWorkingSet`, `ContextDecision`, and `ContextTransition` (or architecture-equivalent concepts) are distinct and provider-neutral.
4. Working Set binds to the exact input Universe sequence/hash.
5. Every selected representation retains exact SourceVersion provenance.
6. Changed SourceVersion makes stale representation provenance detectable.
7. Derived representation authority cannot silently increase.
8. Policy V0 is deterministic for the same normalized inputs and policy version.
9. Equal-ranked candidates have deterministic tie-breaking.
10. `MANDATORY` cannot be removed by ordinary budget eviction.
11. Explicit pin survives normal ranking/eviction.
12. Explicit exclude works for ordinary candidates and cannot silently override mandatory protection.
13. Policy V0 emits machine-readable reason codes for all membership changes.
14. `ADD`, `KEEP`, `REMOVE`, and `REHYDRATE` are exercised by deterministic tests.
15. Previous Working Set continuity is preserved sufficiently to distinguish `KEEP` from `ADD` and `REHYDRATE` from first admission.
16. `ABSENT` and `UNAVAILABLE` affect planning differently and remain consistent with CR-002 semantics.
17. Non-admitted repository/file `DERIVED_HINT` is never treated as canonical Planner source state.
18. Working Set total token estimate equals selected item/representation estimates under the documented estimator.
19. Policy version participates in deterministic plan identity.
20. Credential-free deterministic tests cover the required planning invariants.
21. `pnpm check` remains green.
22. One opt-in Pi + DeepSeek Shadow Planner smoke is attempted when credentials are intentionally available and truthfully reports EXECUTED / SKIPPED / FAILED.
23. Shadow evidence remains metadata-only/credential-safe by default.
24. Verification report clearly distinguishes Native CR-001 estimate scope from Shadow semantic Working Set estimate.
25. Verification report states which PROPOSAL-031 assumptions were confirmed/contradicted/provisional.
26. No Repository Observer, active context rewrite, production persistence, v0.2 contract change, OpenCode/Codex integration or CR-004 work is included.
27. DeepSeek does not self-accept CR-003A or self-authorize CR-004; lead architect review remains required.

## Stop conditions

Stop implementation and return an architecture note if any occurs:

1. meaningful Planner correctness requires treating `DERIVED_HINT` repository/file paths as authoritative current file state;
2. core Planner requires raw Pi/OpenCode/Codex/provider message types rather than normalized semantic state;
3. deterministic planning requires parsing free-form model prose as the primary source of target/phase identity;
4. representation freshness cannot be checked against exact SourceVersion provenance;
5. preserving mandatory context requires modifying v0.2 `ContextSnapshot` / `ExecutionRequest` contracts;
6. Shadow planning cannot be integrated at the Pi seam without changing the real model request;
7. a usable first policy appears to require an LLM/embedding/graph-ranking dependency rather than a transparent deterministic baseline;
8. runtime-safe planning requires production persistence schema changes;
9. implementation pressure expands into active rewrite / renderer / CR-004 behavior.

Expected response to a stop condition:

- do not broaden scope;
- write the smallest architecture deviation note explaining the blocker;
- preserve all working deterministic evidence;
- recommend the minimum next experiment (for example a separate Repository Observer packet) and wait for lead decision.

## Required verification commands

At minimum run:

```bash
pnpm --filter @canvas-agent/context-runtime test
pnpm --filter @canvas-agent/pi-context-integration test
pnpm --filter @canvas-agent/context-runtime typecheck
pnpm --filter @canvas-agent/pi-context-integration typecheck
pnpm check
```

If the Pi integration package is not changed, still run its current deterministic suite to prove the CR-001/CR-002 pass-through boundary remains intact.

## Handoff format

Return a concise handoff containing:

1. branch and HEAD;
2. modified files grouped by Runtime core / Pi integration / tests / docs;
3. exact implemented planning vocabulary/types;
4. Policy V0 pipeline and deterministic tie-break order;
5. mandatory / pin / exclude evidence;
6. Universe binding evidence;
7. representation provenance/freshness evidence;
8. ADD / KEEP / REMOVE / REHYDRATE evidence;
9. Native estimate vs Shadow Working Set estimate timeline (scope-labeled);
10. churn / decision reason-code summary;
11. exact deterministic test/typecheck/`pnpm check` results;
12. live Pi + DeepSeek smoke status and run id if executed;
13. any PROPOSAL-031 mismatches;
14. explicit Repository Observer dependency status;
15. explicit scope confirmation:

```text
No real Pi model-call context was rewritten.
No Repository Observer was implemented.
No production persistence schema was added.
No v0.2 ContextSnapshot or ExecutionRequest contract was changed.
No OpenCode/Codex integration was added.
CR-004 was not started.
```

16. do not self-announce CR-003A ACCEPTED; wait for lead architect review.
