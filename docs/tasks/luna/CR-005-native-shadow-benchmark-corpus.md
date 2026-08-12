# CR-005 — Native + Shadow Benchmark Corpus

## Task owner

GPT-5.6 Luna — Context Runtime benchmark / research implementer.

- **Implementation branch:** `agent/luna-cr-005-native-shadow-corpus`
- **Milestone:** Context Runtime v0.3 research
- **Task type:** reproducible benchmark corpus + Native/Shadow evidence
- **Status:** ASSIGNED / READY AFTER THIS PACKET MERGES
- **Depends on:** CR-001, CR-002, CR-003A, DS-011, CR-003B accepted; DS-013 Go/No-Go review accepted; PR #24 merged
- **Base when authorized:** reviewed `main` after this task packet merges

The lead architect owns the later Go/No-Go decision. This packet does **not** authorize CR-004 implementation or any Active/Dynamic context rewrite.

---

# 1. Why this task exists

DS-013 reached the following evidence-based decision:

```text
CR-004 implementation      NO_GO
First Active experiment    NO_GO
First blocking dependency  BUILD_NATIVE_SHADOW_CORPUS_FIRST
```

The architecture and Shadow mechanics are already strong enough to test, but the repository does not yet contain a representative, repeatable coding-task corpus. Existing live evidence is integration smoke evidence only.

CR-005 must close that evidence gap without changing the model's real context.

The question is not:

> Can Canvas make a smaller hypothetical Working Set?

The question is:

> Across representative coding tasks, what does Native behavior look like, what would the accepted Shadow policy have changed, and do later actions suggest those Shadow decisions were safe or risky?

This packet builds the evidence needed for the next lead Go/No-Go.

---

# 2. Governing invariants

Read and preserve the accepted architecture.

The benchmark comparison is:

```text
A. Native
   Pi native semantic context
   no Canvas planning required for the result

B. Shadow
   exact same task / repository revision / model / tool policy / budget
   Canvas observes, reconciles Universe, computes Working Set + decisions
   model still receives the ORIGINAL Pi messages unchanged
```

No Dynamic/Active variant exists in this packet.

The following must remain true:

```text
Native provider request == Pi native behavior
Shadow provider request == Pi native behavior
Shadow planning output   != provider request rewrite
```

Do not introduce a renderer, payload rewrite, message filtering or model-facing context mutation.

---

# 3. Required reading

Before implementation, read:

- `CONTRIBUTING.md`
- `docs/architecture/context-runtime-v0.3-direction.md`
- `docs/architecture/decisions/PROPOSAL-030-context-source-universe-model.md`
- `docs/architecture/decisions/PROPOSAL-031-context-working-set-planner.md`
- `docs/plan/context-runtime-v0.3-experiment-plan.md`
- `docs/verification/context-runtime-cr-003-shadow-go-no-go.md`
- `docs/verification/context-runtime-cr-003b-acceptance.md`
- `docs/verification/context-runtime-cr-003b-file-aware-shadow-planner.md`
- `docs/verification/context-runtime-cr-003a-acceptance.md`
- `docs/verification/context-runtime-cr-002-acceptance.md`
- `docs/verification/context-runtime-cr-001-pi-shadow.md`
- `docs/tasks/deepseek/DS-010-shadow-working-set-planner.md`
- `docs/tasks/deepseek/DS-011-repository-observer.md`
- `docs/tasks/deepseek/DS-012-file-aware-shadow-planner.md`
- `docs/tasks/deepseek/DS-013-shadow-evidence-go-no-go-review.md`

Inspect actual code/tests in:

- `packages/context-runtime/**`
- `packages/repository-observer/**`
- `packages/pi-context-integration/**`

Do not infer benchmark semantics from documentation when code can verify them.

---

# 4. Scope

## 4.1 Authorized

You may:

- add a research-only benchmark corpus/harness;
- add deterministic fixture repositories or fixture generators;
- define machine-readable task manifests;
- define task acceptance oracles;
- run Native and Shadow Pi tasks against a replaceable low-cost provider;
- reuse the accepted Shadow observer/planner exactly as-is;
- add research-only metadata aggregation and report generation;
- add tests for corpus reproducibility, task manifests, oracle correctness and telemetry aggregation;
- write verification/report artifacts;
- update the task board.

