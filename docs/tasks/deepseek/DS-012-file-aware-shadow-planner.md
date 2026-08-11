# DS-012 — CR-003B File-aware Shadow Planner

## Task owner

DeepSeek V4 Flash — Context Runtime research implementer. The lead architect owns architecture acceptance and any authorization to move from Shadow planning into active model-context rewrite.

- **Implementation branch:** `agent/deepseek-ds-012-file-aware-shadow-planner`
- **Milestone:** Context Runtime v0.3 research
- **Status:** ASSIGNED / READY AFTER THIS PACKET MERGES
- **Depends on:** CR-003A / DS-010 accepted; DS-011 Repository Observer accepted and PR #20 merged at `main@d718f2f79785ef67714944f1909b37c94f9b4271`
- **Purpose:** prove that authoritative repository Sources can drive deterministic, provenance-preserving file representations and representation transitions in the existing Shadow Working Set Planner
- **Mode:** SHADOW ONLY
- **Does not authorize:** active Pi/model request rewrite, CR-004, production persistence, OpenCode/Codex integration, whole-repository indexing, opaque LLM summarization, or public contract freeze

> Create the implementation branch from updated `main` only after this packet is merged. Do not branch DS-012 from DS-011 or DS-010 implementation branches.

---

# 1. Goal

Build the minimum file-aware Shadow planning layer required to answer:

> Given an authoritative `repository/file://*` Source admitted by DS-011, can Canvas deterministically materialize an exact model-usable file representation, choose the appropriate level of detail from normalized task state, explain representation changes separately from membership changes, and measure the proposed Working Set without altering the real Agent context?

The intended path is:

```text
Pi / task state may suggest bounded repository paths
        ↓
DS-011 Repository Observer
        ↓
authoritative repository/file:// SourceVersion
        ↓
file representation materialization
        ↓
normalized representation need
        ↓
CR-003 Planner
        ↓
Shadow ContextWorkingSet
        +
ContextDecision / ContextTransition
```

The central research question is no longer merely:

```text
Should file A be active?
```

It is now also:

```text
If file A is active, how much exact detail is needed now?
```

Membership and representation remain separate decisions.

---

# 2. Read first

Required architecture and accepted evidence:

- `AGENTS.md`
- `docs/architecture/context-runtime-v0.3-direction.md`
- `docs/architecture/decisions/PROPOSAL-030-context-source-universe-model.md`
- `docs/architecture/decisions/PROPOSAL-031-context-working-set-planner.md`
- `docs/plan/context-runtime-v0.3-experiment-plan.md`
- `docs/verification/context-runtime-cr-002-acceptance.md`
- `docs/verification/context-runtime-cr-003a-acceptance.md`
- `docs/verification/context-runtime-ds-011-acceptance.md`
- `docs/verification/context-runtime-ds-011-repository-observer.md`
- `docs/tasks/deepseek/DS-010-shadow-working-set-planner.md`
- `docs/tasks/deepseek/DS-011-repository-observer.md`

Primary code seams to inspect:

- `packages/context-runtime/src/representation/**`
- `packages/context-runtime/src/planning/**`
- `packages/context-runtime/src/working-set/**`
- `packages/context-runtime/src/universe/**`
- `packages/repository-observer/**`
- `packages/pi-context-integration/src/extension/shadow-planner-extension.ts`
- `packages/pi-context-integration/src/element-decomposition.ts`

Do not duplicate the accepted RepositoryRevision or Source reconciliation models.

---

# 3. Central architecture rules

## 3.1 Source truth and representation are distinct

The accepted DS-011 Source says:

```text
repository/file://src/auth.ts
version = H(sourceKey, exact contentHash)
```

That SourceVersion is not automatically the exact model payload.

A file-aware representation may be:

```text
FULL       entire exact supported file
LINE_RANGE exact bounded lines from that exact file version
REFERENCE  identity/provenance-only semantic placeholder
```

The representation must always retain the exact SourceVersion provenance.

Do not create a representation from an unverified current workspace read merely because the sourceKey matches.

---

## 3.2 DS-012 minimum representation set

Required and sufficient for acceptance:

```text
FULL
LINE_RANGE
REFERENCE
```

`METADATA` may be used if already useful.

### Optional only if naturally bounded

```text
SYMBOL
DIFF
```

They are **not acceptance requirements** for DS-012.

Do not add a parser framework, language server, AST index, symbol database, repository crawler, or generalized diff engine merely to exercise those enum values.

### Explicitly not authorized in DS-012

```text
SUMMARY
COMPRESS
opaque LLM-generated file summaries
```

