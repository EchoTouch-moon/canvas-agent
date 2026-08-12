# DS-009 — Context Source Attribution and Shadow Universe Model

## Task owner

DeepSeek V4 Flash — Context Runtime research implementer. The lead architect owns architecture acceptance and any promotion of CR-002 research types into stable contracts.

- **Implementation branch:** `agent/deepseek-ds-009-context-source-universe-shadow`
- **Milestone:** Context Runtime v0.3 research
- **Status:** ASSIGNED / READY AFTER THIS PACKET MERGES
- **Depends on:** CR-001 accepted and PR #14 merged to `main`
- **Implements:** CR-002 from `docs/plan/context-runtime-v0.3-experiment-plan.md`
- **Blocks:** CR-003 Shadow Working Set Planner

> Create the implementation branch from updated `main` only after this task packet is merged. Do not branch DS-009 from the task-packet branch or from the old DS-008 branch.

## Goal

Use the real CR-001 Pi observations to build the minimum provider-neutral, in-memory research model required to answer:

> How can Canvas move from an assembled `AgentMessage[]` observation to trustworthy source attribution and a replayable Shadow Context Universe without inventing false Context Sources?

CR-002 is still **observation + modeling only**. It does not rewrite Pi context and does not implement Working Set selection.

Required conceptual path:

```text
Pi AgentMessage[] at model-call boundary
        |
        v
Observed Context Elements
        |
        v
Source Attribution
   exact / derived hint / unattributed / opaque
        |
        v
Provisional Source Observations
        |
        v
Source Reconciliation
        |
        v
Shadow Context Universe Revision
```

The task succeeds by preserving truth, not by maximizing attribution coverage.

## CR-001 evidence that constrains this task

CR-001 established that:

- Pi `context` is a valid pre-LLM semantic observation seam;
- the observed payload is assembled `AgentMessage[]`, not independent Context Sources;
- model-call observations can be correlated by Runtime Session + monotonic sequence;
- assistant tool calls expose name / id / arguments in the observed message structure;
- tool results expose `toolCallId`, tool name, result content and error semantics;
- the observation metric is scoped to `agent-messages-pre-provider`, not the final provider request;
- raw content is off by default and metadata-only research output is the normal persistence path;
- `packages/context-runtime` is Agent/model neutral.

This mismatch is intentional research input:

```text
AgentMessage[] observation
        !=
ContextSource[]
```

DS-009 must not erase that distinction.

## Read first

Repository architecture and evidence:

- `CONTRIBUTING.md`
- `docs/architecture/context-runtime-v0.3-direction.md`
- `docs/architecture/opencode-v2-context-comparison.md`
- `docs/architecture/decisions/PROPOSAL-030-context-source-universe-model.md`
- `docs/architecture/decisions/PROPOSAL-031-context-working-set-planner.md`
- `docs/plan/context-runtime-v0.3-experiment-plan.md`
- `docs/verification/context-runtime-cr-001-pi-shadow.md`
- `docs/tasks/deepseek/DS-008-pi-context-shadow-observation.md`

Current implementation:

- `packages/context-runtime/**`
- `packages/pi-context-integration/**`
- existing v0.2 Snapshot / `SourceReference` code only for semantic comparison; do not make CR-002 depend on production Snapshot resolution.

Before changing Pi-specific code, verify the pinned/current Pi package still exposes the message/tool structures used by CR-001. If materially different, stop and document the mismatch.

## Central architecture rule

### Do not infer a Context Source merely because text exists in a model message

A message or content block is initially an **Observed Context Element**.

Only create / update a provisional source identity when deterministic evidence supports that attribution.

Examples:

```text
assistant toolCall(id=call-7, name=read, args={ path: "src/auth.ts" })
        |
        +--> exact run event identity: run/tool-call://call-7
        |
        +--> derived resource hint: repository path src/auth.ts

subsequent toolResult(toolCallId=call-7, ...)
        |
        +--> exact result-event identity: run/tool-result://call-7
        |
        +--> correlated to tool call call-7
```

