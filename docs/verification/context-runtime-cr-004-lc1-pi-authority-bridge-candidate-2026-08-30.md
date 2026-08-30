# CR-004 LC1 Pi-to-Authority Bridge Candidate

Date: 2026-08-30
Status: `EXECUTED / CREDENTIAL-FREE / TEST-ONLY CANDIDATE`
Baseline: `codex/cr004-lc1-seam-evidence@0b77903`
Scope: test fixture, deterministic tests, and evidence only

## Purpose

This packet evaluates a candidate bridge between the existing Pi observation
seam and the LC1 logical-source identity model. It does not implement a
production adapter, change `policy-v0`, rewrite Pi messages, or call a
provider.

The candidate deliberately assigns different responsibilities to three layers:

```text
Pi context seam
  exact tool-call/result identity + repository path hint
        ↓
authoritative repository adapter
  repository + namespace + normalized path + version/status metadata
        ↓
LC1 identity mapper
  logical subject + SourceVersion + evidence instance + lifecycle decision
```

This separation is required because the current Pi seam exposes an event-bound
source key and a path hint, but does not by itself prove repository version,
absence, or rehydration.

## Candidate behavior exercised

### Positive lifecycle

Two `read` tool events use different Pi call IDs and the second uses a path
alias (`./src\\reopen-a.ts`). The authority supplies the same repository,
namespace, content hash, Universe revision, and `FULL` representation for both
events.

```text
Pi call-1 + authority v3
  → ADD
  → REMOVE / RULED_OUT
Pi call-2 + authority v3
  → REHYDRATE / originating REMOVE T2
  → KEEP
```

The candidate produces the same logical subject and SourceVersion, but a new
evidence instance. The evidence call IDs are explicitly namespaced as
`pi-evidence:v1:<runtime-session>:<tool-call-id>` so a repeated upstream call
ID cannot silently alias evidence from another runtime session.

### Version boundary

The same path with a changed authoritative content hash and Universe revision
is not treated as a rehydration of the old version:

```text
old v3 → REMOVE
new v4 → ADD, new SourceVersion, no originating REMOVE
```

The bridge therefore uses authority-provided content/version metadata rather
than the current Pi provisional semantic hash, which is event-bound.

### Fail-closed cases

The bridge emits no available evidence when the required relationship cannot be
established. The tests cover:

- no authoritative source;
- ambiguous authority for one normalized path;
- explicit `UNAVAILABLE` with conservative `KEEP` semantics;
- explicit observer `ABSENT`, without inferring absence from missing authority;
- unsafe path hint and missing call ID;
- unsupported tool and call ID remapping;
- same path under a different repository identity.

## Results

```text
Bridge candidate lifecycle:       PASS (5/5 test cases)
ADD → REMOVE → REHYDRATE:          PASS
Changed version → not REHYDRATE:  PASS
Authority and safety fail-closed: PASS
Session evidence namespacing:     PASS
Cross-repository isolation:       PASS
Provider calls:                    0
Production files changed:         0
Pi messages rewritten:             NO
policy-v0 changed:                NO
```

The tests are an executable exploration of the mechanism, not a claim that the
production Pi integration already implements it.

## Adjudication and limits

```text
Test-only bridge contract:        ACCEPTABLE CANDIDATE
Production identity mapping:      NOT IMPLEMENTED
Repository authority adapter:     NOT IMPLEMENTED
Live Shadow lifecycle:             NO_GO
CR-004 Active Rewrite:             NO_GO
```

The synthetic authority is supplied directly by the test. No real repository
observer, git revision stream, concurrent tool execution, or persisted
cross-session store is exercised. The bridge also does not decide when a
source should be removed; it only supplies identity-safe evidence to the LC1
candidate mapper. Those decisions remain the responsibility of a separately
reviewed policy/runtime layer.

This result is therefore classified as a mechanism candidate, not as a
production capability result and not as a harness failure.

## Recommended implementation boundary

If Lead review accepts this candidate, the next implementation task should be
separate and read-only at first:

1. expose an authoritative repository observation callback with explicit
   `AVAILABLE`, `UNAVAILABLE`, and `ABSENT` authority;
2. normalize and namespace logical source identity before promotion;
3. derive SourceVersion from authority content/revision, independent of Pi event
   ID;
4. keep event/evidence identity separate from the logical subject;
5. reject ambiguous, unsafe, remapped, or unverified observations;
6. replay the same Pi-to-authority trace deterministically before any Active
   rewrite or provider experiment.

The candidate does not authorize that implementation, a `policy-v0` change, or
live/provider execution. Those require a new baseline and a separate decision.
