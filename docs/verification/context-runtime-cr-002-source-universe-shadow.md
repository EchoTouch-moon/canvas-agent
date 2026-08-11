# CR-002 Verification — Context Source Attribution and Shadow Universe Model

- **Status:** IMPLEMENTATION COMPLETE — awaiting architect acceptance (rev.3, acceptance gates confirmed)
- **Packet:** `docs/tasks/deepseek/DS-009-context-source-universe-shadow.md`
- **Owner:** DeepSeek V4 Flash — Context Runtime research implementer
- **Branch:** `agent/deepseek-ds-009-context-source-universe-shadow`
- **Date:** 2026-08-11 (rev.3 after PR #16 architecture review)
- **Pi exact version tested:** `@earendil-works/pi-coding-agent@0.84.1` (workspace pin). Tool-call lifecycle hooks (`tool_execution_start/end`, `tool_call`, `tool_result`) verified present in the installed package; `context` remains the authoritative model-call seam and no lifecycle hook is required for the implemented correlation.
- **DeepSeek provider/model (live smoke):** provider `deepseek`, model `deepseek-v4-flash`, credential from local Pi `auth.json`.

---

## 1. Architecture implemented

```text
Pi AgentMessage[] at model-call boundary (context event)
        |
        v
Observed Context Elements  (USER_TEXT / ASSISTANT_TEXT / ASSISTANT_THINKING /
                            TOOL_CALL / TOOL_RESULT / IMAGE / OTHER_STRUCTURED /
                            OPAQUE_BLOCK)
        |
        v
Source Attribution  (EXACT / DERIVED_HINT / UNATTRIBUTED / OPAQUE + resourceHints)
        |
        v
Provisional Source Observations  (AVAILABLE only for EXACT run-event identities)
        |
        v
Source Reconciliation  (INITIALIZE / NO_CHANGE / UPDATE / REMOVE / RETAIN_LAST_KNOWN)
        |
        v
Shadow Context Universe Revision  (immutable, logical-hashed, replayable)
```

- `packages/context-runtime` remains Pi/OpenCode/Codex/provider neutral (no provider imports).
- `packages/pi-context-integration` owns all Pi-specific message shape knowledge.
- Pi messages returned from the `context` hook are **semantically unchanged** (CR-001 pass-through preserved; verified by test and live smoke).

## 2. Observed Context Element taxonomy (provisional)

Derived from real Pi data: `USER_TEXT`, `ASSISTANT_TEXT`, `ASSISTANT_THINKING`, `TOOL_CALL`, `TOOL_RESULT`, `IMAGE`, `OTHER_STRUCTURED`, `OPAQUE_BLOCK`. A single AgentMessage decomposes into 0..N elements (assistant text + toolCall block => two elements). Each element carries `observationRef` (session + modelCallSequence + messagePosition + blockPosition), `semanticHash`, role/kind, and tool identity where present. Explicitly **not** a Context Source.

## 3. Source Attribution rules (deterministic, no LLM)

| Confidence | Rule | Example |
|---|---|---|
| EXACT | stable identity directly exposed by the harness | toolCallId => `run/tool-call://call-7`, `run/tool-result://call-7` |
| DERIVED_HINT | structured known tool argument yields a candidate resource | `read(path="src/auth.ts")` => `repository/file://src/auth.ts` (hint only) |
| UNATTRIBUTED | no trustworthy identity | assistant prose ("auth.ts may be broken") — never parsed |
| OPAQUE | origin intentionally unavailable to this seam | image blocks, missing toolCallId |

Every attribution carries `method` (`PI_TOOL_CALL_ID_EXACT`, `PI_TOOL_RESULT_ID_EXACT`, `PI_TOOL_ARGUMENT_PATH_HINT`, `NO_TRUSTWORTHY_IDENTITY`, `ORIGIN_OPAQUE`) plus `evidenceRefs` (modelCall/messageIndex/toolCallId/argumentField). Elements with an EXACT primary may carry secondary `resourceHints` (e.g. repository path from read args) — a tool-call source and a file resource hint are distinct identities (DS-009 §20).

## 4. Source Reconciliation (PROPOSAL-030 semantics)

```text
first AVAILABLE        -> INITIALIZE
same AVAILABLE hash    -> NO_CHANGE
changed AVAILABLE      -> UPDATE
confirmed ABSENT       -> REMOVE
UNAVAILABLE            -> RETAIN_LAST_KNOWN
```

- `ContextSourceVersion` id = deterministic hash(sourceKey + contentHash). Same source+content => same version; changed content => new version; same content under different source => different version.
- `UNAVAILABLE` never becomes `ABSENT` and never clears `lastAvailableVersionId`.
- `ABSENT` requires an explicit fixture/observer confirmation. A source merely missing from a later `AgentMessage[]` produces no observation (not ABSENT). Implemented via `FixtureSourceObserver` (explicit `AVAILABLE/ABSENT/UNAVAILABLE` table; no table entry => not observed).

## 5. Shadow Context Universe

- Immutable revisions: `seedUniverse()` => revision 0 (snapshot-like seed), `applySourceObservations()` => revision N+1 with `previousRevisionId`.
- `logicalHash` = sha256 over (session, sequence, modelCallSequence, canonical ordered entries, reconciliation action list).
- `replayUniverse(seed, orderedObservationBatches)` reconstructs the same final revision/logicalHash deterministically.
- Snapshot-like seed versions remain addressable even after runtime head advances; seed and runtime-derived state stay distinguishable (proven by test).

## 6. Deterministic test results (credential-free, no network)

```bash
pnpm --filter @canvas-agent/context-runtime test        55 passed
pnpm --filter @canvas-agent/pi-context-integration test 40 passed
pnpm --filter @canvas-agent/context-runtime typecheck   PASS
pnpm --filter @canvas-agent/pi-context-integration typecheck PASS
pnpm check                                              GREEN (565 tests + build)
```

Coverage of the DS-009 required deterministic tests (26 items): all present —
decomposition determinism; tool call/result correlation by toolCallId; structured path => DERIVED_HINT; assistant prose produces no repository source; contentHash equality does not create source identity; AVAILABLE first/same/changed; ABSENT=>REMOVE; UNAVAILABLE=>RETAIN_LAST_KNOWN; UNAVAILABLE retains lastAvailable; message disappearance != ABSENT; Universe immutable; logical hash deterministic; replay from seed + ordered observation batches; replay hash identical; provider types never enter Runtime core; metadata output has no raw credentials. PR #16 review items added tests for admitted-version retention on NO_CHANGE/UNAVAILABLE, ABSENT version clearing, tool-result content versioning, timestamp correlation, and snapshot-vs-run provenance.

## 7. Live enriched Pi + DeepSeek smoke (CR-002, rev.2)

**Status: EXECUTED**

```text
Command: CANVAS_CONTEXT_LIVE_SMOKE=1 pnpm --filter @canvas-agent/pi-context-integration smoke:deepseek:cr002
runtimeSessionId: smoke-cr002-2026-08-11T08-14-40-983Z
provider: deepseek   model: deepseek-v4-flash
```

Metadata-only attribution timeline:

```text
modelCall  elements  EXACT  DERIVED_HINT  UNATTRIBUTED  OPAQUE  resourceHints  sourceObs  universe rev  sources
  1            1        0        0             1          0           0            0         1          1
  2            4        2        0             2          0           1            2         2          3
  3            6        4        0             2          0           2            4         3          5
  4            9        6        0             3          0           3            6         4          7
  5           12        8        0             4          0           4            8         5          9
```

Final attribution coverage (last model call): EXACT=8, DERIVED_HINT=0, UNATTRIBUTED=4, OPAQUE=0, resourceHints=4, sourceObservations=8. Universe: revision 5, 9 sources, logicalHash `c9e9895ecd0a7aac49ae2071b43442acf4d2d1a4d3290f8c24a2fcfd553831ea`. Source kinds observed: `run/tool-call://*`, `run/tool-result://*` (EXACT run-event identities, descriptor sourceKind RUN_TOOL_CALL / RUN_TOOL_RESULT, provenance PI_CONTEXT_EVENT) plus the snapshot-like seed `repository/file://notes.md` (seed only, not runtime-admitted). No raw prompt/tool-result content and no credentials in the JSONL trace (verified). Trace is under `.canvas-agent/research/**` (gitignored).

## 8. Source Reconciliation examples

- AVAILABLE changed (UPDATE): `repository/file://src/auth.ts` hash-A -> hash-B produced a new version, old version retained as `lastAvailableVersionId`.
- ABSENT (REMOVE): fixture observer returned `{status:'ABSENT'}` for `task-spec://task-1`; admitted cleared, `lastAvailableVersionId` retained.
- UNAVAILABLE (RETAIN_LAST_KNOWN): fixture observer returned `{status:'UNAVAILABLE', reasonCode:'adapter-down'}`; admitted version retained, status set to UNAVAILABLE (never ABSENT).

## 9. Universe revision / replay evidence

- Revision 0 (seed) carries `repository/file://notes.md @ seed-notes-hash-placeholder` and is immutable.
- Applying `AVAILABLE(auth.ts, hash-C)` produces revision 1 with a new admitted head while seed revision still carries hash-A.
- `replayUniverse` from seed + ordered observation batches reproduces the same final revision entries and the same `logicalHash` as the incremental path (test-locked, two independent replays identical). This proves seed + ordered observations reconstruct the same Universe head state. **Event-log-only replay (replaying from a persisted ordered reconciliation-event log without the original observation batches) remains future work** and was not claimed.

## 10. PROPOSAL-030 assumptions: confirmed vs contradicted

**Confirmed:**

- `ContextSource` (stable key) vs `ContextSourceVersion` (immutable content) separation is meaningful and matches real tool-call/tool-result observation.
- `AVAILABLE / ABSENT / UNAVAILABLE` are expressible and mutually exclusive; UNAVAILABLE retention semantics are implementable and test-locked.
- Source Reconciliation != ContextTransition holds: reconciliation actions are recorded separately from any future working-set transition.

**Contradicted / needs revision:**

- PROPOSAL-030's optimistic source taxonomy implies sources are broadly observable from run data. In practice the Pi `context` seam yields **only** run-event identities (tool-call/tool-result) with high confidence; repository-file and other "world" sources are at best DERIVED_HINT from tool arguments, never provably canonical from the seam. The proposal should not imply file sources are directly admitted without a separate repository observer.
- `UNAVAILABLE` was never observed from the live Pi seam in CR-002 (the seam either yields AVAILABLE content or nothing). It remains a fixture-only construct for now; the proposal should mark it as "expected but not yet observed at the Pi seam".
- `ContextSourceState.lastAvailableVersionId` is more useful than the proposal implies for UNAVAILABLE retention; worth promoting.

## 11. Fields ready for PROPOSAL-030 promotion

- `ContextSourceVersion.id` deterministic identity rule (sourceKey + contentHash).
- `SourceReconciliationAction` vocabulary (INITIALIZE/NO_CHANGE/UPDATE/REMOVE/RETAIN_LAST_KNOWN).
- `AVAILABLE / ABSENT / UNAVAILABLE` state semantics (with ABSENT requiring explicit observer confirmation).
- `ContextUniverseRevision` immutable + `logicalHash` + `previousRevisionId` + replay discipline.

## 12. Fields remaining provisional

- `ObservedElementKind` taxonomy (needs more harnesses before freezing).
- `SourceAttribution` evidenceRefs schema and `resourceHints` shape (may evolve).
- Universe `attributionSummary` (research metric, not a contract).
- `context-runtime` new types are experimental/internal only; no public schema, no SQL tables, no production persistence.

## 13. Security / privacy behavior

- Metadata-only JSONL by default; no raw prompts, tool results, or credentials.
- `DEEPSEEK_API_KEY` only from env or Pi auth.json; never logged/committed.
- `resourceHints` persist only source keys (repository paths), never file contents.
- Traces under `.canvas-agent/research/**` (gitignored), not committed.

## 14. Research questions

**Q1 — How much of Pi AgentMessage[] can be stably attributed to a Source?**
Only run-event identities (tool-call / tool-result by toolCallId) are stable/EXACT. Text/thinking/user content is UNATTRIBUTED. Resource hints come from structured tool arguments only. In the live run: 8/12 elements EXACT (67%), 4/12 UNATTRIBUTED (33%).

**Q2 — Which identities come from EXACT evidence?** `run/tool-call://<id>` and `run/tool-result://<id>`.

**Q3 — Which only DERIVED_HINT?** `repository/file://<path>` derived from structured read/write/edit/grep/find/ls `path`/`filePath` arguments. Never treated as canonical file state.

**Q4 — What should stay UNATTRIBUTED?** All free-form assistant/user prose, thinking, and any content whose origin is not structurally exposed.

**Q5 — Do we need ContextSourceState?** YES — it is the minimal mutable head needed to reconcile observations into an immutable Universe revision; tests confirm UPDATE/REMOVE/RETAIN_LAST_KNOWN all require retained state.

**Q6 — Are AVAILABLE/ABSENT/UNAVAILABLE all meaningful?** AVAILABLE yes (observed). ABSENT yes as a fixture/observer construct (confirmed absence must not be inferred from disappearance). UNAVAILABLE: semantically necessary and test-locked, but not yet observed from the live Pi seam.

**Q7 — Is ContextUniverseRevision deterministic/replayable?** YES — deterministic logical hash and exact replay are test-locked.

**Q8 — Which PROPOSAL-030 fields are too early?** File/symbol/repository "world" sources admitted directly from the seam; `UNAVAILABLE` as a routinely observed state; Universe persistence shape.

**Q9 — Do ContextSource/ContextSourceVersion/Universe definitions need revision?** Minor: add `resourceHints` distinction (event source vs resource hint), mark UNAVAILABLE as expected-not-yet-observed, and confirm source kinds are run-event dominated.

**Q10 — Is the Universe sufficient as CR-003 Planner input?** **PARTIALLY.** It is a trustworthy, replayable record of run-event source state, which is sufficient to seed a Shadow Planner's notion of "what run events are known". It is NOT sufficient as the sole input because (a) repository-file sources remain hints without a repository observer, and (b) there is no working-set/relevance model yet — the Planner would need additional world-source observation before it can reason about file-level context. Recommendation below.

## 15. CR-003 gate recommendation

Recommendation (not authorization): allow CR-003 Shadow Planner work to begin **on the run-event universe** (tool-call/tool-result sources are trustworthy), while explicitly marking repository/file hints as non-canonical until a real repository observer is added. If the Planner requires canonical file sources, add a repository observer experiment first.

## 15a. Acceptance-gate confirmation (rev.3 — architect review items)

**Gate 1 — Universe invariant.** An **invariant sweep / state-transition invariant test** now enforces, over every entry of every revision across the full seed → NO_CHANGE → UPDATE → UNAVAILABLE → ABSENT chain:

```text
admittedVersionId === null   iff   admittedVersion === null
admittedVersionId !== null   =>     admittedVersion.versionId === admittedVersionId
observationStatus === ABSENT =>     admittedVersionId === null && admittedVersion === null
```

This is a bidirectional null-equivalence guard (it also catches the reverse dangling state `admittedVersionId = null` with a non-null `admittedVersion`). It is an invariant sweep, not property-based testing (no fast-check).

**Gate 2 — SourceVersion identity purity (known redundancy, accepted).** Version identity is `H(sourceKey, contentHash)` and is correctly scoped by canonical `sourceKey`. For `run/tool-*` sources, `contentHash` is a **source-local semantic digest**, not a globally content-pure digest: `toolCallId` participates redundantly in the digest (it also appears in `sourceKey`), so two different `run/tool-result://call-1` vs `run/tool-result://call-2` with identical result content yield different `contentHash`. This does not violate CR-002 version-identity semantics (version identity is source-scoped), and was deliberately retained (lead-approved) to avoid invalidating version ids and smoke evidence. It **must not** be relied upon for cross-source semantic equality, global content deduplication, blob addressing, or repository-observer reuse until explicitly reworked.

**Gate 3 — core / Pi boundary.** `packages/context-runtime` contains no Pi constants, no provider imports, and no key-prefix inference of `sourceKind`. `run/tool-*` source-kind assignment happens only in the Pi integration (`collectSourceObservations`), which also supplies the `ContextSourceDescriptor` (sourceKind/provenance). When a descriptor is missing the core uses a neutral `UNKNOWN` fallback and never parses the key. No bypass exists.

**Gate 4 — live seam vs fixture semantics.** `reconcileSource` fully implements `UNAVAILABLE → RETAIN_LAST_KNOWN`; a future live Pi seam emitting `UNAVAILABLE` requires no Universe/reconciliation contract change (the Pi integration merely constructs `createUnavailableObservation`). **Producer semantics to preserve on live-observer adoption:**

```text
UNAVAILABLE = source theoretically exists / previously existed but this round
              cannot observe it reliably  => never delete canonical knowledge
ABSENT      = observer authoritatively confirmed the source does not exist
              => revoke admitted version
```

Reading failure must never be turned into `ABSENT` (which would wrongly clear the admitted canonical version).

**PROPOSAL-030 follow-up gaps (scoped, not rejection):**

```text
implemented semantics  !=  all possible producers implemented
```

1. `repository/file` world sources remain `DERIVED_HINT` only — a real Repository Observer is a follow-up capability, not a CR-002 defect.
2. `UNAVAILABLE` has no live producer yet — the contract exists and is test-locked; a live producer is follow-up.

## 16. PR #16 review items — resolution

| Review item | Resolution |
|---|---|
| P1 Universe loses admitted version on NO_CHANGE/UNAVAILABLE | ✅ `applySourceObservations` retains the previous admitted `ContextSourceVersion` whenever the reconciled state still references the same admitted version id; clears it only on ABSENT/REMOVE. Tests assert `entry.state.admittedVersionId === entry.admittedVersion.versionId` on both NO_CHANGE and UNAVAILABLE, and `admittedVersion === null` on ABSENT. |
| P1 TOOL_RESULT version hash omits result content | ✅ `toolResultSemanticParts()` folds result text/thinking blocks, image (type+bytes+sha256) and error semantics into the in-memory `semanticHash`; `collectSourceObservations` promotes that hash to the SourceVersion `contentHash`. Same toolCallId + changed content => different version (test-locked). Raw result content never persisted. |
| P1 SourceObservation observedAt was runtimeSessionId | ✅ `observeModelCall` now captures the CR-001 `ModelCallObservation.observedAt` once and passes that same value to `collectSourceObservations` and reconciliation. Test asserts `ModelCallObservation.observedAt === SourceObservation.observedAt === state.lastObservedAt` and `!== runtimeSessionId`. |
| P1 Runtime attribution vocabulary hard-codes Pi | ✅ core uses neutral `AttributionMethodId` (string) + generic `NO_TRUSTWORTHY_IDENTITY` / `ORIGIN_OPAQUE`; Pi-specific constants moved to `pi-context-integration/src/pi-source-methods.ts`. No core test references a PI_* method. |
| P1 Universe drops source descriptor/provenance | ✅ `ContextUniverseEntry` now carries a `ContextSourceDescriptor` (sourceKey/sourceKind/provenance, + authority/priority for snapshot seeds). Pi integration supplies `RUN_TOOL_CALL`/`RUN_TOOL_RESULT` + `PI_CONTEXT_EVENT` descriptors; core never parses the key. Test proves snapshot-seeded vs run-derived entries are distinguishable by explicit metadata. |
| P2 SourceObservation structural validity | ✅ `SourceObservation` is a discriminated union (AVAILABLE requires contentHash, UNAVAILABLE requires reasonCode, ABSENT carries neither); `reconcileSource` never silently maps malformed AVAILABLE to NO_CHANGE. `FixtureSourceObserver` throws on a malformed AVAILABLE fixture entry. |

## 17. Scope confirmation

```
No Context Working Set Planner was implemented.
No Pi model-call context was rewritten.
No production persistence schema was added.
No v0.2 ContextSnapshot or ExecutionRequest contract was changed.
CR-003 was not started.
```

CR-002 evidence ready for lead architecture review (rev.3 — acceptance-gate confirmation complete). Enriched DeepSeek smoke was not rerun for rev.3 because the closing revision modifies only invariant tests and verification documentation; no production hashing, observation, reconciliation, attribution, provenance, or Universe transition path changed. Previous smoke evidence (`smoke-cr002-2026-08-11T08-14-40-983Z`, EXACT=8 / UNATTRIBUTED=4 / resourceHints=4, rev 5 / 9 sources) remains behaviorally applicable.