The repository path is a **resource hint** unless the adapter can prove the observed result is an authoritative representation of that file state. Do not silently equate a `read` tool result with a canonical `repository/file://...` source; read tools may apply offset/limit/formatting or other transformations.

Likewise, repeated arbitrary assistant/user text must not gain a fake stable source identity based only on content hash.

## Required research vocabulary

Exact public type names are not frozen, but the implementation must preserve four separate concepts.

### 1. Observed Context Element

Represents one model-visible semantic element observed at a model-call boundary.

Conceptually:

```ts
interface ObservedContextElement {
  observationRef: string
  runtimeSessionId: string
  modelCallSequence: number
  messagePosition: number
  blockPosition?: number
  role: string
  elementKind: string
  semanticHash: string
  tokenEstimate?: number
  toolCallId?: string
  toolName?: string
}
```

This is **not** a Context Source.

### 2. Source Attribution

Links an observed element to zero, one or more source/event/resource identities with explicit evidence.

Use a small deterministic attribution vocabulary such as:

```text
EXACT
    stable identity directly exposed by the harness/event

DERIVED_HINT
    deterministic resource/origin hint derived from structured data,
    but not strong enough to claim canonical source content identity

UNATTRIBUTED
    no trustworthy identity can be established

OPAQUE
    content/origin intentionally unavailable to this seam
```

Do not use an LLM to perform attribution in CR-002.

Every attribution must carry a machine-readable reason/method and evidence reference.

### 3. Provisional Source Observation / State

Only attributed elements or explicit fixture/source observers may produce source observations.

PROPOSAL-030 semantics must remain:

```text
AVAILABLE
ABSENT
UNAVAILABLE
```

Important:

> A source missing from `AgentMessage[]` is **not** automatically `ABSENT`.

`ABSENT` requires a source observer that successfully confirms absence. `UNAVAILABLE` requires an attempted source observation that could not establish current state. A source that is outside the Pi `context` seam is simply not observed by that seam.

### 4. Shadow Context Universe Revision

A model-hidden in-memory projection over reconciled provisional source states at a specific model-call / recomposition boundary.

It must be replayable and logically hashable without duplicating all source content.

CR-002 may implement an internal/experimental shape, but must not promote it into a public stable contract or production persistence schema.

## Required implementation

### 1. Refine the CR-001 observation surface without breaking it

Extend the experimental observation model only as needed for source attribution.

Candidate additions may include:

- block-level / element-level descriptors;
- stable tool-call correlation metadata;
- argument hash / result hash;
- first-seen / last-seen model-call references;
- attribution evidence references;
- source/resource hints.

Requirements:

- preserve `estimateScope = agent-messages-pre-provider` semantics;
- keep default durable JSONL metadata-only;
- no raw tool arguments/results by default;
- no Pi-specific types in `packages/context-runtime`.

### 2. Build deterministic Pi attribution

In `packages/pi-context-integration`, derive Observed Context Elements and attribution records from structured Pi data.

At minimum support:

- user message elements;
- assistant text/thinking elements where visible;
- assistant tool-call elements;
- tool-result elements;
- tool-call ↔ tool-result correlation using `toolCallId`;
- image/binary metadata as opaque/bounded elements where applicable.

Do not guess resource identity from free-form assistant text.

For known structured tool arguments, resource hints are allowed when deterministic. Keep them separate from canonical Context Source identity.

### 3. Verify Pi tool lifecycle hooks before deciding whether they are needed

Inspect the current Pi extension/SDK API for tool-call / tool-result lifecycle hooks.

If stable lifecycle hooks provide stronger identity/correlation than reconstructing from `AgentMessage[]`, they may be used in `pi-context-integration` to enrich attribution.

Rules:

- `context` remains the authoritative model-call boundary;
- tool lifecycle hooks are supporting provenance inputs, not a replacement model-call seam;
- no provider-specific HTTP payload becomes Runtime core state.

If reliable correlation requires a Pi fork, stop and write an architecture deviation note.

### 4. Implement in-memory source reconciliation research primitives

Within `packages/context-runtime`, implement only experimental/in-memory primitives required to exercise PROPOSAL-030 rules.

Must support deterministic fixtures for:

```text
first AVAILABLE       -> INITIALIZE
same AVAILABLE hash   -> NO_CHANGE
changed AVAILABLE     -> UPDATE
confirmed ABSENT      -> REMOVE
UNAVAILABLE           -> RETAIN_LAST_KNOWN
```

Requirements:

- stable source key is separate from source version hash;
- admitted versions are immutable;
- `UNAVAILABLE` never becomes `ABSENT`;
- last-known available version remains addressable;
- source reconciliation event is separate from future `ContextTransition`.

Do not add SQL tables.

### 5. Seed a Shadow Universe from neutral Snapshot-like fixture input

CR-002 must prove the semantic distinction between Run-start seed and Run-derived observations without coupling the experimental Runtime package to v0.2 production contracts.

Use a provider-neutral test/adapter input such as:

```text
snapshot seed
  sourceRef/hash/authority/priority/provenance
        |
        v
shadow source version @ universe sequence 0
```

Then apply runtime observations to create later Universe revisions.

The original seed version must remain addressable even when the admitted runtime head advances.

Do not modify `ContextSnapshot`, `SourceReference`, `ContextResolver`, ExecutionRequest v2 or production persistence.

### 6. Produce immutable Shadow Universe revisions

At each selected model-call / recomposition boundary, produce an immutable revision with at least:

- Runtime Session id;
- revision sequence;
- model-call sequence correlation;
- previous revision ref;
- ordered source-head references or equivalent replayable state;
- source reconciliation actions since previous revision;
- logical hash;
- attribution coverage summary.

Avoid copying raw source contents into every revision.

### 7. Measure attribution coverage honestly

For deterministic and live research runs report counts/rates for at least:

```text
EXACT
DERIVED_HINT
UNATTRIBUTED
OPAQUE
```

Also report source candidates by origin, for example:

```text
snapshot seed
run user input/event
tool call
tool result
resource hint
assistant output/evidence
unknown
```

A lower coverage percentage is acceptable if it reflects reality.

Do not convert `UNATTRIBUTED` into a generic fake source to make metrics look better.

### 8. Add deterministic multi-call fixture tests

Credential-free tests must include at least one trace resembling:

```text
Call #1
  user task

Call #2
  same user task
  assistant toolCall(read, call-1, path=a.ts)
  toolResult(call-1, content=A)

Call #3
  prior history
  assistant toolCall(read, call-2, path=a.ts)
  toolResult(call-2, content=B)
```

Tests must prove:

1. repeated observation of the same historical element is correlated rather than treated as a new source version merely because it appears again;
2. tool call/result identity remains stable by `toolCallId`;
3. different result content produces a new immutable result version / event value as designed;
4. derived repository path stays a resource hint unless canonical source semantics are proven;
5. `ABSENT` and `UNAVAILABLE` are exercised through explicit fixture source observations, not message disappearance;
6. Universe logical hash is deterministic;
7. replay from seed + reconciliation events reconstructs the same Universe head state;
8. Snapshot seed and runtime-derived state remain distinguishable;
9. no raw secrets are present in default serialized research output.

### 9. Run one opt-in Pi + DeepSeek enriched shadow smoke

Because CR-002 changes attribution/observation code, rerun the small Pi + DeepSeek smoke when credentials are intentionally available.

The smoke must still return Pi messages unchanged.

Record only metadata and attribution summaries, for example:

```text
Call #5
observed elements: 14
EXACT: 7
DERIVED_HINT: 3
UNATTRIBUTED: 4
OPAQUE: 0
universe sources: 8
reconciliations since previous: 2
```