`SUMMARY` remains representation vocabulary but must not become production behavior in this task.

---

## 3.3 Exact materialization must match the admitted SourceVersion

The Context Universe stores the admitted file SourceVersion identity/contentHash, not durable raw repository bytes.

Therefore a file representation provider must prove:

```text
requested SourceVersion V
        ↓
materialize exact repository content at exact RepositoryRevision
        ↓
sha256(materialized full content)
        ==
V.contentHash
```

Only then may it derive FULL or LINE_RANGE from V.

If the materialized file no longer matches the admitted SourceVersion, fail closed. Do not silently create a representation from newer bytes while retaining old SourceVersion provenance.

Use DS-011 revision safety semantics. A valid design is:

```text
pre-verify exact revision
→ read bounded file
→ verify full-content hash == admitted SourceVersion contentHash
→ post-verify exact revision
→ derive representation
```

Equivalent evidence is acceptable.

Dirty revisions remain unsupported unless separately proposed. Do not weaken DS-011's fail-closed dirty rule in DS-012.

---

## 3.4 Representation content identity

For FULL:

```text
representation.contentHash = H(exact FULL representation bytes/text)
sourceVersionIds = [exact admitted file SourceVersion id]
lossiness = NONE
```

For LINE_RANGE:

```text
representation.contentHash = H(exact selected line-range representation)
sourceVersionIds = [exact admitted file SourceVersion id]
derivation records deterministic range metadata
lossiness = BOUNDED
```

The representation id remains a deterministic function of representation kind + SourceVersion provenance + representation content hash under existing Runtime rules.

Do not use timestamps/session ids in representation identity.

---

## 3.5 Normalized representation need belongs in the PlanningRequest boundary

The Runtime Planner must not inspect:

- repository path suffixes;
- sourceKey text patterns;
- Pi-specific tool names;
- Pi message payloads;
- repository-observer provenance literals;
- source code language names inferred from file extensions.

If Planner policy needs to know that a source requires FULL detail or a particular line range, feed that need as a normalized provider-neutral planning input.

A bounded experimental shape could be conceptually equivalent to:

```ts
interface ContextRepresentationNeed {
  readonly sourceKey: string
  readonly preferredKind: 'FULL' | 'LINE_RANGE' | 'REFERENCE'
  readonly lineRange?: {
    readonly startLine: number
    readonly endLine: number
  }
  readonly reasonCode: 'DETAIL_REQUIRED' | 'REPRESENTATION_NARROWED' | string
}
```

Exact names may vary.

The important invariant is:

> file-specific interpretation happens outside generic policy; Planner consumes normalized representation needs.

No Pi literals may be added to `packages/context-runtime` production code or tests.

---

## 3.6 Membership and representation transition must be distinct

Current Policy V0 can keep a source active while the representation callback returns a different representation; it currently classifies the source as KEEP.

DS-012 must make the semantic distinction observable.

Required example:

```text
Working Set N
repository/file://src/auth.ts
representation = FULL

Working Set N+1
same source
same admitted SourceVersion
representation = LINE_RANGE 120-180

membership: still active
representation: changed

Decision => REPLACE
reason => REPRESENTATION_NARROWED
```

Another required direction:

```text
Working Set N
LINE_RANGE

Working Set N+1
FULL

Decision => REPLACE
reason => DETAIL_REQUIRED
```

Do not encode these as REMOVE + ADD when the same source membership continues and the representation relationship is known.

`KEEP` is correct only when the prior active representation remains semantically the same representation for the admitted version.

---

## 3.7 SourceVersion changes are not representation-only changes

If the file SourceVersion advances:

```text
repository/file://a.ts v1
→
repository/file://a.ts v2
```

then a representation derived from v1 is stale.

The Planner/representation layer must not report a simple KEEP of the old representation.

DS-012 must produce explicit, explainable behavior when the same sourceKey has a new admitted SourceVersion. A reasonable first behavior is a REPLACE into a fresh representation of v2 with a stable reason such as `SOURCE_VERSION_ADVANCED` / `STALE_REPRESENTATION_REPLACED`.

Exact reason-code naming is experimental, but the semantic change must be observable and deterministic.

---

## 3.8 Pi hints may trigger observation, never establish content truth

CR-002 Pi resource hints use:

```text
repository/file://<path>
```

DS-012 may use those hints as a bounded candidate list for Repository Observer requests.

Correct boundary:

```text
Pi tool/path hint
   ↓ suggests path to observe
Repository Observer
   ↓ establishes truth
Context Universe
```

Incorrect boundary:

```text
Pi read tool result
   ↓
claim canonical repository file content   ❌
```

