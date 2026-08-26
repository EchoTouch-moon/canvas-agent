# Context Selection Policy Validation — Deterministic Transition Suite

- **Status:** EXECUTED — specification preserved; outcome chain: CSPV-B0 EXECUTED (historical `POLICY_CAPABILITY_GAP`) → CSPV-B1 EXECUTED (`PASS`) → Gate B adjudicated `PASS` → Gate A adjudicated `PASS`
- **Gate:** Phase 2 / Gate B
- **CSPV-B0 run (historical):** [`context-selection-policy-gate-b-run-1.md`](../verification/context-selection-policy-gate-b-run-1.md)
- **CSPV-B1 run:** [`context-selection-policy-gate-b1-run-1.md`](../verification/context-selection-policy-gate-b1-run-1.md)
- **Gate B adjudication:** [`context-selection-policy-gate-b-adjudication.md`](../verification/context-selection-policy-gate-b-adjudication.md)
- **Gate A adjudication (2026-08-27):** [`context-selection-policy-gate-a-adjudication-2026-08-27.md`](../verification/context-selection-policy-gate-a-adjudication-2026-08-27.md)
- **Provider calls:** `0`
- **Runtime mode:** credential-free synthetic traces only
- **Model-facing context:** unchanged; no Pi, OpenCode or Codex live run
- **Depends on:** [`PROPOSAL-032`](../architecture/decisions/PROPOSAL-032-context-eviction-rehydration-policy-experiment.md)
- **Current baseline:** `branch glm/project-review-2026-08-27 @ 8b7d1c6b31ae6bb174afb2567dca4c5c603b6034` (B0/B1 executed at earlier main baselines recorded in their run documents; the Gate A adjudication and program closure were recorded at this baseline)

This task package specifies the deterministic evidence needed before a bounded
Shadow lifecycle canary is considered. It does not change Planner code in the
current documentation task. The synthetic fixtures and oracles were later
materialized and executed provider-free as CSPV-B0/B1; see the execution links
in the status block above.

## 1. Objective

Show, in one replayable synthetic transition chain, that the policy can make
and explain all four basic membership decisions:

```text
ADD → KEEP → REMOVE → REHYDRATE
```

The suite is not intended to prove model quality, token savings or Active
Rewrite value. It is a policy and evidence-integrity gate.

## 2. Synthetic Context Universe

Use stable source keys and immutable versions so the oracle can verify exact
provenance. The following sources are sufficient for the first suite:

| Source key | Initial version | Protection | Role |
| --- | --- | --- | --- |
| `task/spec` | `task-spec:v1` | `MANDATORY` | task instruction; never evict |
| `repo/target` | `target:v1` | `NORMAL` / current target | implementation target |
| `repo/distractor-a` | `distractor-a:v1` | `NORMAL` | plausible but later ruled out |
| `repo/distractor-b` | `distractor-b:v1` | `NORMAL` | second plausible candidate |
| `run/failure-old` | `failure-old:v1` | `NORMAL` | superseded verification evidence |
| `run/failure-new` | `failure-new:v1` | `NORMAL` | current verification evidence |
| `repo/phase-detail` | `phase-detail:v1` | `NORMAL` | investigation-only detail |
| `repo/unavailable` | `unavailable:v1` | `NORMAL` | last-known source whose refresh fails |
| `repo/reopen-a` | `reopen-a:v3` | `NORMAL` | source reactivated by later evidence |

Every representation must include:

```text
sourceKey
sourceVersionId
representationId
representationKind
contentHash/contentRef
provenance
tokenEstimate
```

The suite must not use free-form strings that cannot be traced back to an
immutable SourceVersion.

## 3. Synthetic trace event vocabulary

The trace driver should express task evolution without a provider:

```text
INITIALIZE_UNIVERSE
PLANNING_BOUNDARY
CURRENT_TARGET
DEPENDENCY_DISCOVERED
FAILURE_OBSERVED
SOURCE_RULED_OUT
SOURCE_SUPERSEDED
PHASE_CHANGED
BUDGET_PRESSURE
SOURCE_REFRESH_UNAVAILABLE
DETAIL_REQUESTED
SEARCH_HIT_AFTER_REMOVE
READ_AFTER_REMOVE
```

