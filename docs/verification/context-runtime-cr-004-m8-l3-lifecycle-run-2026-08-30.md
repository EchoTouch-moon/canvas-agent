# CR-004 M8 L3 lifecycle screen — durable evidence summary

- **Run:** `cr004-m8-20260830-a47d92c1`
- **Series:** `M8-l3-lifecycle-exposure`
- **Status:** `EXECUTED / EXPOSURE_OBSERVED`
- **Execution date:** 2026-08-30
- **Baseline commit:** `fdd6016b36e661da7c84ac5d7edfd3e1326ebb45`
- **Contract:** `docs/plan/cr004-m8-l3-lifecycle-exposure-run-contract-2026-08-30.md`
- **Contract SHA-256:** `5adb0a5dfae781d58f4eb6d16426e7dd780905bcd8ba187b8fb3bae37f61f6f4`
- **Provider:** Step Plan / `step-3.7-flash`
- **Fallback:** disabled (`fallbackUsed=false`)
- **Provider configuration hash:** `dbcbff3eb4549710faaa018aab784dbb56c3082dae673931c50cb15d999eabc8`

This document records the independent M8 L3 screen. It is not a retry of
M6/M7, a continuation of Wave A, or authorization for CR-004 production or
active rewrite behavior. The raw report remains outside Git as machine
evidence; the evidence-root audit was run after offline analysis.

## Registered design and boundary

M8 used the frozen L3 noisy bug-hunt manifest and fixture with all registered
arms, eight repetitions per arm, and seeded randomized arm order:

```text
L3 × (NATIVE, ACTIVE_V2, ACTIVE_V3, ACTIVE_V4) × 8 repetitions = 32 legs
per leg: 40 semantic calls / 120 tool calls / 600 s
matrix: 1,800 provider-call records / 18,000,000 ms
```

The run changed no policy, fixture, manifest, Pi input, compaction setting,
safety guard, or production default. V4 kept the registered two-candidate
threshold. The only new registration was the M8 profile/contract binding;
the direct before/after telemetry came from the M7 implementation already
present in the baseline.

## Evidence closure

All registered legs completed without a leg or matrix failure:

| Measure | Result |
| --- | ---: |
| Legs attempted | 32 / 32 |
| Legs completed | 32 |
| Legs failed | 0 |
| Provider-call records | 320 |
| Tool calls | 472 |
| Run elapsed time | 748,639 ms |
| Settled per-leg wall-clock total | 741,863 ms |
| Matrix stops | 0 |
| Kill-switch trip | none |
| Observation/record-count mismatches | 0 |

The primary oracle passed all legs:

```text
NATIVE:     8 / 8
ACTIVE_V2:  8 / 8
ACTIVE_V3:  8 / 8
ACTIVE_V4:  8 / 8
```

The evidence-root audit returned:

```text
runId              MATCH
codeCommit         MATCH
contractPath       MATCH
contractSha256     MATCH
manifestSha256     MATCH
providerConfigHash MATCH
legsRoot           MATCH
analysisSha256     MATCH
```

Evidence-root fields:

```text
manifestSha256: cdc1b263fa8732ec963359e7d21f01d68604c7bff19a349de9a8088ad78c675f
legsRoot:       4ae949737268b1d3ad9cd2a3e4159d5f7147d9e0c4ce0f36c76c70d39a658787
analysisSha256: 7d410bc43326be8f8cc30b24657ca411455c46fc68f20ac58acebc81aa84fdde
```

## Lifecycle and direct-exposure observations

The L3 cells separated the existing mechanisms more clearly than the M7
L1/L2 screen:

| Arm | Attempts / sends | Lifecycle signals | Direct rewrite measurement |
| --- | ---: | --- | --- |
| NATIVE | 0 / 0 | control | not applicable |
| ACTIVE_V2 | 4 / 4 | 4 candidates, 4 removed blocks, 8 retained latest reads, 3 re-read signals, 5 post-first-read signals | 4 / 4 complete, all positive |
| ACTIVE_V3 | 0 / 0 | no dedup or verification-window intervention observed | none |
| ACTIVE_V4 | 0 / 0 | 1 below-threshold batch deferral | none |

The four V2 sends occurred in one L3 V2 repetition and had the following
complete internal model-visible estimate reductions:

```text
381, 389, 421, 439
mean: 407.5
```

Every measured send had before/after estimates and message counts. Positive
net means the composed model-visible Pi message set was smaller at that
intervention boundary. These are internal context estimates, not provider
token counts, billing quantities, or cost savings.

The three V2 re-read signals and five post-first-read signals establish that
the L3 trace can produce later demand after an intervention. They remain
rehydrate-demand / false-removal-candidate observations only; this run has no
independent harm oracle that would justify calling any removal confirmed
false.

The lack of V3 sends and the lack of V4 sends are also bounded observations:
they show no exposure under this L3 task, these frozen policies, and this
eight-repetition screen. They do not prove that either policy is globally
ineffective. The single V4 batch deferral demonstrates the threshold gate was
active, not that the threshold is optimal.

## Decision

Under the M8 contract, at least one sent Active rewrite had complete direct
before/after telemetry and the evidence passed all binding, replay, safety,
and budget checks:

```text
M8 result: EXPOSURE_OBSERVED
```

The mechanism-specific interpretation is:

```text
L3/V2: observed exposure with four measured sends
L3/V3: no exposure observed in this screen
L3/V4: no send; one below-threshold deferral observed
```

This is not a Gate B pass, CR-004 readiness decision, efficiency or
superiority result, Native-versus-Active causal result, provider-cost result,
or proof that a re-read is a false removal.

## Historical and next-step policy

The M8 identity and raw evidence are terminal historical evidence and must
not be resumed or overwritten. No M8 retry is warranted by this result.

The combined M7/M8 evidence now supports a more focused next design question:
whether the runtime should optimize for a policy-specific exposure envelope
(`V2` coarse stale-read replacement, `V3` verification-window dedup, or `V4`
batch threshold) before any Active rewrite is considered for production.
Any next live screen needs its own pre-registered contract and identity. It
must not silently change the V4 threshold or reinterpret no-exposure cells as
policy success.