The integration test/smoke must prove that file-aware representations derive from Observer/materializer truth, not from Pi tool-result payloads.

---

## 3.9 Shadow invariant remains absolute

DS-012 must not alter the actual Pi messages returned from the `context` callback.

For every real model call:

```text
native messages in
        ↓
Canvas observation + repository observation + Shadow planning
        ↓
native messages out unchanged
```

No representation generated by DS-012 may be inserted into the real provider request.

Any live smoke must prove this property or reuse the already accepted byte/semantic fingerprint mechanism.

---

# 4. Required implementation

## 4.1 Add a bounded repository representation provider

Preferred placement: `packages/repository-observer` or another repository-specific integration package that keeps Git/filesystem knowledge outside Runtime core.

It must accept enough exact inputs to materialize one admitted repository SourceVersion, conceptually:

```text
repositoryPath
expectedRepositoryRevision
sourceKey
sourceVersionId
sourceVersionContentHash
representation need
```

It must return an experimental `ContextRepresentation` or a typed fail-closed result.

Minimum operations:

```text
FULL
LINE_RANGE
REFERENCE
```

REFERENCE may not require a file reread if it carries no file-content claims; document that distinction.

FULL and LINE_RANGE must prove exact SourceVersion binding.

Do not persist raw content.

---

## 4.2 Add deterministic line-range semantics

LINE_RANGE must be deterministic and unambiguous.

Required rules:

- 1-based line numbers or another explicit convention — choose one and document it;
- inclusive/exclusive boundaries must be test-locked;
- out-of-range requests fail closed or clamp only if the exact clamping rule is deterministic and documented;
- line-ending handling must be deterministic;
- range derivation metadata must record requested/effective range;
- representation contentHash must derive from the exact representation content, not only from full-file hash + range numbers.

No heuristic range selection is required. The test harness may provide explicit line ranges.

---

## 4.3 Extend normalized PlanningRequest for representation needs

Add the minimum provider-neutral experimental request data needed to select a representation for a source.

Requirements:

- deterministic hashing includes representation needs;
- order normalization prevents equivalent requests from hashing differently where appropriate;
- previous Working Set continuity still validates exactly;
- no repository/Pi literal appears in the core request type;
- missing representation need falls back to the existing safe representation behavior.

Do not add public/persisted schema.

---

## 4.4 Extend the Planner to emit real REPLACE decisions

Required behavior:

### Same source/version, same representation

```text
KEEP
```

### Same source/version, representation changes

```text
REPLACE
```

with explicit reason such as:

```text
REPRESENTATION_NARROWED
DETAIL_REQUIRED
```

### Same sourceKey, admitted SourceVersion advances

Generate a fresh representation and an explicit replacement/staleness decision rather than retaining a stale representation.

### Membership leaves active set

Still use REMOVE.

### Previously removed source becomes active again

Still use REHYDRATE.

Representation transitions must not break the accepted ADD/KEEP/REMOVE/REHYDRATE semantics from CR-003A.

---

## 4.5 Keep representation candidate preparation outside the synchronous Planner loop

The accepted Planner API currently consumes a synchronous representation resolver.

Git/file reads are asynchronous.

Preferred pattern:

```text
async integration/materialization phase
        ↓
Map<sourceVersionId + representation need, ContextRepresentation>
        ↓
synchronous deterministic Planner
```

Do not make the core Planner shell out to Git or import repository-observer merely to avoid a small preparation step.

If an async core Planner is proposed, stop and submit an architecture note first; it is not implicitly authorized.

---

## 4.6 Add file-aware Shadow integration

Extend the experimental Pi Shadow path only enough to prove the file-aware pipeline.

A controlled path may be:

```text
Pi semantic context callback
→ CR-001 message observation
→ CR-002 resource hints
→ bounded path candidate set
→ DS-011 Repository Observer
→ Universe reconciliation
→ representation preparation
→ Policy planning
→ Shadow Working Set / Transition / metrics
→ return native Pi messages unchanged
```

The exact repository path/current revision must come from explicit harness configuration, not from parsing assistant prose.

The integration must be disableable and fail safe for research runs.

Repository observation/materialization failures should degrade to the accepted Shadow behavior without corrupting the native request.

---

# 5. Deterministic policy for DS-012

Do not introduce a scoring model, LLM planner, embeddings, or graph ranking.

Keep CR-003A membership rules unless a small change is strictly necessary for representation semantics.

Representation choice should be deterministic from normalized representation needs.

Suggested priority:

```text
explicit DETAIL_REQUIRED FULL
> explicit LINE_RANGE need
> explicit narrowed REFERENCE
> existing/default representation
```

