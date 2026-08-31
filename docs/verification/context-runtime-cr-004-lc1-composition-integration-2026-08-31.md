# CR-004 LC1 — Runtime-Owned Composition Integration Evidence

**Classification:** core active-safety prerequisite

**Status:** `IMPLEMENTED / CREDENTIAL-FREE / LIVE NOT AUTHORIZED`

**Date:** 2026-08-31

**Baseline:** `codex/cr004-lc1-composition@b5a7207`

## Purpose

This follow-up verifies the complete credential-free path from a real Pi read
message through the authoritative repository mapper, the runtime-owned LC1
admission sink, and the enriched observer's next model-call boundary. It adds
no production behavior and does not invoke a provider, Planner, Pi live
session, CR-005 manifest, or Active rewrite.

## Covered boundaries

The integration suite covers four paths:

1. A real temporary Git repository is authoritative over forged Pi tool-result
   text; the mapper admits the verified `FULL` observation through the guarded
   runtime-owned sink, and the next observer boundary materializes it with the
   expected content hash while preserving the original message list.
2. A batch containing one valid read and one unsupported tool is atomic: no
   candidate is admitted, the composition kill switch trips, and a later
   mapping attempt is rejected as stopped.
3. A previously admitted pending observation is preserved by the host snapshot
   when the next context observation fails; the failing boundary trips the
   sticky switch and does not advance the observer state.
4. An authoritative repository-observer failure is quarantined before it can
   reach the runtime-owned host; the host remains without a universe revision
   or model-call result.

The composition's default-disabled, configuration, sink-surface, observer
failure, mapper failure, and extension-registration behavior remains covered by
the dedicated composition suite and its mutation audit in the parent PR.

## Verification result

```text
Dedicated integration suite: 4 tests PASS
Pi integration package:       342 tests / 27 files PASS
Pi integration typecheck:     PASS
git diff --check:              PASS
Provider calls:                0
```

The initial local red test was a fixture error: the rollback case used a
different host session than the mapping request. The request helper was then
made explicitly session-bound; the corrected test passed without any
production-source change.

## Interpretation and limits

This evidence establishes the in-process composition path and its fail-closed
behavior under the tested authority, batch, and rollback failures. It does not
establish cryptographic isolation, cross-process enforcement, durable portable
snapshots, or model behavior. The composition remains observational-only and
returns Pi's original messages unchanged.

```text
Composition integration:      CREDENTIAL-FREE PASS
Runtime-owned admission:      exercised through real mapper
Message rewriting:             NONE
Planner / Active rewrite:      NONE
Live Shadow / Step Plan:       NO_GO pending separate authorization
CR-004 Active Rewrite:         NO_GO
```