Each event must include a sequence, source/evidence references where
applicable, and the Universe revision used by the next planning boundary.
Events are inputs to the Planner; expected decisions are oracle output and
must not be injected into the input trace.

## 4. Required scenarios

### S1 — Distractor elimination

Purpose: prove that a normal, clearly ruled-out candidate can leave the active
Working Set while remaining recoverable.

```text
1. Initialize task/spec, repo/target, distractor-a and distractor-b.
2. Add target and both plausible candidates.
3. Emit SOURCE_RULED_OUT for distractor-a.
4. Plan under a bounded budget.
```

Expected decisions:

```text
ADD repo/target
ADD repo/distractor-a
ADD repo/distractor-b
KEEP task/spec
REMOVE repo/distractor-a / RULED_OUT
```

Required oracle checks:

- `task/spec` remains active and protected;
- `repo/distractor-a` is inactive but remains in the Universe;
- the removed SourceVersion and representation remain recoverable;
- the transition has no unexplained decision.

### S2 — Wrong-path recovery

Purpose: prove first-class rehydration and false-removal candidate evidence.

```text
1. Start with repo/reopen-a:v3 active.
2. Emit SOURCE_RULED_OUT for repo/reopen-a.
3. Plan and record REMOVE.
4. Emit FAILURE_OBSERVED or DEPENDENCY_DISCOVERED referencing repo/reopen-a.
5. Emit DETAIL_REQUESTED for repo/reopen-a.
6. Plan and record REHYDRATE.
```

Expected oracle results:

```text
REMOVE repo/reopen-a / RULED_OUT
later-needed evidence for repo/reopen-a
FalseRemovalCandidate(repo/reopen-a) = present
REHYDRATE repo/reopen-a / NEW_FAILURE_EVIDENCE or DETAIL_REQUIRED
rehydrated version = repo/reopen-a:v3
rehydrated representation provenance = exact
```

The oracle must classify this as a candidate, not as a causal model failure.
The trace must retain the remove transition id, later evidence reference,
rehydration demand and call/transition distance while cold.

### S3 — Mandatory instruction under budget pressure

Purpose: prove that budget arbitration cannot evict protected context.

```text
1. Initialize task/spec as MANDATORY and three NORMAL candidates.
2. Emit BUDGET_PRESSURE below the size of all candidates.
3. Plan repeatedly with deterministic tie-breaking.
```

Expected oracle results:

- `task/spec` remains active;
- `mandatory/pinned eviction = 0`;
- normal candidates may be cooled only with explicit reason codes;
- if the budget is impossible, the Planner emits a structured protection
  conflict or fail-closed result rather than silently evicting the instruction;
- no decision is labeled successful if it violates protection.

### S4 — Superseded verification evidence

Purpose: distinguish replacement of old evidence from unexplained deletion.

```text
1. Add run/failure-old:v1.
2. Emit FAILURE_OBSERVED for run/failure-new:v1.
3. Mark the old failure superseded.
4. Plan.
```

Expected decisions:

```text
ADD run/failure-new / NEW_FAILURE_EVIDENCE
REMOVE run/failure-old / SUPERSEDED
```

Both failure records remain provenance-addressable. The old failure is
inactive, not deleted, and the new failure is active with its own version.

### S5 — Unavailable source / conservative keep

Purpose: prevent observation failure from being misclassified as confirmed
absence or an eviction opportunity.

```text
1. Add repo/unavailable:v1 and retain its last-known version.
2. Emit SOURCE_REFRESH_UNAVAILABLE / REVISION_MISMATCH.
3. Plan with the source still relevant or high-authority.
```

Expected oracle results:

- `repo/unavailable:v1` remains represented or is handled by an explicit
  conservative policy;
- the last-known version and provenance are retained;
- no `SOURCE_ABSENT` reason is emitted from an unavailable observation alone;
- no materialization failure is hidden by replacing the version with a fake
  current representation.

