# CR-004 LC1 — logical source identity zero-provider oracle

**Status:** EXECUTED / CREDENTIAL-FREE / IMPLEMENTATION CANDIDATE ONLY

**Date:** 2026-08-30

**Provider calls:** 0

**Production policy changes:** none

**Live Shadow execution:** not started

## Scope

This verification packet exercises the LC1 source-identity proposal without
changing `policy-v0`, the Active rewrite seam, Pi integration, CR-005
fixtures, manifests, or any persisted runtime schema. The candidate mapper is
test-only and exists to determine whether the proposal has a unique,
deterministic semantic contract before a production implementation is
considered.

The test separates:

```text
logical source subject
  repository + namespace + normalized repository-relative path

SourceVersion
  subject + content hash + admitted Universe revision

evidence instance
  individual tool-call identity + subject/version relation
```

## Required lifecycle chain

The composite trace verifies the complete relation:

```text
ADD evidence-instance-1:v1
  → KEEP
  → REMOVE / RULED_OUT / T3
  → old instance becomes cold
  → later evidence-instance-2:v1 with a new call id
  → REHYDRATE / originating REMOVE=T3 / exact FULL representation
  → KEEP
```

The old tool-call/result instance remains cold. Rehydration creates a new
active evidence instance; it does not resurrect the old Pi message identity.

## Coverage

The zero-provider suite covers:

- equivalent path spellings map to one logical source subject;
- repository and namespace changes produce distinct subjects;
- a removal from one repository/namespace cannot rehydrate evidence from
  another, and two valid lifecycle cycles consume distinct origins;
- content-hash or admitted-Universe-revision changes produce a new version;
- a new call id without a preceding valid `REMOVE` is `ADD`;
- a same-version new call id becomes `REHYDRATE` only after an exact,
  single-use originating `REMOVE`;
- the rehydrated representation binds the exact SourceVersion and requested
  `FULL` kind;
- unavailable observations remain conservative and do not infer absence or
  rehydration; only explicit observer `ABSENT` yields confirmed absence;
- protected-source eviction and tool-call identity remapping fail closed;
- replay of the same normalized trace produces identical transition and trace
  hashes.

## Adversarial checks

The mutation suite deliberately corrupts eight independent contracts:

```text
REHYDRATE → ADD
wrong SourceVersion
missing originating REMOVE
invalid originating REMOVE
reuse of one originating REMOVE
changed content labeled as the old version
protected-source removal
UNAVAILABLE → SOURCE_ABSENT
```

Every mutation must be rejected by the candidate oracle. These checks are
evidence that the oracle is discriminating; they do not authorize a policy
change or live provider run.

## Decision

```text
LC1 deterministic semantic oracle: PASS
Candidate identity semantics:      internally unique for tested cases
Production identity mapping:       NOT AUTHORIZED
policy-v0 change:                  NO_GO
Live provider execution:           NO_GO
CR-004 Active Rewrite:             NO_GO
```

The next decision is a bounded review of this oracle. Only after review and a
new baseline freeze may a separate implementation task consider adding a
provider-neutral identity mapping at the observer/planner seam.
