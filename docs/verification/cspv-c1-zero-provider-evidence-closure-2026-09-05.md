# CSPV C1 Zero-Provider Evidence Closure

Status: `DRAFT / ZERO_PROVIDER_EVIDENCE_CANDIDATE`

Date: 2026-09-05

## Purpose

This report records the bounded, credential-free evidence closure performed after
`C1_USAGE_CONTRACT_AMENDMENT_V1` and PR #98 were merged. It does not authorize a
new study, create a study identity, or make any Provider or network call.

## Frozen baseline and scope

| Item | Binding |
| --- | --- |
| Repository baseline | `main@583ecb74623b77dce2238f67faba1b2e046aaa9b` |
| PR #98 | merged; implementation revision `55d834483ba044099e0be8d64b95028becabb014` |
| C1 usage amendment | `C1_USAGE_CONTRACT_AMENDMENT_V1`, frozen and merged |
| Provider execution | not authorized; zero Provider/network calls |
| Study identity | no new identity created |
| Frozen inputs | C1 protocol, task manifest, run contract, assignment, fixtures, treatment and historical evidence unchanged |

The closure package contains only zero-provider evidence assets:

1. a machine-readable C0/C1 usage source map;
2. a bounded audit of the formal C1 treatment entry and its dry-run boundary;
3. a pure offline C1 adjudicator exercised on synthetic metadata-level pairs;
4. this verification record and the current-state index update.

## Verification summary

| Check | Result | Evidence boundary |
| --- | --- | --- |
| C1 usage source map | `PASS / CANDIDATE` | Distinguishes C0 normalized usage from C1 Provider usage; does not authorize execution |
| Formal treatment entry audit | `PASS` | Factory-injected formal entry is separated from the scripted dry-run wrapper |
| Existing C1-C readiness binding | `PASS / PRESERVED` | Existing zero-provider readiness remains bound to its recorded baseline, treatment revision and hashes |
| Offline comparative adjudicator | `PASS` | Synthetic pairs cover frozen primary, reliability, secondary and lifecycle semantics |
| Provider calls | `0` | No credential, response, or network path was opened |
| Network requests | `0` | No external request was attempted |

## Usage-source boundary

The source map keeps the two usage pipelines separate:

- C0 retains its normalized ledger semantics and source module.
- C1 reads Provider-reported `inputTokens`, `outputTokens` and `totalTokens` from
  the Authorized Provider path.
- C1 cache splits remain tagged as `REPORTED` or
  `UNAVAILABLE / NOT_REPORTED_BY_PROVIDER`; absence is never converted to zero,
  estimated, or derived values.
- C0 and C1 fields are not concatenated, summed, or substituted for one another.

The map is a zero-provider evidence candidate, not a new usage contract and not
an authorization record.

## Formal treatment-entry audit

The audit checks the source-level formal entry in `c1-live-study.ts` and records
the following boundaries:

- `responseSourceFactory`, `observationSourceFactory` and `toolExecutorFactory`
  are injected at the formal entry;
- the formal path binds the requested arm through the frozen study plan;
- scripted response/observation sources are confined to the explicit dry-run
  wrapper;
- synthetic lifecycle markers are not injected by the formal entry;
- the existing C1-C readiness result remains `PASS` with `providerCalls=0`.

This is an entry and boundary audit. It does not claim that a live Provider run
has occurred or that model-generated lifecycle signals have been observed.

## Offline adjudicator evidence

The pure adjudicator consumes already normalized, metadata-level synthetic input.
It does not read credentials, call a Provider, mutate the frozen corpus, or alter
the treatment.

The exercised cases cover:

- `BETTER`, `WORSE`, `TRADE_OFF` and `INCONCLUSIVE` outcomes;
- the single primary endpoint and exact distributional sign-flip semantics;
- per-stratum and pooled coverage requirements;
- task non-inferiority and Runtime attrition;
- protected secondary regression guards;
- missing usage and zero-denominator handling without imputation;
- aborted/stopped/infrastructure classifications;
- lifecycle `ESTIMABLE`, `NOT_ESTIMABLE` and `NOT_APPLICABLE` preservation.

The adjudicator does not promote exploratory endpoints, infer Provider costs,
turn missing usage into zero, delete inconvenient outliers, or treat a token
reduction alone as `BETTER`.

## Current gate

```text
C1_PROTOCOL_V1                         FROZEN
C1_A_MANIFEST_V1                       FROZEN
C1_RUN_CONTRACT_V1                     FROZEN
C1_USAGE_CONTRACT_AMENDMENT_V1         FROZEN / MERGED
C1-C treatment readiness               FROZEN / PASS
C1 study orchestration                 MERGED / ACCEPTED
PR #98 adapter compatibility            MERGED / CI_GREEN

Zero-provider closure package          PASS / CANDIDATE
New study identity                     NO_GO
Provider execution                     NO_GO
C1 Live                               NO_GO
CR-004                                NO_GO
Wave B                                NO_GO
Old study resume/reuse                 FORBIDDEN
```

This package is ready for bounded remote review. It does not itself freeze a
new effective contract, reopen the retired study, or grant C1 Live authorization.
