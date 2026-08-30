# CR-004 LC1 — logical source identity mapping proposal

**Classification:** core research mechanism candidate  
**Status:** DESIGN ONLY / NOT AUTHORIZED FOR IMPLEMENTATION OR LIVE EXECUTION  
**Date:** 2026-08-30

## Why this proposal exists

LC0 established two different facts:

1. the Active seam can safely carry a removed tool-call/result pair out of
   later model-visible context and admit a later fresh read; and
2. the frozen planner can emit an explicit `REMOVE → REHYDRATE` decision when
   one logical source identity, SourceVersion, and removal history are
   available.

At the actual Pi tool-call seam, a later read receives a new tool-call
identity. The current runtime therefore records that later evidence as a new
`ADD`. It does not yet prove that the new read is the same logical source or
that it should be linked to an earlier `REMOVE` as `REHYDRATE`.

This proposal explores the missing identity relation. It is not a request to
patch `policy-v0`, change Active behavior, alter task fixtures, or start a
live provider run.

## Core model to evaluate

The candidate design separates three identities that are currently easy to
conflate:

```text
logical source subject
  e.g. repository + normalized path + source namespace

source version
  content/revision identity admitted by the current Universe

evidence instance
  one Pi tool-call/result pair with its own call id
```

The proposed relation is:

```text
logical source subject
        ├─ SourceVersion v1
        │    └─ evidence instance read-1
        │
        └─ SourceVersion v1
             └─ evidence instance read-2
```

When `read-1` was active and then removed, a later `read-2` may qualify as a
rehydration demand only if the runtime can prove the logical subject and
SourceVersion relation. The old evidence instance must remain absent from the
carried model-visible basis. Rehydration must not mean resurrecting old Pi
messages by call id.

## Non-negotiable semantics

The implementation, if later authorized, must preserve these invariants:

1. **Path normalization is not version identity.** Equivalent path spelling
   may identify one logical subject, but content/repository revision changes
   must create a new SourceVersion.
2. **Changed content is not a rehydrate of the old version.** A changed hash
   or explicit Universe revision must produce a new version relation and the
   appropriate `ADD`/`REPLACE` decision.
3. **A rehydrate requires an originating removal.** No prior active source and
   no valid `REMOVE` means no `REHYDRATE`.
4. **The origin is single-use and exact.** One removal cannot be consumed by
   multiple rehydrates; the origin reference must identify the logical source,
   source version, and removal transition.
5. **Representation is bound.** If the later request requires `FULL`, the
   rehydrated representation must cover the exact admitted SourceVersion and
   requested representation kind.
6. **Old evidence stays cold.** The old tool-call/result pair remains excluded;
   a rehydrated representation is a new materialized/current item, not message
   resurrection.
7. **Unavailable is conservative.** `UNAVAILABLE`, revision mismatch,
   materialization failure, or hash mismatch cannot by themselves establish a
   rehydrate relation or `SOURCE_ABSENT`.
8. **Replay is identity-stable.** The same normalized input and history must
   produce the same logical source mapping, transition hash, and provenance.
9. **Privacy is preserved.** Mapping evidence may record stable hashes and
   bounded metadata, never raw file content or credentials.
10. **Protected/pinned items remain non-evictable.** Identity mapping must not
    become a route around existing Active safety guards.

## Zero-provider LC1 oracle before implementation

Before any production or Active code change, build a deterministic synthetic
oracle with the following cases:

| Case | Required result |
| --- | --- |
| same logical path, same SourceVersion, new call id | `REHYDRATE` only after valid `REMOVE`; exact origin retained |
| same logical path, changed content hash | new version; never `REHYDRATE` of old version |
| same path spelling with `./` normalization | same logical subject, no false duplicate version |
| different repository/namespace, same path | different logical subject |
| new read with no prior removal | `ADD`, not `REHYDRATE` |
| missing/invalid originating removal | hard oracle failure / no rehydrate |
| reusing one removal twice | hard oracle failure |
| wrong SourceVersion | hard oracle failure |
| `UNAVAILABLE` or revision mismatch only | no absent/rehydrate inference |
| required `FULL` after removal | exact version + `FULL` representation required |
| protected source | no removal and no identity bypass |
| same trace replayed twice | identical mapping and transition hashes |

The oracle must include an end-to-end chain, not only isolated objects:

```text
ADD evidence-instance-1:v1
  → KEEP
  → REMOVE evidence-instance-1:v1 / explicit origin T3
  → cold state
  → later-needed evidence-instance-2:v1
  → REHYDRATE source-subject:v1 / origin T3
  → KEEP FULL
```

It must also include adversarial mutations that must fail:

```text
REHYDRATE → ADD
wrong SourceVersion
originating REMOVE reference deleted
same removal consumed twice
changed content labeled same version
UNAVAILABLE labeled SOURCE_ABSENT
protected item evicted
```

## Proposed implementation boundary, if LC1 passes

Only after the oracle is reviewed and passes should a separate implementation
task consider:

- a provider-neutral logical-source identity structure;
- deterministic path/namespace/version mapping at the observer/planner seam;
- an explicit origin reference carried by `REHYDRATE` decisions;
- evidence fields that distinguish `rehydrate-demand`,
  `false-removal-candidate`, and `confirmed-false-removal`;
- no changes to default Active behavior until a later Gate review.

The implementation must not silently change existing `sourceKey` historical
meaning. Existing M6–M9 evidence remains bound to its original schema and is
not rewritten. If a compatibility adapter is required, it must be explicit
and versioned.

## Live-experiment boundary

LC1 itself authorizes no provider calls. A later live screen would require a
fresh contract and identity, and only after:

```text
LC1 oracle design review
        ↓
credential-free implementation + adversarial tests
        ↓
Lead review / baseline freeze
        ↓
separate live later-demand authorization
```

The live screen must have an independent harm oracle before reporting
`confirmed-false-removal`. A later read alone remains only
`rehydrate-demand` or a `false-removal-candidate`.

## Decision status

```text
LC1 source identity mapping: CANDIDATE / DESIGN ONLY
Production implementation:  NOT AUTHORIZED
Policy-v0 change:            NO_GO
Live provider execution:     NO_GO
Wave B:                      NO_GO
CR-004 Active Rewrite:       NO_GO
```

The proposal becomes an implementation candidate only if the deterministic
oracle shows that the semantics can be made unique, replayable, and backward
compatible with the historical evidence model.
