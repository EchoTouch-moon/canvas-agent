# CR-004 LC0 runtime lifecycle conformance — 2026-08-30

## Decision

```text
LC0: LIFECYCLE_CONTRACT_PASS
     with a bounded Pi-source-identity caveat

Provider calls:                 0
Live Shadow / Active Rewrite:   NOT EXECUTED
Policy / Planner changes:       0
M9 retry:                       0
CR-004 production authorization: NO_GO
```

The safe lifecycle seam passed: a sent Active rewrite can carry a removed
pair out of later model-visible context, a later fresh read can become active,
verification-window deferral and dedup can coexist, and a failed attempt rolls
back without leaving the removed source excluded. The frozen C0 planner also
continues to produce explicit `REMOVE → REHYDRATE` decisions with the required
source-version and later-needed evidence.

The caveat is important and is not hidden: at the actual Pi tool-call seam, a
later read receives a new tool-call/source identity, so the runtime records it
as a fresh `ADD`, not as a source-identity-preserving `REHYDRATE`. LC0 proves
that this fresh re-entry is safe and does not resurrect the old removed pair;
it does not claim that the Active extension currently emits an explicit
rehydration relation for that path.

## Frozen boundary

LC0 is a deterministic test-only screen. It changed no `policy-v0`, Active
policy, manifest, fixture, Pi instruction, compaction setting, safety guard,
production default, or live provider configuration. No credentials, network,
ModelRuntime, or Step Plan call were used.

Contract:

```text
docs/plan/cr004-lc0-runtime-lifecycle-conformance-contract-2026-08-30.md
```

The contract and suite are based on the M9 evidence branch and remain
independent of the terminal M6–M9 live run identities.

## Deterministic closure

The LC0 suite executed five conformance cases with zero provider calls:

| Case | Result | What it establishes |
| --- | --- | --- |
| LC0-A | PASS | successful `REMOVE` stays carried out; later same-path fresh read is active; old source is not resurrected |
| LC0-B | PASS | frozen planner emits `REMOVE → REHYDRATE` for wrong-path recovery and phase shift with provenance and `DETAIL_REQUIRED`/correct version evidence |
| LC0-C | PASS | edit removal defers during the verification window while same-window duplicate-read dedup still fires and preserves verification evidence |
| LC0-D | PASS | composition failure returns native context and leaves the removed source eligible; fallback is recorded |
| LC0-E | PASS | a later new Pi tool-call identity is deliberately not mislabeled as explicit `REHYDRATE` |

The focused package result was:

```text
Test files: 1 passed
Tests:      5 passed
```

The broader Pi-context integration package result was:

```text
Test files: 18 passed
Tests:      274 passed
Typecheck:  passed
Format:     passed
```

The repository-level `pnpm check` also passed format, lint, all workspace
typechecks, all workspace tests, and all workspace builds, including the
desktop build.

## Lifecycle observations

The successful Active lifecycle path exercised this chain:

```text
read r0 / read r1 (latest)
        ↓
edit e1
        ↓
V3 Active rewrite sends REMOVE for r0
        ↓
r0 remains absent from the carried basis
        ↓
later read r2 of the same path
        ↓
r2 is active; r0 is still absent
```

The sent rewrite carried complete binding and guard evidence, reduced the
model-visible message set, and preserved tool-call/result pairing. The later
read was recorded as a new source identity and appeared as `ADD`; no
`REHYDRATE` decision was fabricated from path equality alone.

The combined verification-window trace showed both signals at one boundary:

```text
edit sweep:       deferred because the last two tool events were bash
duplicate read:   dedup boundary fired in the same window
old duplicate:    removed
newest read:      retained
verification:     retained
```

The failure path confirmed native fallback and source eligibility after a
composition refusal. Existing transactional regressions in the same package
continue to provide the stronger control-equivalence digest check for full
pre-attempt restoration.

## Interpretation boundary

LC0 supports these bounded statements:

- carried Active removals do not automatically reappear on later events;
- new evidence can safely enter after an earlier removal;
- planner-level rehydration provenance and exact representation semantics are
  already testable and deterministic;
- verification-window and dedup behavior are compatible at the seam;
- composition failure remains fail-closed and transactional.

LC0 does not support these stronger statements:

- a later read is a confirmed false removal;
- the Active extension currently emits a standalone `REHYDRATE` relation for
  a new Pi tool call;
- the runtime knows that two different tool calls refer to the same
  SourceVersion without an explicit source identity mapper;
- any policy is globally optimal or ready for CR-004 production;
- rehydration improves provider tokens, cost, latency, or task success.

## Next decision

The next core gap is not another duplicate live V3 run. It is an
identity-aware, credential-free lifecycle design that makes the relation
between path, logical source, SourceVersion, representation, and tool-call
instance explicit. That design should decide whether the runtime needs:

1. a source-identity mapper that can relate a later tool call to an earlier
   logical source without reviving the old evidence;
2. a separate `REHYDRATE` event/record at the planner seam, with an originating
   `REMOVE` reference and exact version binding; and
3. an independent harm oracle before any later-demand live experiment can be
   interpreted as false-removal evidence.

Until that zero-provider design is specified and reviewed, no new live
later-demand run, Wave B run, or CR-004 production execution is authorized.
The LC0 result is a positive safety/conformance result with a deliberately
preserved identity-mapping research gap.
