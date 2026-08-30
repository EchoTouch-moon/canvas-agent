# CR-004 LC1 Pi + Real Repository Authority Conformance

Date: 2026-08-30
Status: `EXECUTED / CREDENTIAL-FREE / TEST-ONLY CANDIDATE`
Baseline: `codex/cr004-lc1-bridge-candidate@07b73a3`
Scope: temporary Git fixture, existing RepositoryObserver, test-only Pi bridge

## Purpose

This packet checks the bridge against the real credential-free repository
authority rather than a hand-written synthetic authority. The test creates a
temporary Git repository, observes actual pinned revisions with
`RepositoryObserver`, converts those observations into the LC1 bridge input,
and runs the existing test-only identity mapper. No provider or Pi live session
is used.

## Executed chains

### Clean revision and rehydration

```text
committed reopen-a:v3
  → RepositoryObserver AVAILABLE
  → Pi read event + authority v3
  → ADD
  → REMOVE / RULED_OUT
  → second Pi read with a normalized path alias
  → REHYDRATE / exact originating REMOVE
```

The content hash comes from the actual Git blob and the SourceVersion identity
is stable across different Pi call IDs. The evidence instance remains new and
is namespaced by runtime session.

### Dirty working tree

After the v3 commit, the working tree is edited to v4 without updating the
expected revision. The RepositoryObserver returns `UNAVAILABLE / REVISION_MISMATCH`.
The bridge preserves that status and the LC1 mapper returns conservative
`CONSERVATIVE_KEEP`; it never promotes the dirty read to an available version.

### Committed version and explicit deletion

After v4 is committed, the same logical path produces a new authoritative hash
and revision, so the mapper returns `ADD`, not `REHYDRATE` of v3. After the file
is deleted and committed, Git returns an explicit `ABSENT` observation. The
bridge passes that explicit authority through as `CONFIRMED_ABSENT`; missing or
unavailable authority is never converted into `ABSENT`.

## Important seam requirement

Pi path hints are candidates, not canonical repository paths. The authority
adapter must normalize safe separators and `.`/`..` segments before calling
`RepositoryObserver`. Unsafe hints are omitted from the authority request. The
RepositoryObserver itself continues to reject non-canonical paths rather than
weakening its contract.

The authority request must also be bound to the caller's repository and
namespace identity. A path match alone is insufficient for source identity.

## Results

```text
Real RepositoryObserver bridge cases:  4/4 PASS
Clean ADD → REMOVE → REHYDRATE:        PASS
Dirty revision conservative handling:  PASS
Committed version separation:          PASS
Explicit deletion / ABSENT:            PASS
LC1 safety-oracle replay:              PASS
Provider calls:                         0
Production files changed:              0
```

This demonstrates that the candidate mechanism is compatible with a real
repository authority and preserves the fail-closed distinctions required by
the LC1 contract.

## Limits and adjudication

```text
Repository authority conformance: PASS (test-only)
Pi-to-authority bridge:           ACCEPTABLE CANDIDATE
Production identity mapping:      NOT IMPLEMENTED
policy-v0:                         UNCHANGED
Pi messages rewritten:             NO
Live Shadow / CR-004:              NO_GO
```

The test uses a temporary Git repository and a direct test adapter. It does not
exercise a production repository-observer lifecycle, concurrent mutation race
in this bridge, persistent cross-session storage, or a real provider request.
Those are later gates, not reasons to reinterpret this deterministic result.

The next implementation candidate should reuse the existing authoritative
RepositoryObserver and external-observation boundary, but must be reviewed as
a new production change. This evidence does not authorize changing
`policy-v0`, enabling Active rewrite, or starting a live experiment.