The exact order may differ if justified by evidence.

Do not equate high authority with FULL representation. Authority is trust/conflict metadata, not a generic verbosity score.

---

# 6. Required tests

Use deterministic unit/integration tests. Numbering below is semantic, not a required Vitest test count.

## A. Representation materialization

1. authoritative AVAILABLE file SourceVersion → FULL representation;
2. FULL representation sourceVersionIds exactly bind the admitted version;
3. FULL contentHash/token estimate deterministic for same source version;
4. materialized content hash mismatch vs admitted SourceVersion fails closed;
5. revision mismatch before materialization fails closed;
6. post-materialization revision change fails closed;
7. dirty revision remains unsupported/fail-closed;
8. binary/too-large source cannot become FULL/LINE_RANGE;
9. REFERENCE remains possible without claiming file text.

## B. LINE_RANGE

10. explicit line range produces exact deterministic content;
11. same range + same SourceVersion → same representation id/hash;
12. different range → different representation id/hash;
13. derivation metadata records exact range;
14. invalid/out-of-range behavior is deterministic and test-locked;
15. LINE_RANGE retains the full file SourceVersion provenance.

## C. PlanningRequest / determinism

16. representation needs participate in planningRequestHash;
17. same normalized request + Universe + policy → same Working Set / transition hash;
18. no Pi/repository-specific literals are required by core policy tests;
19. missing representation need preserves safe existing behavior.

## D. Representation decisions

20. initial active FULL → ADD;
21. FULL → same FULL → KEEP;
22. FULL → LINE_RANGE on same SourceVersion → REPLACE(REPRESENTATION_NARROWED);
23. LINE_RANGE → FULL → REPLACE(DETAIL_REQUIRED);
24. source stays active while representation changes — no REMOVE+ADD pair;
25. source becomes inactive → REMOVE still works;
26. removed source later returns → REHYDRATE still works;
27. same sourceKey advances SourceVersion → stale old representation not retained;
28. new SourceVersion produces explicit fresh replacement decision.

## E. Authority boundary

29. Pi hint alone cannot produce FULL/LINE_RANGE;
30. Observer AVAILABLE for the same `repository/file://` identity enables representation materialization;
31. tool-result text differing from repository truth cannot override Observer-materialized representation;
32. `packages/context-runtime` never shells out to Git or imports repository-observer/Pi types.

## F. Shadow seam

33. file-aware planning runs inside the real Pi semantic context boundary or an equivalent accepted integration seam;
34. actual Pi messages returned to the model are unchanged;
35. repeated calls maintain previous Working Set continuity;
36. at least one file representation REPLACE is recorded in controlled evidence;
37. Native estimate and proposed semantic estimate remain separate metrics;
38. disabling file-aware Shadow integration restores prior/native behavior.

## G. Scope regression

39. no active context rewrite;
40. no public/persistence contract changes;
41. no OpenCode/Codex integration;
42. no CR-004 implementation;
43. no opaque LLM summarization;
44. no repository crawler/index/AST dependency unless separately approved.

---

# 7. Required smoke / evidence

## 7.1 Credential-free temporary Git smoke

Required.

Build a real temporary Git repository with a small source file and prove a deterministic sequence such as:

```text
Source v1 observed
→ FULL representation
→ LINE_RANGE representation
→ FULL representation
→ file changes / Source v2 observed
→ fresh representation for v2
```

Evidence must show:

- exact sourceKey/version IDs or shortened hashes;
- representation kinds;
- representation token estimates;
- KEEP vs REPLACE decisions;
- no raw secret material.

## 7.2 Real Pi + replaceable model Shadow smoke

Required if the existing accepted Pi harness remains operational without a deep fork.

Use the same low-cost replaceable provider pattern as CR-001/CR-003A.

The smoke should produce at least one authoritative repository file Source and at least one file representation in a Shadow Working Set.

Preferred controlled evidence includes at least one `REPLACE` transition. If a natural live task does not trigger one, do not manipulate production logic solely for the smoke; deterministic integration tests + temporary-Git smoke may carry the REPLACE proof, while live Pi smoke proves real-seam interoperability.

Must record:

```text
model-call sequence
Universe sequence/hash
repository source status/version
selected representation kind
data source: Observer/materializer
Native context estimate
proposed semantic token estimate
ADD / KEEP / REMOVE / REPLACE / REHYDRATE counts
previousWorkingSetId continuity
```

Actual model request remains native.

---

# 8. Metrics

Add/extend Shadow metrics to make file-aware behavior measurable.

At minimum:

