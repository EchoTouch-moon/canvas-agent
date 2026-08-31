# CR-004 LC1 Production Mapper Instance-Safety Audit — 2026-08-31

## Status

`EXECUTED / CREDENTIAL-FREE / TEST-ONLY ADVERSARIAL AUDIT`

Baseline under test:

```text
codex/cr004-lc1-production-mapper@f318d7172282e9dba1127e72668e215c0907e095
```

This audit does not modify the LC1 production mapping candidate, Planner,
`policy-v0`, Pi provider messages, CR-005 manifests or fixtures, or any live
integration. Provider calls are `0`.

## Question

PR #68 adds stale-order, descriptor, call-binding, and repository-scope guards
to `Lc1ProductionRepositoryMapper`. Those guards are stored in the mapper
instance. The existing external-observation queue receives only the resulting
observation and descriptor, keyed by the path-based `sourceKey`.

The bounded question is therefore:

> Does the candidate remain an authoritative admission barrier across mapper
> instances, mapper restart, and callers that can reach the external queue
> directly?

## Adversarial matrix

| Scenario                                                                      | Result            | Evidence                                                                                                                          |
| ----------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Two fresh mappers complete sequence 2 then sequence 1 for one source          | `OPEN_SAFETY_GAP` | The second mapper has no accepted-order state, accepts the real older observation, and the runtime head rolls back from v4 to v3. |
| Mapper restarts and a different repository supplies the same canonical path   | `OPEN_SAFETY_GAP` | The fresh mapper has no source-scope state; the path-based runtime source is replaced by repository B content and authority.      |
| A caller queues an external observation without using the mapper              | `OPEN_SAFETY_GAP` | The runtime admits older content and untrusted descriptor metadata because mapper-local admission is bypassed.                    |
| Concurrent sequence 1 and sequence 2 complete out of order through one mapper | `PASS`            | Sequence 2 is admitted and the later sequence-1 completion is rejected as `STALE_AUTHORITY`.                                      |
| A replacement mapper explicitly restores the previous mapper snapshot         | `PASS`            | Stale order remains rejected and a same-path cross-scope attempt remains quarantined.                                             |

All repository-backed scenarios use temporary real Git repositories and real
`RepositoryObserver` observations. The tests do not forge the authority result
used to demonstrate multi-instance rollback or scope collision.

## Adjudication

The PR #68 candidate is valid only under a narrower operational contract:

```text
one authoritative mapper instance per runtime session
+ mapper state restored atomically with runtime state
+ no direct external-queue writers outside that admission path
```

The candidate is not yet a process-wide or runtime-owned admission barrier.
Explicit mapper snapshot transfer is a positive preservation mechanism, but the
current API does not make that transfer mandatory and does not prevent bypass.

The path-only repository source identity remains a separate unresolved boundary.
If one runtime session must represent the same canonical path from multiple
repositories, mapper-local collision quarantine cannot by itself provide durable
identity after restart.

## Required next decision

Before any live Shadow or Step Plan execution, choose and validate one core
mechanism:

1. move authoritative ordering, scope binding, and descriptor invariants into a
   runtime-owned admission coordinator that is the only external queue writer;
   or
2. make mapper state shared and mandatory across instances, prevent direct queue
   bypass, and separately define a scoped repository source identity when
   multi-repository coexistence is required.

This audit does not select or implement either repair. PR #68 remains frozen as
the candidate under test.

## Verification

Executed with the bundled Node.js 24 runtime and provider calls disabled:

| Check                       | Result                            |
| --------------------------- | --------------------------------- |
| Instance-safety audit       | `5 / 5 PASS`                      |
| Pi context integration      | `25 files / 307 tests PASS`       |
| Context Runtime             | `9 files / 143 tests PASS`        |
| Repository Observer         | `2 files / 39 tests PASS`         |
| Workspace format check      | `PASS`                            |
| Workspace lint              | `PASS`                            |
| Workspace typecheck         | `PASS`                            |
| Workspace build             | `PASS`                            |
| Production dependency audit | `PASS — no known vulnerabilities` |
| Diff and credential scan    | `PASS`                            |

The complete local workspace test command reached the desktop package with 31
files and 186 tests passing. Five Electron-dependent desktop suites did not
start because the offline temporary worktree intentionally installed with
scripts disabled and therefore had no Electron binary. The independently
executed packages in this audit were all green; remote CI remains the
authoritative Electron gate.

## Gate state

```text
PR #68 candidate:             FROZEN / SINGLE-INSTANCE BOUNDARY CONFIRMED
Multi-instance safety:        OPEN_SAFETY_GAP
Restart without state:        OPEN_SAFETY_GAP
Direct queue bypass:          OPEN_SAFETY_GAP
Provider calls:               0
Live Shadow / Step Plan:      NO_GO
CR-004 Active Rewrite:        NO_GO
```