Small benchmark-specific adapter code is allowed if it only orchestrates existing Native/Shadow behavior.

## 4.2 Not authorized

Do **not**:

- rewrite any real Pi/model context;
- implement CR-004;
- add an Active renderer;
- alter provider request payloads;
- change Policy V0 to improve benchmark outcomes;
- add LLM-based Planner decisions;
- add SUMMARY / COMPRESS / opaque summarization;
- add SYMBOL / DIFF / AST / LSP / repository indexing as new Runtime capability;
- add OpenCode/Codex integration;
- change production persistence schema;
- change public v0.2 `ContextSnapshot`, `ExecutionRequest` or `RepositoryRevision` contracts;
- claim provider token savings from unlike metric scopes.

If a representative task cannot be observed with the accepted source model, document the limitation instead of widening Runtime scope.

---

# 5. Corpus minimum: six required task categories

The corpus must contain at least one reproducible task in each CR-005 category.

Each task should be small enough for bounded repeated runs, but non-trivial enough to create meaningful context pressure.

## C1 — Localized bug fix

Required shape:

- one primary implementation file;
- one nearby test or oracle;
- minimal discovery required;
- task should normally be solved without broad repository exploration.

Purpose:

- establish a low-context-pressure baseline;
- observe whether Shadow keeps the obvious target stable rather than churning.

## C2 — Multi-file feature change

Required shape:

- change spans at least 3 source files or 2 source files + tests;
- one explicit cross-file contract/dependency;
- acceptance requires all intended files to agree.

Purpose:

- exercise multiple simultaneously relevant sources;
- expose unsafe budget eviction or premature narrowing.

## C3 — Failing-test diagnosis

Required shape:

- initial test suite has a deterministic failure;
- fix requires interpreting failure evidence and locating the responsible implementation;
- oracle is executable tests.

Purpose:

- exercise latest failure evidence;
- observe whether verification context is retained/rehydrated appropriately.

## C4 — Refactor with architectural constraints

Required shape:

- behavior must remain stable;
- an explicit project rule / architectural constraint is part of acceptance;
- at least one tempting implementation would pass a narrow unit test but violate the stated constraint.

Purpose:

- test mandatory/project-rule retention;
- test that local code detail does not crowd out high-protection architectural context.

## C5 — Discovery across unrelated candidate files

Required shape:

- at least 4 plausible candidate files in different locations;
- only a subset is actually relevant;
- task cannot be solved reliably from the first obvious filename alone.

Purpose:

- create a real investigation set;
- make REMOVE / cold decisions and repeated reads measurable.

## C6 — Longer task with a wrong investigative path

Required shape:

- fixture intentionally contains at least one plausible but wrong lead;
- the correct solution requires later evidence to rule that path out;
- run should contain enough semantic calls/tool activity for a source to become cold and potentially relevant again.

Purpose:

- create realistic false-removal / rehydration pressure;
- measure whether a ruled-out source is removed, re-read or rehydrated later.

---

# 6. Every task must be fully reproducible

Each task must have a machine-readable manifest containing at least:

```text
taskId
category
fixtureVersion
repositoryRevision / fixture commit
initialStateHash
promptRef or task text
task acceptance criteria
oracle command(s)
allowed/expected tools
model profile
context strategy (NATIVE | SHADOW)
semantic-call budget
wall-clock budget
expected writable paths (if bounded)
research-data retention policy
```

Preferred additional fields:

```text
tags
difficulty intent
known tempting wrong paths
known relevant paths
known irrelevant candidates
expected architectural rules
```

Do not make hidden evaluator knowledge available to the model during the task.

The evaluator may know correct/wrong paths for post-run analysis; the Agent must only receive the task prompt and normal repository contents.

---

# 7. Fixture strategy

Use reproducible Git-backed fixtures.

Acceptable patterns:

1. committed fixture templates copied into a temp repository and committed deterministically; or
2. a fixture generator that always emits the same tree and exact content hashes.

For every benchmark run, record the exact repository revision used by the Agent.

The same task's Native and Shadow runs must start from byte-identical initial repository state.

Do not use the developer's mutable working tree as the benchmark ground truth.

Do not rely on network access during task execution unless the specific task explicitly requires it (the initial corpus should not).