```text
FULL count
LINE_RANGE count
REFERENCE count
REPLACE count
representation token delta
FULL -> LINE_RANGE token savings
LINE_RANGE -> FULL re-expansion
stale representation replacements
materialization failures by reason
sources removed then rehydrated
Native estimate
proposed semantic estimate
Working Set churn
```

Do not claim provider token savings from semantic estimates unless the metric scope supports that claim.

---

# 9. Required verification document

Create:

```text
docs/verification/context-runtime-cr-003b-file-aware-shadow-planner.md
```

It must include:

1. branch + final HEAD;
2. modified files;
3. representation-provider architecture;
4. exact SourceVersion/materialization binding strategy;
5. representation kinds actually exercised;
6. PlanningRequest changes;
7. REPLACE semantics;
8. source-version freshness behavior;
9. Pi hint vs Observer authority evidence;
10. deterministic test evidence;
11. credential-free Git smoke;
12. real Pi Shadow smoke or documented stop condition;
13. Native vs proposed metric scope;
14. known limitations;
15. proposal mismatches;
16. explicit CR-004 non-authorization statement.

Do not self-declare CR-003B accepted.

---

# 10. Handoff contract

Return exactly enough evidence for lead review:

1. Branch & HEAD, pushed, clean tree.
2. Modified file list.
3. Representation kinds implemented/exercised.
4. Repository representation-provider design.
5. Exact SourceVersion ↔ materialized content binding proof.
6. PlanningRequest additions and hash behavior.
7. REPLACE decision behavior and tests.
8. FULL ↔ LINE_RANGE evidence.
9. SourceVersion advance/stale representation evidence.
10. Pi hint vs Observer authority evidence.
11. Test/typecheck/pnpm check results.
12. Temporary-Git smoke evidence.
13. Real Pi Shadow smoke evidence.
14. Metrics snapshot.
15. Known limitations / proposal mismatches.
16. Scope confirmation.
17. Explicit statement that CR-004 was not started and no real model context was rewritten.

---

# 11. Stop conditions

Stop and request architecture review before implementation if any of these become necessary:

- changing v0.2 public `ContextSnapshot`, `ExecutionRequest`, or RepositoryRevision contracts;
- adding production persistence/schema;
- changing the Planner core to async because Git reads cannot be prepared externally;
- introducing a language server/AST/symbol index as a prerequisite;
- requiring full repository crawling/indexing;
- introducing opaque LLM summarization;
- modifying Pi's real model messages;
- depending on provider-specific message classes inside `context-runtime`;
- silently supporting dirty revisions by reading baseCommit only;
- starting OpenCode/Codex work;
- starting CR-004.

---

# 12. Acceptance gates

Lead architecture acceptance requires all of the following:

### Source truth

- file representations bind to exact admitted Repository SourceVersion(s);
- materialization cannot silently cross repository revision/version boundaries;
- Pi hint remains candidate discovery only, never file truth.

### Representation

- FULL is real, deterministic and provenance-preserving;
- LINE_RANGE is real, deterministic and provenance-preserving;
- REFERENCE remains available as a cheap representation;
- stale representations are detectable and not silently reused.

### Planner semantics

- membership vs representation change is observable;
- real REPLACE decisions occur for representation changes;
- ADD/KEEP/REMOVE/REHYDRATE regressions remain locked;
- same normalized inputs produce deterministic hashes/output.

### Shadow safety

- real Pi/native model context remains unchanged;
- no active rewrite path is added;
- file-aware metrics are semantic Shadow metrics only.

### Architecture

- Runtime core stays provider-neutral and Git-free;
- no crawler/indexer/public schema/persistence expansion;
- CR-004 remains blocked pending reviewed CR-003B Shadow evidence.

---

# 13. Explicit non-goals

DS-012 does not build:

```text
active context rewriting
production context compaction
LLM summarization
symbol index / semantic code search
repository graph ranking
vector DB / embeddings
whole-repository crawler
background file watcher
production persistence
Context Canvas UI
OpenCode integration
Codex integration
CR-004
```

---

# 14. Expected next gate

If DS-012 is accepted, the lead architect will review the accumulated CR-003 Shadow evidence before deciding whether CR-004 is authorized.

Acceptance of DS-012 does **not automatically imply** CR-004 authorization.

The intended milestone state after DS-012 is:

```text
CR-001  Observation                    ✅
CR-002  Universe                       ✅
CR-003A Deterministic Shadow Planner   ✅
DS-011  Repository Observer            ✅
CR-003B File-aware Shadow Planner      ← DS-012
        ↓
lead review of representative Shadow evidence
        ↓
CR-004 Active Rewrite                  still requires explicit authorization
```