Do not write raw prompt/tool-result content into committed evidence.

If credentials are unavailable, report `SKIPPED`; deterministic tests remain mandatory.

### 10. Produce CR-002 verification evidence

Create:

```text
docs/verification/context-runtime-cr-002-source-universe-shadow.md
```

It must contain:

- exact Pi package/version tested;
- exact DeepSeek provider/model for live smoke if executed;
- actual observed-element / attribution / reconciliation / Universe architecture;
- deterministic test commands/results;
- live smoke status and metadata-only attribution timeline;
- attribution coverage summary;
- examples of `EXACT`, `DERIVED_HINT`, `UNATTRIBUTED`, `OPAQUE` with no raw secrets;
- examples of `AVAILABLE`, `ABSENT`, `UNAVAILABLE` semantics;
- Universe revision / logical-hash example;
- replay evidence;
- mismatches discovered against PROPOSAL-030;
- fields that appear ready for PROPOSAL-030 revision;
- fields that should remain provisional;
- explicit recommendation: whether CR-003 Shadow Planner has enough trustworthy source-state input to start.

DeepSeek must not self-authorize CR-003.

## Authorized files

Primary scope:

- `packages/context-runtime/**`
- `packages/pi-context-integration/**`
- deterministic fixtures/tests adjacent to those packages
- `docs/verification/context-runtime-cr-002-source-universe-shadow.md`

Status/evidence scope:

- `docs/plan/context-runtime-v0.3-experiment-plan.md` CR-002 evidence/status only
- `docs/tasks/README.md` DS-009 status/evidence only
- `pnpm-lock.yaml` / package-local config only if a justified dependency change is needed

Avoid new dependencies unless necessary. No new database / embedding / graph / provider SDK dependency is expected.

Do not modify without stopping for architecture approval:

- `apps/desktop/**`
- `packages/worker-runtime/**`
- `packages/persistence/**`
- existing `packages/contracts/**` public schemas
- existing `packages/domain/**` public model
- v0.2 ContextSnapshot / SourceReference / ExecutionRequest semantics

## Explicit prohibited scope

DS-009 must **not**:

- modify Pi messages returned from the `context` hook;
- implement Context Working Set selection;
- implement KEEP / ADD / REMOVE / REPLACE / COMPRESS / REHYDRATE as model-context operations;
- implement relevance scoring or ranking;
- use an LLM for source attribution;
- add embeddings/vector DB/graph DB;
- add production SQLite Runtime tables;
- freeze a public Context Runtime SDK/schema;
- redesign ContextSnapshot or ExecutionRequest v2;
- add Desktop/Canvas UI;
- integrate OpenCode;
- integrate Codex Gateway;
- infer `ABSENT` from disappearance in message history;
- treat every message hash as a stable Context Source key;
- claim a repository file source from a transformed tool result without proving canonical semantics.

## Acceptance criteria

1. `packages/context-runtime` remains Pi/OpenCode/Codex/provider neutral.
2. CR-001 pass-through invariant remains true: Pi messages are returned semantically unchanged.
3. Observed Context Element is explicitly distinct from Context Source identity.
4. Deterministic attribution distinguishes `EXACT`, `DERIVED_HINT`, `UNATTRIBUTED`, `OPAQUE` or an architecture-equivalent explicit vocabulary.
5. Tool call/result correlation is stable by structured identity such as `toolCallId`.
6. Free-form text is not used to invent source identity.
7. Source reconciliation implements `AVAILABLE / ABSENT / UNAVAILABLE` correctly with last-known retention on unavailable observations.
8. Snapshot-like seed and runtime-derived source versions remain distinguishable.
9. Shadow Universe revisions are immutable, deterministic/hashable and replayable.
10. Repeated historical messages do not automatically create duplicate source versions.
11. Attribution coverage is measured and reported honestly.
12. Default durable research output remains metadata-only and credential-safe.
13. Credential-free deterministic tests cover reconciliation and replay.
14. `pnpm check` remains green.
15. One opt-in Pi + DeepSeek enriched shadow smoke is attempted when credentials are intentionally available and truthfully reports EXECUTED / SKIPPED / FAILED.
16. Verification report states whether PROPOSAL-030 needs revision before CR-003.
17. CR-003 is not started or self-authorized.

