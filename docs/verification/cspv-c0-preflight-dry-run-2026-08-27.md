# CSPV-C0 pre-flight — dry run

- **Status:** `DRY_RUN_COMPLETE` — pipeline verified, zero provider calls
- **Mode:** `DRY_RUN` (`CANVAS_C0_DRY_RUN=1`); no `ModelRuntime`, no provider binding, no session
- **Run identity:** `c0-20260826-1a5906ec` (dry-run generated; single-use, never reusable live)
- **Contract:** [`cspv-c0-run-contract-2026-08-27.md`](../plan/cspv-c0-run-contract-2026-08-27.md)
- **Runner:** `pnpm --filter @canvas-agent/pi-context-integration smoke:c0`
- **Provider calls:** `0`
- **Policy version:** `policy-v0-c0-lifecycle` (real `planWorkingSet`, unmodified)

## Result

All four contract scenarios ran end-to-end through the real planner and the
Gate C evidence evaluator with scripted stand-in messages:

```text
E1 Distractor Elimination  chain=SATISFIED  remove=2  rehydrate=0  verdict=PASS
E2 Wrong Path Recovery     chain=SATISFIED  remove=2  rehydrate=2  verdict=PASS
E3 Phase Shift             chain=SATISFIED  remove=2  rehydrate=2  verdict=PASS
E4 Superseded Evidence     chain=SATISFIED  remove=2  rehydrate=0  verdict=PASS
scenarios=4/4  provider-call records=12  providerCalls=0  wallClockMs=17
```

E2/E3 produced genuine `REMOVE → REHYDRATE` pairs through the unmodified
policy (exact SourceVersion, `HIGH_PRIORITY` horizon pairs at distance 1/1
against the contract constants 3 calls / 5 transitions). No mandatory or
pinned eviction occurred; reason-code coverage and provenance stayed at 1.

## Recorded design boundaries (not defects)

- `evaluateC0Scenario().overall` is `FAIL` for every scenario by design:
  SHADOW mode never materializes, so `NO_UNEXPLAINED_MATERIALIZATION_FAILURE`
  is `NOT_OBSERVED` and blocks a readiness-gate PASS without positive
  evidence; E1/E4 nominal chains contain no REHYDRATE by contract design.
  The composite scenario verdict (`PASS`) means: expected chain satisfied,
  no criterion actively failed, provenance complete, no unexplained decision,
  no stop condition. Both layers are recorded verbatim in `verdicts.json`.
- A scripted logical source is the run-event pair `run/tool-call://<id>` +
  `run/tool-result://<id>` (what the shadow seam actually admits), so
  REMOVE/REHYDRATE counts are 2 per logical source.
- Contract Appendix A rows for `SEARCH_HIT_AFTER_REMOVE`,
  `READ_AFTER_REMOVE` and `DEPENDENCY_DISCOVERED` are not emitted by the
  scripted adapter, consistent with contract §6 (fill-at-review) and the
  frozen corpus.
- In live mode the scenario run-event sources are queued per turn as
  metadata-only external observations through the sanctioned adapter seam;
  real model messages still flow through the real Pi context seam
  (`manifest.json: sourceDerivation`).

## Live execution boundary

Live mode remains gated exactly as the contract requires: a fresh
single-use run identity, `CANVAS_PROVIDER_EXECUTION_MODE=experiment-strict`,
`STEP_PLAN_API_KEY`, and the hard budgets (4 scenario runs / 12 provider-call
records / 60 minutes). The 2026-08-25 Step Plan parity smoke
(`context-runtime-step-plan-provider-parity-smoke-1.md`) is the provider
compatibility precedent; it is not C0 evidence. This dry run is pipeline
evidence only — it does not authorize or substitute for the live canary.

The dry-run report artifacts (manifest/observations/transitions/verdicts)
remain local untracked files under
`research/context-benchmarks/reports/cspv-c0/<run identity>/`, per the
existing raw-evidence policy.