### S6 — Phase shift and detail recovery

Purpose: prove that lifecycle policy can cool detail and later restore it.

```text
1. INVESTIGATE: phase-detail:v1 is active as FULL.
2. PHASE_CHANGED to IMPLEMENT.
3. Remove or narrow phase-detail with an explicit phase reason.
4. PHASE_CHANGED to VERIFY and emit DETAIL_REQUESTED.
5. Rehydrate the exact required detail.
```

Expected oracle results:

```text
REMOVE or representation narrowing / PHASE_IRRELEVANT
REHYDRATE / DETAIL_REQUIRED
exact SourceVersion = phase-detail:v1
representation kind and content hash = expected values
```

## 5. Composite replay chain

The suite must include one composite trace that exercises the critical path in
order. A minimal sequence is:

```text
T0 INITIALIZE_UNIVERSE
T1 PLANNING_BOUNDARY                 → ADD task/spec, target, reopen-a, distractors
T2 PLANNING_BOUNDARY                 → KEEP protected/current items
T3 SOURCE_RULED_OUT reopen-a         → REMOVE reopen-a / RULED_OUT
   SOURCE_RULED_OUT distractor-a     → REMOVE distractor-a / RULED_OUT
T4 FAILURE_OBSERVED reopen-a         → later-needed evidence for removed reopen-a
T5 DETAIL_REQUESTED reopen-a         → REHYDRATE reopen-a:v3
                                      originating REMOVE: T3
T6 SOURCE_REFRESH_UNAVAILABLE         → conservative KEEP for unavailable
T7 FAILURE_OBSERVED failure-new       → REMOVE superseded old failure
T8 BUDGET_PRESSURE                    → protected item remains active
```

The same composite trace, normalized with the same policy version and budget,
must produce the same transition hashes and decision sequence on replay.

## 6. Machine-checkable acceptance criteria

Gate B passes only if all conditions hold:

```text
REMOVE observed                 > 0
REHYDRATE observed              > 0
REMOVE and REHYDRATE            occur in one replayable chain
mandatory/pinned eviction       = 0
unexplained decision            = 0
replay mismatch                 = 0
lost provenance                 = 0
wrong SourceVersion rehydrate   = 0
representation mismatch        = 0
unclassified availability error = 0
unexplained materialization failure = 0
```

Additional required assertions:

- every active-set change has a machine-readable reason code;
- every transition binds to the exact Universe revision used for planning;
- every `REMOVE` retains a recoverable source/version/representation reference;
- every `REHYDRATE` records its originating removal and demand evidence;
- a later read/search/dependency event after `REMOVE` creates auditable
  `FalseRemovalCandidate` evidence without claiming causality;
- `UNAVAILABLE` is never silently converted to `SOURCE_ABSENT`;
- a protection conflict is fail-closed and does not count as successful
  eviction.

## 7. Failure policy

Any of the following is an immediate Gate B failure for the trace under test:

- mandatory or pinned source removed;
- remove transition deletes or loses provenance;
- rehydrate returns a different SourceVersion without explicit request;
- representation is materialized from an unbound or stale version;
- replay changes decisions or hashes;
- availability status is collapsed or misclassified;
- a decision cannot be explained by a stable reason code;
- a failure is hidden by silently falling back to an unverified representation.

Failure evidence must be preserved. It must not be repaired by changing the
expected oracle until the policy interpretation is reviewed.

## 8. Work boundary

This task package authorizes only the following current work:

```text
read existing Context Universe / Planner contracts
define synthetic fixtures and trace inputs
define deterministic expected outcomes and replay hashes
review policy semantics without provider access
```

It does not authorize:

```text
Planner code changes
provider calls
live Shadow runs
Active context rewrite
Wave A Run 3 or Wave B
manifest/fixture/evaluator changes for a provider run
```

The bounded Lead review of PROPOSAL-032 and this suite specification, and the
separate provider-free implementation task, have since been completed; the
executed runs and gate adjudications are linked in the status block above.