## Stop conditions

Stop implementation and return an architecture note if any occurs:

1. reliable source attribution requires parsing free-form model prose as the primary identity mechanism;
2. stable tool/source correlation requires a deep Pi fork;
3. Pi lifecycle data contradicts the assumed toolCallId correlation model in a way that cannot be represented by a small refinement;
4. a provider-neutral attribution record cannot be produced without leaking Pi/provider-native payload types into `context-runtime`;
5. implementing Source Reconciliation requires changing v0.2 Snapshot/ExecutionRequest/production persistence contracts;
6. Universe replay requires raw secret-bearing prompt persistence;
7. the only way to satisfy `AVAILABLE / ABSENT / UNAVAILABLE` is to mislabel unobserved message content as source state.

Do not silently work around a stop condition.

## Required verification

At minimum:

```bash
pnpm install --frozen-lockfile
pnpm --filter @canvas-agent/context-runtime test
pnpm --filter @canvas-agent/pi-context-integration test
pnpm --filter @canvas-agent/context-runtime typecheck
pnpm --filter @canvas-agent/pi-context-integration typecheck
pnpm check
```

If the enriched live smoke uses the existing command:

```bash
CANVAS_CONTEXT_LIVE_SMOKE=1 \
  pnpm --filter @canvas-agent/pi-context-integration smoke:deepseek
```

Document any changed command exactly. Credentials must use the existing safe environment/Pi auth path and never appear in committed output.

## Execution order

```text
0. Gate check: updated main includes PR #14 + DS-009 packet
        |
        v
1. Re-read CR-001 evidence and verify current Pi types/hooks
        |
        v
2. Define experimental Observed Element + Attribution vocabulary
        |
        v
3. Enrich Pi structured attribution / toolCallId correlation
        |
        v
4. Implement fixture-backed Source Reconciliation
        |
        v
5. Add neutral Snapshot-like seed adapter/input
        |
        v
6. Build immutable Shadow Universe revisions + replay
        |
        v
7. Add deterministic multi-call attribution/reconciliation tests
        |
        v
8. Run pnpm check
        |
        v
9. Attempt enriched Pi + DeepSeek shadow smoke
        |
        v
10. Write CR-002 verification report
        |
        v
11. Push branch and hand off for architecture review
```

## Required final handoff

Return exactly:

1. branch name and commit SHA;
2. modified file list;
3. dependency/package changes;
4. architecture summary in five bullets maximum;
5. exact verification commands/results;
6. one metadata-only multi-call attribution timeline;
7. attribution coverage summary (`EXACT / DERIVED_HINT / UNATTRIBUTED / OPAQUE` or approved equivalent);
8. one Source Reconciliation example for each `AVAILABLE` change, `ABSENT`, and `UNAVAILABLE`;
9. one Universe revision + logical-hash/replay example;
10. live DeepSeek smoke status: EXECUTED / SKIPPED / FAILED;
11. mismatches with PROPOSAL-030 and recommended proposal changes;
12. fields recommended for promotion vs fields remaining provisional;
13. unresolved risks;
14. explicit scope-deviation statement;
15. confirmation that Pi messages remained unchanged and no Working Set rewrite occurred;
16. recommendation on whether CR-003 has sufficient trustworthy input — recommendation only, not authorization.

DeepSeek must not mark CR-002 accepted and must not start CR-003. The lead architect reviews CR-002 evidence and decides whether PROPOSAL-030 should be revised and whether CR-003 may begin.
