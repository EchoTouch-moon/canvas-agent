# CR-004 LC1 Pi Source-Identity Seam Observation

Date: 2026-08-30
Status: `OBSERVED / CREDENTIAL-FREE / NO PROVIDER`
Baseline: `codex/cr004-lc1-identity-oracle@aa270cc`
Scope: Pi integration seam tests and evidence only; no production changes

## Purpose

This zero-provider observation checks whether the current Pi integration can
relate two tool events that read the same repository path to one logical source
subject after the first evidence has become cold. It uses the existing
`decomposePiMessages`, `collectSourceObservations`, and
`EnrichedPiShadowObserver` surfaces. No provider, filesystem observer, planner
mutation, or Active rewrite is involved.

The test is an observation of the current seam, not a replacement for the LC1
logical-source oracle in the stacked identity-oracle change.

## Observed behavior

For two `read` calls with different call IDs, the same path produces:

```text
resource hint:       repository/file://src/reopen-a.ts
exact event 1:       run/tool-result://call-1
exact event 2:       run/tool-result://call-2
```

The path hint is stable, but it is deliberately not promoted into a canonical
source observation. The current integration therefore preserves two distinct
run-event sources and does not emit a logical source subject that could support
`REMOVE → later demand → REHYDRATE`.

The provisional result content hashes also differ when path and result content
are identical but the tool-call IDs differ. This follows the current
decomposition, whose result semantic hash includes the event ID. It means the
current provisional observation layer is event-bound rather than a
source-version mapper.

Finally, reusing the same tool-call ID in two runtime sessions produces the same
`run/tool-result://reused-call` source key, while the observation references
remain session-distinct. Unless the upstream Pi contract guarantees globally
unique call IDs, persistence or cross-session aggregation needs an explicit
session/evidence namespace.

## Adjudication

```text
Seam observation:                 PASS
Logical source mapping:           NOT IMPLEMENTED
Classification:                   IDENTITY_MAPPING_NOT_IMPLEMENTED
Harness contract failure:         NO
Provider calls:                    0
Pi messages rewritten:             NO
Planner/policy changed:            NO
CR-005 manifests/fixtures changed: NO
```

This is an expected current integration boundary, not a task failure or a
harness failure. The existing observational-only design is behaving
deterministically: it exposes exact event/evidence identity, keeps path
attribution at hint confidence, and does not fabricate a source identity from a
tool argument alone.

## Mechanism candidate, not authorized implementation

Before any Active rewrite or live Shadow experiment can claim REMOVE/REHYDRATE
semantics for Pi-derived repository sources, a separately reviewed mapping
layer should establish all three identities independently:

1. logical source subject: repository identity + namespace + normalized path;
2. immutable SourceVersion: content/revision identity independent of event ID;
3. evidence instance: runtime session + tool-call/result identity.

The authoritative repository adapter must be the component allowed to promote a
path hint into a logical source observation. The Pi message seam alone must not
infer repository absence, version identity, or rehydration. Any implementation
should also make the event namespace explicit or document a globally unique
call-ID guarantee.

This candidate is a design prerequisite for later lifecycle use, not a
production change in this evidence packet.

## Decision

```text
LC1 Pi source-identity seam evidence: ACCEPTABLE OBSERVATION
LC1 logical-source oracle:            remains separately reviewable
Production identity mapping:          NOT AUTHORIZED
Provider/live execution:              NO_GO
CR-004 Active Rewrite:                NO_GO
```

The next bounded action is Lead review of this seam evidence together with the
LC1 identity oracle. If accepted, a later implementation task may add the
mapping layer under a new baseline; this observation must not be treated as
permission to modify `policy-v0.ts` or to run a provider experiment.
