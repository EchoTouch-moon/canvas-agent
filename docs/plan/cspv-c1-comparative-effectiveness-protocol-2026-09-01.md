# C1 Comparative / Effectiveness Experiment Protocol — Draft

## Decision boundary

| Field | Value |
| --- | --- |
| Status | `DRAFT — LEAD REVIEW REQUIRED` |
| Phase | `C1 Comparative / Effectiveness Design` |
| Purpose | Determine whether Context Runtime lifecycle policy changes real Agent execution relative to Native / unmanaged context |
| Provider execution | `NO_GO` under this document |
| Additional Provider calls while drafting | `0` |
| Treatment implementation | Must pass a separate credential-free readiness gate before live authorization |
| CR-004 Active Rewrite | `NO_GO` |

This protocol follows [CSPV-C0-L1 live evidence](../verification/cspv-c0-l1-live-evidence-2026-09-01.md).
C0 established that the lifecycle machinery and usage seam can be observed in
real Step Plan-backed Pi execution. C1 asks a different question: whether
using lifecycle policy changes outcomes, resource use, or recovery behavior.

This is a research protocol, not a product feature specification and not live
authorization. Exact task fixtures, run identities, budgets, provider binding,
randomization seed, and final adjudication parameters must be frozen in a
separate reviewed run contract before any Provider call.

## 1. Research questions

### RQ1 — Task effectiveness

Does Context Runtime preserve or improve task correctness and task quality
relative to Native / unmanaged context?

### RQ2 — Context efficiency

Does lifecycle policy reduce unnecessary model-visible context and
provider-reported input or total tokens without degrading the task outcome?

### RQ3 — Agent efficiency

Does lifecycle policy change provider calls, tool calls, redundant tool calls,
trajectory length, turn latency, or total wall-clock time?

### RQ4 — Lifecycle quality

Are `REMOVE`, `REHYDRATE`, and supersession decisions timely and well-founded?
How often does later need follow removal, and how often can the runtime restore
the exact required SourceVersion and representation?

### RQ5 — Failure trade-off

Does any context saving introduce recovery cost, cold-context penalty, task
failure, or quality loss? A smaller context is not automatically a better
result.

## 2. Experimental comparison

The only intended primary independent variable is context management strategy.

| Arm | Definition | Role |
| --- | --- | --- |
| `NATIVE` | Pi's model-facing context remains unchanged except for metadata-only observation; no Context Runtime rewrite | Control |
| `RUNTIME` | Context Runtime selects and applies the frozen lifecycle policy at the pre-provider boundary, changing the model-facing semantic context while preserving required native/system/tool/provider-native structures | Treatment |

The current C0 Shadow mode is observational-only and is **not** a valid C1
treatment. A C1 treatment leg must prove that the provider-bound model input
actually reflects the selected Working Set for at least the eligible lifecycle
transitions. An observer-only run must be labeled `TREATMENT_INACTIVE` and
excluded from effectiveness pooling.

The following variables are held fixed within a task stratum:

- task prompt, fixture snapshot, corpus manifest, and objective/evaluator;
- provider, model, model parameters, tools, Agent runtime, Node runtime, and
  execution mode;
- per-leg hard call/wall-clock budgets and evidence schema;
- task order randomization seed and analysis rules;
- security, writable-path, repository, and provider-fallback policy.

Each leg uses a fresh single-use identity and isolated fixture state. No leg
may resume, retry until success, switch Provider, or silently fall back from
`RUNTIME` to `NATIVE`. A treatment transport or context-replacement failure is
an infrastructure/evidence outcome, not a Native observation.

## 3. Corpus and pairing

The exact task set is not selected by this protocol. Before live execution,
the run contract must freeze a task manifest with immutable fixture and
objective hashes. The minimum corpus should contain task strata that expose:

1. localized investigation with plausible distractors;
2. multi-file or multi-source reasoning;
3. failure diagnosis and recovery;
4. phase or representation changes that can create cold-context demand.

C0 E1–E4 may inform task selection and lifecycle instrumentation, but their
queued lifecycle-event adapter must not be presented as natural model event
discovery or as a substitute for a C1 task corpus.

Each task/repetition forms one matched pair:

```text
same frozen task + same fixture snapshot + same model/provider
        ├── NATIVE leg
        └── RUNTIME leg
```

For each task stratum with planned `N_pairs`, arm order MUST be balanced. If
`N_pairs` is even, `N_pairs / 2` pairs use `NATIVE → RUNTIME` and
`N_pairs / 2` pairs use `RUNTIME → NATIVE`; if `N_pairs` is odd, the two order
counts MUST differ by at most one. A pre-registered seed randomizes which
repetition receives each order within those quotas; the seed does not create
the balance. The seed, generated order, task hash, fixture hash, and runtime
fingerprint are recorded in metadata. If a task's execution is stateful, the
two legs use independent isolated copies of the same snapshot; the analysis
must not treat cross-leg filesystem state as a treatment effect.

If the provider exposes sampling parameters, they are fixed and recorded. If
it does not expose or honor a parameter, that fact is recorded as a nuisance
variable; the protocol does not assume deterministic model output.