---

# 8. Acceptance oracle rules

Every task must have an objective oracle.

Preferred oracle hierarchy:

```text
1. executable tests / deterministic script
2. deterministic file/content assertion
3. structural assertion checked by code
4. human review only for a small explicitly identified residual criterion
```

Avoid purely subjective success labels.

A task counts as SUCCESS only if all required acceptance criteria pass.

Record separately:

```text
agent declared success?
objective oracle passed?
regression checks passed?
```

The benchmark report uses the objective oracle, not the Agent's self-assessment, as the primary success signal.

---

# 9. Native / Shadow experimental control

Within a given task comparison, hold constant:

```text
fixture revision
prompt/task specification
model/provider
model options where controllable
tool policy
semantic-call budget
wall-clock budget
acceptance oracle
Pi version
Canvas Runtime commit
```

Change only:

```text
context strategy = NATIVE vs SHADOW
```

Shadow must run the accepted planner and record its hypothetical Working Set, but return the original Pi messages unchanged.

Do not compare different model families inside this packet's primary corpus.

---

# 10. Model/provider and repetition policy

Use one replaceable, low-cost provider/model profile for the primary corpus. The existing DeepSeek provider is acceptable as a **benchmark model provider** if credentials are available; task ownership remains GPT-5.6 Luna.

Do not hardcode credentials.

Preferred bounded live target:

```text
6 tasks
× 2 Native repetitions
× 2 Shadow repetitions
= 24 live runs
```

This gives a minimal view of run-to-run variance while remaining bounded.

If 24 runs are not practical due to credentials, provider availability, cost or rate limits:

- do not silently reduce the evidence claim;
- complete the deterministic corpus/harness/oracles;
- run the largest balanced subset possible;
- report exact completed counts;
- classify the Native/Shadow corpus gate as INCOMPLETE unless every category has at least one Native and one Shadow executed run;
- do not self-authorize CR-004.

A single smoke or one category cannot satisfy this packet.

---

# 11. Run budgets and runaway protection

Every run must be bounded.

At minimum enforce/record:

```text
max semantic model calls
max wall-clock duration
max tool calls or equivalent bounded run limit where supported
provider/model identity
abort reason
```

Choose budgets large enough for C6 to exhibit a wrong path, but small enough to prevent runaway cost.

If the Agent hits the budget, classify the run as budget-exhausted, not task success.

---

# 12. Required telemetry per run

## 12.1 Quality

```text
taskId
mode
runId
objective oracle result
acceptance criteria result
regression result
budget-exhausted flag
final repository revision/diff hash
```

## 12.2 Native behavior

At minimum:

```text
semantic model-call count
observed AgentMessage[] token estimate per call
message/category counts
tool-result counts
tool call counts/file-read counts where observable
repeated reads/searches
```

Keep the accepted scope label:

```text
agent-messages-pre-provider
```

Do not call this provider-billed context.

## 12.3 Shadow behavior

Per call record:

```text
Universe sequence/hash
Working Set id/hash
planningRequestHash
proposed semantic token estimate
Working Set item count
representation-kind counts
ADD count
KEEP count
REMOVE count
REPLACE count
REHYDRATE count
reason codes
materialization failure count/reasons
```

Where available also record:

```text
representation token delta
churn
source-version advance replacements
```

## 12.4 Cross-call evidence

The corpus aggregator must derive at least:

```text
rehydrated within 1 call
rehydrated within 3 calls
rehydrated within 5 calls
same source/file re-read after REMOVE
same source/file re-searched after REMOVE
sources removed and never needed again
sources removed and later needed again
FULL -> LINE_RANGE
LINE_RANGE -> FULL
SourceVersion-advance REPLACE
```

Do not automatically label every re-read/rehydration as a causal false removal. Preserve it as a **false-removal candidate** for review.

---

# 13. False-removal review

For every false-removal candidate, record enough evidence to inspect:

```text
sourceKey
removal call
removal reason
next access / rehydrate call
call distance
what new evidence changed relevance
whether the source was directly re-read
whether the task still passed
```

Classify conservatively:

```text
USEFUL_REMOVAL
POSSIBLE_FALSE_REMOVAL
LIKELY_FALSE_REMOVAL
INDETERMINATE
```

