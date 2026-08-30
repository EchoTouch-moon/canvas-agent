# CR-004 LC1 Runtime-Owned Repository Admission Candidate

**Classification:** core active-safety prerequisite

**Status:** `EXECUTED / CREDENTIAL-FREE / EXPERIMENTAL CANDIDATE`

**Date:** 2026-08-31

**Baseline:** `codex/cr004-lc1-runtime-admission-contract@dffcc2b`

## Scope

This packet implements the runtime-session-owned repository admission mechanism
selected by the preceding contract. It changes only the experimental LC1
repository mapper/admission boundary, its tests, and this evidence record.

It does not change Planner policy, CR-005 manifests or fixtures, model-provider
routing, model-facing Pi messages, the default historical Shadow observer, or
Active context rewrite behavior. Provider calls are zero.

## Implemented boundary

The candidate introduces an experimental `Lc1RuntimeRepositoryAdmissionHost`:

```text
Pi read evidence
  -> Lc1ProductionRepositoryMapper
  -> exact RepositoryObserver authority
  -> frozen mapper-owned candidate
  -> runtime-session admission coordinator
  -> private Enriched observer queue
  -> next model-call Universe reconciliation
```

The runtime owner, rather than a mapper instance, now owns:

- one bound `(repositoryId, namespace)` scope;
- accepted authority order and descriptor fingerprint per logical path;
- Pi call-id bindings;
- batch admission and explicit accepted/rejected/quarantined outcomes; and
- an in-memory transaction snapshot covering both admission and observation
  state.

Mapper instances may be replaced or complete concurrently without discarding
that state. The legacy general external-observation queue is not exposed by the
new host.

## Fail-closed controls

The candidate rejects or quarantines:

- stale, equal-order conflicting, or incomparable authority;
- call-id remapping, descriptor drift, and cross-scope collisions;
- malformed revisions, observations, paths, evidence ids, and JavaScript input;
- candidate copies that merely retain the module symbol brand but do not retain
  mapper-created object identity;
- repository/file constructor seeds that would bypass admission;
- any mixed batch containing a mapper or coordinator failure; and
- transaction snapshots with a different owner, runtime session, admission
  hash, or host-level hash.

Candidate provenance is enforced with a package-internal `WeakSet` and frozen
envelopes. The creation capability is not exported by the package's public or
experimental entry point. This is an in-process programmatic integrity boundary,
not a cryptographic signature or a defense against arbitrary code already
executing inside the package module graph.

## Credential-free oracle

The frozen PR #69 legacy audit remains unchanged and continues to reproduce the
three pre-coordinator gaps:

| Legacy path finding                                      | Result            |
| -------------------------------------------------------- | ----------------- |
| two mapper instances admit sequence 2 then sequence 1    | `OPEN_SAFETY_GAP` |
| mapper restart admits another repository at the same key | `OPEN_SAFETY_GAP` |
| direct legacy queue bypasses mapper guards               | `OPEN_SAFETY_GAP` |

The new runtime-owned path converts those findings into protected outcomes and
adds adversarial coverage:

| Runtime-owned oracle                                             | Result |
| ---------------------------------------------------------------- | ------ |
| independent and concurrent mapper stale completion               | PASS   |
| same-scope mapper replacement                                    | PASS   |
| different-scope mapper replacement                               | PASS   |
| raw queue/inner observer unavailable                             | PASS   |
| repository seed bypass rejected; non-repository seed retained    | PASS   |
| unregistered or copied-brand candidate rejected                  | PASS   |
| malformed candidate/batch returns typed failure                  | PASS   |
| duplicate/conflicting/incomparable authority distinguished       | PASS   |
| descriptor and call-binding invariants                           | PASS   |
| coordinator and mapper mixed-batch failure atomicity             | PASS   |
| `AVAILABLE -> UNAVAILABLE -> UPDATE -> ABSENT` lifecycle         | PASS   |
| rollback/replay without mapper state                             | PASS   |
| admission and host snapshot tamper rejection before state change | PASS   |
| duplicate in-process runtime-session ownership rejected          | PASS   |
| new runtime session may bind a new repository scope              | PASS   |

The audit file contains 27 tests: five frozen legacy/audit cases and 22
runtime-owned cases.

## Verification

```text
Pi Context Integration typecheck: PASS
Targeted LC1 audit:               1 file / 27 tests PASS
Pi Context Integration:          25 files / 329 tests PASS
Context Runtime:                 9 files / 143 tests PASS
Repository Observer:             2 files / 39 tests PASS
Provider calls:                  0
```

Local repository-wide verification was then completed with the repository's
required Node 24 runtime. The isolated worktree had intentionally skipped
Electron postinstall, so the desktop tests used the already-installed,
lockfile-identical Electron 39.8.10 binary from the main workspace through
`ELECTRON_OVERRIDE_DIST_PATH`; no dependency or lockfile was changed.

```text
Format check:                         PASS
Lint:                                 PASS
Workspace typecheck:                  PASS
Workspace tests:                      PASS
Desktop tests:                        36 files / 251 tests PASS
Workspace build:                      PASS
Production dependency audit (npm):    PASS / no known vulnerabilities
Diff check:                           PASS
Changed-file credential-pattern scan: PASS / no findings
```

GitHub CI run `33325574486` then verified implementation head `f0c515a`:

```text
Linux check:                    PASS
macOS Electron Product MVP RC: PASS
```

## Explicit boundaries

1. Authority order remains per logical path, as frozen by the LC1 contract. The
   candidate does not introduce a scope-global repository clock.
2. Transaction snapshots are same-host, in-memory rollback tokens. They are not
   a persisted or cross-process restart format.
3. A second host cannot claim an already-used runtime session id in the same
   process. A process restart must use a new runtime session identity until a
   separately designed durable admission snapshot protocol exists.
4. The path-based `repository/file://<canonicalPath>` identity remains valid
   only under the one-repository-scope-per-runtime invariant. Scoped source
   identity v2 remains a future direction triggered by a real multi-repository
   runtime requirement.
5. The historical `EnrichedPiShadowObserver` queue remains available for old
   tests and Shadow evidence. Safety is obtained only when a production
   composition explicitly selects this runtime-owned host; that composition is
   not authorized by this packet.

## Gate state

```text
Runtime-owned admission candidate: IMPLEMENTED / CREDENTIAL-FREE
Frozen legacy gaps:                PRESERVED AS AUDIT EVIDENCE
Targeted mechanism oracle:         PASS
Local repository-wide verification: PASS
Remote Linux/macOS CI:              PASS (run 33325574486 on f0c515a)
Production composition selection:  NOT IMPLEMENTED
Portable restart protocol:         NOT IMPLEMENTED
Provider calls:                     0
Live Shadow / Step Plan:            NO_GO
CR-004 Active Rewrite:              NO_GO
```

The next gate is remote Linux/macOS zero-provider CI and bounded Lead
implementation review. This candidate does not itself authorize a live model
experiment.