## 4. Metrics and evidence chain

### 4.1 Primary outcomes

The run contract must pre-register the following primary outcome families:

| Family | Metric | Source |
| --- | --- | --- |
| Outcome | task success and, where applicable, rubric-based task quality | frozen objective/evaluator |
| Provider usage | input, output, cache-read, cache-write, and total tokens | provider-reported `message_end` usage |
| Agent cost in time | per-turn latency and total wall-clock | runner/runtime timestamps |

Provider-reported token values are required evidence under the frozen
[C0-L1 usage contract](./cspv-c0-provider-usage-contract-2026-09-01.md).
Monetary cost is not inferred from local estimates or configured zero pricing;
`UNAVAILABLE` remains a valid cost state unless a separately reviewed cost
contract exists.

### 4.2 Secondary behavior and lifecycle metrics

- provider calls and assistant responses;
- tool calls, tool-result count, repeated reads, repeated searches, and
  redundant tool calls;
- retained context size/representation and model-visible context fingerprint;
- `ADD`, `KEEP`, `REMOVE`, `REHYDRATE`, and supersession counts;
- later-need distance from `REMOVE` to `REHYDRATE`;
- false-removal candidates, with originating removal and later-need evidence;
- exact SourceVersion/representation recovery, orphan rehydrates, wrong-version
  rehydrates, mandatory evictions, and unexplained decisions;
- usage completeness, evidence-join completeness, replay mismatches, and
  evidence-write failures.

### 4.3 Effect chain

Every eligible model call must be joinable without persisting message content:

```text
task / pair / repetition / arm
        ↓
model-visible context fingerprint + Working Set / transition metadata
        ↓
provider request identity + reported usage
        ↓
tool/model trajectory + per-turn latency
        ↓
task outcome and lifecycle adjudication
```

The metadata record must make the join explicit through stable run, pair,
turn, and model-call identifiers. Content hashes and descriptors may be
stored; prompts, responses, raw provider payloads, credentials, and
authorization headers are not evidence fields.

### 4.4 Derived lifecycle metrics

#### Removal Precision

```text
adjudicated correct removals / all eligible removals
```

An adjudicated correct removal requires pre-registered ground-truth or task
oracle support that the removed source was not needed for the remaining task
path. Absence of a later read alone is insufficient.

#### Rehydration Recovery Rate

```text
successful exact recoveries after a valid rehydrate demand
    / all valid rehydrate demands
```

The numerator requires the originating `REMOVE` relation, correct
SourceVersion/representation restoration, and the pre-registered downstream
recovery condition. A normal first `ADD` is not a rehydrate.

#### Cold Context Penalty

The run contract MUST pre-register a cross-arm alignment anchor for every
eligible cold-context comparison. In the treatment arm, anchor `A` is the
task/model boundary immediately before the eligible `REMOVE`, and anchor `B`
is a predefined downstream recovery or task-phase boundary. The Native arm
uses the same task-semantic `A` and `B` anchors; it does not invent
Native-side `REMOVE` or `REHYDRATE` events. Anchor detection and any tie-break
rule MUST be frozen before live execution.

For each matched pair with a valid `A:B` interval in both arms, calculate the
same interval delta, for example:

```text
Cold Context Penalty_tokens
  = RUNTIME tokens[A:B] - NATIVE tokens[A:B]

Cold Context Penalty_tools
  = RUNTIME tool calls[A:B] - NATIVE tool calls[A:B]

Cold Context Penalty_latency
  = RUNTIME latency[A:B] - NATIVE latency[A:B]
```

The interval may also report recovery failures and recovery actions under the
pre-registered endpoint definitions. If `A` or `B` cannot be identified in
both arms, or the interval is ambiguous without a frozen tie-breaker, the
metric is `NOT_ESTIMABLE`, not zero. No trajectory segment may be selected
post hoc merely to make the metric computable.

## 5. Repetition, randomization, and statistics

Throughout this protocol, `N_pairs` means matched pairs, not per-arm runs;
each pair contains exactly one `NATIVE` leg and one `RUNTIME` leg. The default
minimum design / feasibility floor is **8 matched pairs per task stratum**,
i.e. 8 `NATIVE` legs and 8 `RUNTIME` legs. A confirmatory sample size, if
claimed, MUST instead be frozen in the run contract using a pre-registered
power, sensitivity, or feasibility analysis. This floor is a design target,
not live authorization.

- Repetition count is fixed before execution; no retry-until-PASS behavior.
- The committed seed randomizes arm assignments within the pre-registered
  AB/BA quotas; balance is a quota, not a consequence of the seed.
- A task failure with complete evidence remains a valid outcome observation.
- An infrastructure/evidence failure invalidates that matched pair for the
  affected endpoint, is reported in attrition, and is never relabeled as a
  task failure.
- No outlier is silently deleted. Raw pair values, exclusions, and reasons
  are reported.

The analysis MUST report two distinct quantities:

- **Conditional effectiveness:** the paired treatment difference among matched
  pairs whose required evidence is valid for that endpoint.
- **Operational reliability:** execution success and infrastructure/evidence
  attrition for each arm across all attempted pairs.