The classifier may be deterministic rules + human review notes. Do not use a second LLM as an authoritative causal judge in this packet.

---

# 14. Corpus-level summary metrics

Produce per-task and aggregate summaries.

## Quality

```text
Native success rate
Shadow-run underlying task success rate
oracle pass count
budget exhaustion count
```

Because Shadow does not change real context, Native and Shadow task quality should normally be similar; differences reveal stochastic/provider variance or instrumentation bugs, not benefits of the Shadow plan.

## Context / planning

```text
average and peak native observed-message estimate
average and peak proposed semantic Working Set estimate
Working Set churn
REMOVE / REPLACE / REHYDRATE counts
representation-kind distribution
rehydrate-within-1/3/5 counts
read-after-remove count
materialization failures
stale representation replacement count
```

Never compute:

```text
(native estimate - proposed estimate) / native estimate
```

and label it provider token savings. Their scopes are not identical.

## Efficiency

Where safely observable:

```text
tool calls
file reads
repeated reads
searches
run duration
provider cost only if provider exposes trustworthy usage
```

Provider cost is optional and must be clearly sourced.

---

# 15. Determinism and replay checks

The benchmark harness itself must be deterministic where expected.

Tests must prove:

- same task manifest generates byte-identical fixture initial state;
- same oracle on the same final state gives the same result;
- Native/Shadow paired runs start from the same fixture revision;
- run ids do not affect fixture content or planning input semantics;
- Shadow planner replay over saved normalized metadata produces the same Working Set/transition identity when inputs are identical;
- corpus aggregation order does not change aggregate results.

Do not require stochastic model output itself to be identical across repetitions.

---

# 16. Security / data-retention policy

Benchmark data must remain research-safe.

Requirements:

- no API keys or auth headers in committed artifacts;
- no provider credential files copied into fixtures;
- raw provider payload retention remains off by default;
- committed corpus fixtures contain only synthetic / repository-approved test content;
- durable run reports prefer hashes, counts, paths and bounded metadata;
- if model text/output must be retained for debugging, keep it gitignored unless explicitly reviewed;
- clearly identify any local-only trace paths in the verification report.

---

# 17. Expected repository shape

Exact layout is not frozen, but prefer a clear research-only boundary such as:

```text
research/context-benchmarks/
  README.md
  corpus/
    C1-.../
    C2-.../
    ...
  manifests/
  runner/
  reports/
```

or an equivalent package if workspace conventions make that cleaner.

The important constraints are:

- corpus definitions are versioned;
- live traces are not blindly committed;
- benchmark code is not mixed into production Runtime logic;
- task fixtures are easy to reproduce on another machine.

Do not create a large new framework if a small research harness is sufficient.

---

# 18. Required implementation tests

At minimum add tests for:

### Corpus manifests

- exactly six required categories exist;
- each manifest has required fields;
- task ids unique;
- every oracle is resolvable;
- each fixture has an exact revision/hash.

### Fixture reproducibility

- rebuild twice → same initial tree/hash;
- Native and Shadow setup → same initial revision.

### Oracle correctness

For each task:

- initial broken/incomplete state fails the task oracle where appropriate;
- known-good reference solution/state passes;
- unrelated change cannot accidentally pass a weak oracle.

### Telemetry aggregation

- ADD/KEEP/REMOVE/REPLACE/REHYDRATE counts aggregate correctly;
- rehydrate-within-1/3/5 computed correctly;
- read-after-remove candidate detection works;
- no rehydration is fabricated from first-time ADD;
- representation transitions preserve source identity.

### Native/Shadow separation

- Native execution does not require Shadow planner output;
- Shadow observer returns original messages unchanged;
- benchmark mode cannot select ACTIVE/DYNAMIC;
- no benchmark config can enable provider request rewriting.

---

# 19. Credential-free validation before live runs

Before spending provider calls, run a fully credential-free validation that proves:

```text
all six fixtures build
all six manifests validate
all six initial states match expected hashes
all six oracles behave correctly on known bad/good states
Native/Shadow setup parity holds
aggregation fixtures produce expected metrics
```

The corpus must be reviewable even when no provider credential is present.

---

# 20. Live execution protocol

When credentials are available:

1. freeze current benchmark harness commit;
2. freeze provider/model profile;
3. for each task create a fresh fixture workspace from the manifest revision;
4. run Native repetitions;
5. recreate fresh byte-identical fixture workspaces;
6. run Shadow repetitions;
7. run objective oracle after every run;
8. write metadata report/traces to a gitignored research-output path;
9. aggregate only after all selected runs complete;
10. record aborted/missing runs explicitly.

Do not hand-edit a failed workspace and then count the edited state as a benchmark run.

---

# 21. Required output artifacts

Create at least:

```text
docs/verification/context-runtime-cr-005-native-shadow-corpus.md
```

It must include:

1. branch + final HEAD;
2. corpus layout;
3. six task definitions + category mapping;
4. exact fixture revisions/hashes;
5. acceptance oracle for each task;
6. provider/model/run-budget configuration;
7. exact Native/Shadow run counts per task;
8. per-task quality summary;
9. per-task context/planning summary;
10. aggregate quality/context metrics;
11. REMOVE/REHYDRATE/REPLACE evidence;
12. rehydrate-within-1/3/5 data;
13. read-after-remove / false-removal candidates;
14. representation transition evidence;
15. materialization failure evidence;
16. known stochastic/provider variance;
17. metric-scope statement;
18. credential/data-retention confirmation;
19. exact commands executed;
20. explicit corpus readiness verdict.

Corpus readiness verdict vocabulary:

```text
READY_FOR_GO_NO_GO
PARTIAL_CORPUS
HARNESS_ONLY
INVALID
```

Only use `READY_FOR_GO_NO_GO` if all six categories have at least one completed Native and one completed Shadow run with valid objective oracle results, and the corpus/reports are reproducible.

---

# 22. What this task may conclude

Luna may conclude:

```text
READY_FOR_GO_NO_GO
```

but must **not** conclude:

```text
CR-004 authorized
Active rewrite safe
Dynamic better than Native
provider token savings proven
```

Those are later lead decisions / experiments.

If the corpus exposes an obvious Planner weakness, record it as evidence. Do not tune Policy V0 inside CR-005 unless the lead explicitly opens a separate policy-correction packet.

---

# 23. Stop conditions

Stop and surface the issue rather than widening scope if:

- representative corpus construction requires production contract changes;
- Pi Native and Shadow cannot be held behaviorally identical;
- objective oracles cannot be made deterministic for a task category;
- fixture reproducibility requires network state;
- benchmark runner would need Active/model-request rewriting;
- accepted Planner policy must be changed merely to make metrics look better;
- provider/model cannot be held fixed enough to interpret comparisons;
- live cost/rate limits make the requested balanced corpus infeasible.

A truthful partial corpus is preferable to an invalid comparison.

---

# 24. Acceptance gate for this packet

Architecture review should accept CR-005 only when:

1. all six required categories have deterministic versioned fixtures;
2. all six have objective acceptance oracles;
3. Native and Shadow setup parity is test-locked;
4. no model-facing rewrite exists;
5. corpus telemetry measures REMOVE / REHYDRATE / REPLACE and false-removal candidates;
6. credential-free corpus validation passes;
7. live execution evidence is truthfully classified;
8. all executed runs bind exact model/profile/repository/runtime configuration;
9. committed reports contain no credentials/raw provider secrets;
10. relevant package tests/typechecks and `pnpm check` are green in the supported Node environment;
11. the verification artifact distinguishes Native observed-message estimates from Shadow semantic estimates;
12. Luna does not self-authorize CR-004.

The next lead Go/No-Go occurs only after this packet is accepted and the corpus readiness verdict is `READY_FOR_GO_NO_GO`.

---

# 25. Handoff contract

Return:

1. branch + final HEAD, pushed and clean;
2. modified file list;
3. corpus layout and six task ids;
4. fixture revision/hash table;
5. oracle table;
6. credential-free validation results;
7. Native/Shadow live run matrix;
8. test/typecheck/`pnpm check` results with Node version;
9. quality metrics summary;
10. context/planning metrics summary;
11. false-removal/rehydration candidate summary;
12. representation transition summary;
13. provider/model variance and limitations;
14. corpus readiness verdict;
15. explicit scope confirmation;
16. unresolved blockers or follow-up recommendations.

Do not self-merge. Do not declare CR-004 authorized.
