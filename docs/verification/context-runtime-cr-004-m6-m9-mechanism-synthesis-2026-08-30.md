# CR-004 M6–M9 mechanism synthesis — 2026-08-30

## Scope and decision

This synthesis combines the bounded evidence from the corrected M6 run, the
M7 direct-exposure screen, the M8 L3 lifecycle screen, and the M9 V3
direct-exposure screen. It separates execution integrity, task validity,
mechanism exposure, and model-visible measurement. It does not pool the runs
as one controlled statistical experiment.

```text
M6 Run 1: excluded for historical manifest arm-order binding defect
M6 Run 2: evidence-closed / inconclusive mechanism comparison
M7:       EXPOSURE_OBSERVED for V4 on L1/L2
M8:       EXPOSURE_OBSERVED for V2 on L3
M9:       EXPOSURE_OBSERVED for V3 on L1/L2

CR-004 Active Rewrite: NO_GO
Wave B:                 NO_GO
New duplicate live run: NOT JUSTIFIED
Next core gap:         lifecycle conformance around later demand / rehydrate
```

The next work item should therefore be a credential-free runtime lifecycle
conformance screen before any new provider experiment. It is not a request to
change `policy-v0`, the Active policy, or production defaults.

## What is now directly observed

The existing policy families have each reached at least one direct
model-visible exposure screen:

| Mechanism | Screen | Direct exposure | Bounded observation |
| --- | --- | ---: | --- |
| V4 `v4-batched-retain-latest` | M7 L1/L2 | 8 complete sends | fixed two-candidate batching was exercised; seven below-threshold deferrals were recorded in M7 |
| V2 `v2-retain-latest-coarse` | M8 L3 | 4 / 4 complete sends | four sends reduced the internal model-visible estimate; later read signals occurred after intervention |
| V3 `v3-verify-window-dedup` | M9 L1/L2 | 16 / 16 complete sends | nine L1 sends and seven L2 sends; two L2 dedup-triggered sends; all direct reductions positive |

These are exposure results, not superiority results. The screens use
different task strata, run identities, repetitions, and execution histories;
their internal estimate values are not provider-token or cost measurements.

## Evidence quality across screens

### M6

The corrected M6 run established that the mechanism matrix can bind and close
without fallback, provenance warnings, budget breach, or evidence-root
mismatch. Its V4 sends had no direct before/after telemetry, so M6 remains
useful as prior exposure evidence but does not replace M7's direct V4
measurement.

### M7

M7 exposed V4 directly on L1/L2. Eight sends had complete before/after
telemetry and positive internal estimate reductions. Nine of 48 legs were
incomplete because of S-9/S-7 deadlines, so partial legs are not clean
comparative endpoints. The run demonstrated a safe exposure envelope, not
that batching improves task performance.

### M8

M8 supplied the strongest lifecycle-demand signal so far: V2 produced four
complete sends on L3, with three re-read signals and five reads after the
first read. V3 and V4 did not send in that L3 screen. The later reads are
`rehydrate-demand` / `false-removal-candidate` observations only; there was no
independent harm oracle that would justify `confirmed-false-removal` or a
production rehydrate claim.

### M9

M9 directly measured V3 on L1/L2 with 32/32 completed legs, 585 provider-call
records, 989 tool calls, zero replay mismatches, zero technical leg failures,
and 16/16 complete direct measurements. L1 and L2 each had 8/8 repetitions
per arm. The run also retained eight task-oracle failures: two L1 primary
objective failures, one L1 V3 writable-scope failure, and five L2
writable-scope failures. These are real task-validity failures, not harness
failures, and they prevent treating every leg as a clean task comparison.

M9 recorded two L2 dedup-triggered V3 sends and five post-first-intervention
read signals in total. It recorded no re-read of a removed target and no
verification-window edit-sweep deferral. The direct measurement therefore
closes the V3 exposure question but not the rehydrate lifecycle question.

## Cross-run mechanism map

```text
V2  ── direct send observed on L3 (M8)
      later reads observed, but no confirmed false removal / explicit rehydrate

V3  ── direct send observed on L1/L2 (M9)
      dedup boundary observed on L2, no edit deferral, no removed-target reread

V4  ── direct send observed on L1/L2 (M7)
      threshold deferrals observed, no evidence of lifecycle recovery
```

The runtime can currently demonstrate that a bounded rewrite can be composed,
guarded, sent, and measured. It cannot yet support the stronger statement
that an earlier removal was later correctly rehydrated with a traceable
source-version relationship.

That is a semantic gap, not evidence that any one policy is globally wrong.
The existing Active extension's later read may make fresh evidence visible,
but M6–M9 do not emit a standalone `REHYDRATE` lifecycle decision with an
originating `REMOVE` reference. We must not rename a later ordinary read as
rehydration after the fact.

## What should not be inferred

The following conclusions remain out of scope:

- V2, V3, or V4 is globally more efficient than Native;
- a positive internal estimate reduction is a provider-token or billing saving;
- higher or lower calls/wall-clock are caused solely by the policy;
- a later read proves a false removal or harmful context loss;
- no observed V3 deferral means the verification-window rule is ineffective;
- the 24/32 fully oracle-passing M9 legs establish general task reliability;
- CR-004 Active Rewrite is ready for production.

M7–M9 all have direct exposure, but they remain small, task-stratified,
repetition-limited screens. The correct interpretation is mechanism
observability plus bounded model-visible measurements.

## Next core work item: lifecycle conformance before another live run

The next work item is a zero-provider `CR-004-LC0` runtime lifecycle
conformance screen. It should exercise the real Active extension/composer/
pre-send guard seam with a deterministic synthetic Pi trace and verify:

```text
initial read / source active
        ↓
edit boundary
        ↓
REMOVE with provenance and binding hashes
        ↓
later-demand read with a new source identity/version
        ↓
fresh evidence active without resurrecting the old removed pair
        ↓
replay and safety verification
```

It should also include deterministic branches for:

1. an edit sweep deferred by an open verification window;
2. a dedup-only boundary allowed inside that window;
3. a later read after removal that is labeled `rehydrate-demand`, not
   `confirmed-false-removal`;
4. an invalid origin or source-version relationship that must fail closed;
5. a guard/composition failure that restores the pre-attempt state exactly.

The suite must use the existing policy unchanged and return a bounded result
such as:

```text
LIFECYCLE_CONTRACT_PASS
LIFECYCLE_CAPABILITY_GAP
HARNESS_CONTRACT_FAILURE
SPEC_AMBIGUITY
```

Only a clean `LIFECYCLE_CONTRACT_PASS` can justify designing a new live
later-demand screen. A capability gap is a valid result and must not trigger
an in-place policy rewrite.

## Authorization boundary

M9 is terminal historical evidence and must not be resumed or retried. The
M6–M9 synthesis does not authorize a new provider run, Wave B, CR-004
production execution, or adaptive policy changes. The LC0 screen is
credential-free and provider-free; any later live lifecycle experiment needs
its own contract, baseline, and explicit run identity.