The run contract MUST pre-register a treatment-specific attrition threshold.
If `RUNTIME` infrastructure attrition exceeds that threshold, the overall
adjudication MUST NOT be `BETTER`, even when conditional effectiveness looks
favorable. The frozen rule may classify that result as `WORSE` or
`INCONCLUSIVE`, but it must not hide the attrition by reporting only the
conditional estimate.

The analysis must report paired deltas, not only arm-level means:

- binary outcomes: paired success/failure counts and exact paired analysis
  where applicable;
- continuous metrics: per-pair delta, median, IQR, and a pre-registered exact
  paired permutation/sign-flip test where the sample size permits;
- task-stratified results first, followed by any pooled result with the
  stratification rule stated in advance;
- effect size and uncertainty, not only a p-value.

Before live execution, the run contract MUST pre-register either (a) one
primary efficiency endpoint with an ordered secondary hierarchy, or (b) a
multiple-endpoint multiplicity-control rule, such as gatekeeping, Holm, or a
predefined family-wise paired permutation rule. The endpoint family, direction,
threshold, test, and decision rule are frozen before observing outcomes.
Exploratory endpoints cannot independently trigger `BETTER`, and no endpoint
may be selected after the fact because it produced the most favorable result.

No single repetition, cache pattern, provider burst, or latency observation
is sufficient to establish effectiveness. Failure to reject no difference is
not evidence that the two strategies are equivalent.

## 6. Adjudication rules

The run contract must apply these decision classes in order:

1. `HARNESS_CONTRACT_FAILURE` / `INFRASTRUCTURE_FAILURE` — evidence cannot
   support an effectiveness interpretation; exclude the affected endpoint or
   pair and preserve the failure.
2. `WORSE` — a safety/evidence invariant fails, or treatment outcome falls
   beyond the pre-registered non-inferiority margin, or the treatment incurs a
   material resource/recovery regression without an outcome benefit.
3. `BETTER` — task outcome is non-inferior, lifecycle safety/evidence gates
   pass, treatment operational reliability meets its pre-registered threshold,
   and at least one confirmatory efficiency endpoint improves by its frozen
   threshold without an unacceptable regression in the other primary
   endpoints. The endpoint hierarchy or multiplicity rule above applies.
4. `TRADE-OFF` — outcome is non-inferior but gains and losses coexist, such as
   lower input tokens with materially higher recovery latency or tool cost.
5. `INCONCLUSIVE` — matched evidence is insufficient, treatment is inactive,
   confidence/decision bounds cross the pre-registered decision region, or
   endpoint coverage is too incomplete to distinguish the alternatives.

Token reduction alone cannot produce `BETTER`. A lower token volume with more
failed tasks, rehydration cost, redundant tools, or latency is a trade-off or
`WORSE` according to the frozen thresholds.

The exact task-quality rubric, non-inferiority margin, material-regression
threshold, and minimum paired coverage must be written into the run contract
before live execution; they cannot be selected after inspecting outcomes.

## 7. Mandatory pre-live gates

```text
C1 protocol review (zero Provider)
        ↓
immutable task/fixture manifest + analysis contract
        ↓
credential-free Native/RUNTIME context-replacement readiness
        ↓
Lead review and separate live authorization
        ↓
fresh randomized paired live runs
        ↓
sanitized evidence synthesis
        ↓
effectiveness adjudication
```

The credential-free readiness gate must at minimum prove:

- Native preserves the original model-facing context;
- RUNTIME changes the model-facing semantic context when the frozen policy
  requires it;
- system/developer/tool/provider-native structures are preserved according
  to the reviewed boundary;
- no treatment failure silently falls back into the control arm;
- transition, usage, tool, latency, outcome, replay, and evidence-write joins
  are complete;
- kill-switch, single-use identity, hard call/wall-clock budgets, and
  exception-safe finalization remain fail-closed.

Passing this gate does not authorize Provider execution. The live matrix
requires a separate decision bound to an exact code revision, task manifest,
provider/model, runtime, repetitions, randomization seed, and budgets.

## 8. Claims boundary

Until C1 comparative data satisfies the adjudication rules, the project must
not claim that Context Runtime:

- improves performance, task success, quality, or reliability;
- reduces tokens or cost;
- reduces redundant tools or latency;
- makes REMOVE decisions correctly;
- eliminates false removal;
- provides causal benefit over Native context.

The strongest claim available after a valid C1 run is conditional and scoped:
the frozen treatment produced the measured paired difference for the specified
task corpus, provider, model, runtime, and repetition design. It does not
generalize beyond those conditions without new evidence.

## 9. Frozen project state and next decision

```text
C0-L1 live evidence acquisition  COMPLETE
C0 implementation/contracts      FROZEN
C1 protocol                      DRAFT / LEAD REVIEW REQUIRED
C1 Provider execution            NO_GO
CR-004 Active Rewrite            NO_GO
Wave A / Wave B                  NO_GO
```

The next decision is review of this protocol and its eventual task/run
contract. No additional C0 repetition is required, and no live experiment may
start merely because this document is written.
