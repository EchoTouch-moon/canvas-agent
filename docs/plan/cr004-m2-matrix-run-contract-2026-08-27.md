# CR-004 M2 Matrix Run Contract — Three-Arm Policy A/B Matrix (NATIVE / ACTIVE v1 / ACTIVE v2)

## 1. Header block

| Field | Value |
| --- | --- |
| Status | `AUTHORIZED (Lead direction 2026-08-27 morning: "run it again per lever point 1") — no further per-run approval required` |
| Date | 2026-08-27 |
| Artifact | Mandatory reviewed run contract before the CR-004 M2 THREE-ARM matrix run (removal-policy v1 vs v2 A/B plus NATIVE control) |
| Authorization | Lead direction given the morning of 2026-08-27, quoted verbatim above: run the matrix again per improvement lever point 1 of the M1 analysis (coarser removal), which this contract implements as the two data-named levers (coarse multi-block sweeps + retain-latest) |
| Cost ceiling | `WAIVED by Lead direction` (token consumption unconstrained; the mechanical budgets in §7 remain in force as stop conditions, not as cost control) |
| Provider calls during drafting | `0` |
| Sibling contracts | [M1 matrix contract](./cr004-matrix-run-contract-2026-08-27.md) (executed 18/18) · [Stage 1 single-pair contract](./cr004-stage1-run-contract-2026-08-27.md) · [CSPV-C0 run contract](./cspv-c0-run-contract-2026-08-27.md) (binding discipline) |
| Primary upstream evidence | [M1 matrix run analysis](../verification/cr004-matrix-run-analysis-2026-08-27.md) — the data that names the levers this run tests (§5.1) |
| Task fixtures | The SAME three L-task manifests under `research/context-benchmarks/matrix-manifests/` that M1 consumed (read-only, unmodified) |

The Lead authorization this contract records: re-run the matrix per lever point 1 of
the M1 improvement levers. Authorization removes the approval step, never a stop
condition; the contract still fails closed mechanically.

## 2. Run identity

```text
format      cr004-m2-<ISO-date-undashed>-<8-hex>
example     cr004-m2-20260827-4d7e9a1b
freshness   generated once by the matrix runner (suggest + refuse pattern)
uniqueness  MUST NOT collide with any prior run identity in any evidence store
scope       one identity covers ALL 27 legs (§5) of the single M2 matrix run
```

Validation accepts BOTH `cr004-m1-*` (consumed M1 identities, for offline
analysis of M1 evidence dirs) and `cr004-m2-*`; new runs are M2 only. Binding
rules inherit the C0/Stage 1/M1 discipline: single-use identity; a terminal run
is never retried or resumed under the same identity; one binding per run, no
rebinding after execution starts; never collides with the consumed C0
(`c0-20260827-8cdb65c4` / `c0-20260827-9faf18ac` / `c0-20260827-46eca174`),
Stage 1 (`cr004-s1-20260826-38bd266f`, `cr004-s1-20260826-1f75a6fa`), M1
(`cr004-m1-20260826-609ef8a9` aborted, `cr004-m1-20260826-d23a992c` clean) or
Wave A identities.

## 3. Provider and model profile

Identical to M1 (single-model run; cross-model replication stays out of scope):

| Field | Value |
| --- | --- |
| Provider | `step-plan` / `step-3.7-flash` |
| Credential | `STEP_PLAN_API_KEY`, resolved in memory only, never recorded |
| executionMode | `experiment-strict`, `fallbackUsed = false`, fallback provider `none` |

ONE strict binding (`prepareModelProvider` once) for the WHOLE matrix — all 27
legs share the single binding and `providerConfigHash`. A
`PROVIDER_BINDING_FAILURE` at strict preparation is the matrix-terminal stop
S-1. A provider failure DURING a leg is a leg-level failure (§6): that leg is
marked FAILED and the matrix continues; no provider switch ever occurs.
Recorded divergence (unchanged): the L-manifests pin a DeepSeek-class model
profile; this run binds `step-plan/step-3.7-flash`; no cross-baseline
comparison is claimed.

## 4. Task manifests — the same three L-tasks

The M1 fixtures are reused verbatim (L1 multi-file refactor, L2 TTL cache
feature, L3 noisy bug hunt; 14–16 files each): the same manifests under
`research/context-benchmarks/matrix-manifests/`, resolved read-only at start,
REFUSAL on missing/ambiguous manifest or (live mode) missing fixture directory.
Per-leg budget envelope unchanged: `maxSemanticCalls 40 / maxToolCalls 120 /
wallClockMs 600000`.

## 5. Matrix design — 27 legs, one identity, one binding, three arms

```text
3 tasks (L1, L2, L3) x 3 strategies (NATIVE, ACTIVE, ACTIVE_V2) x 3 repetitions = 27 legs

leg order (deterministic, interleaved):
  for rep 1..3 { for task L1,L2,L3 { NATIVE, ACTIVE, ACTIVE_V2 } }

rep1: L1-NATIVE, L1-ACTIVE, L1-ACTIVE2, L2-NATIVE, L2-ACTIVE, L2-ACTIVE2,
      L3-NATIVE, L3-ACTIVE, L3-ACTIVE2
rep2/rep3: ... (same)
```

| Strategy | Context path | Role |
| --- | --- | --- |
| `NATIVE` | unmodified model-facing context; observer-only extension | control (M1 semantics unchanged) |
| `ACTIVE` | bounded repeated Active rewrite, removal policy `v1-per-edit` (5 sends / 8 attempts) | treatment A — the M1 arm, unchanged |
| `ACTIVE_V2` | the SAME Active rewrite seam, removal policy `v2-retain-latest-coarse` (8 sends / 12 attempts) | treatment B — the lever-point-1 policy |

Evidence directory naming: `L1-ACTIVE-repN` keeps its M1 (v1) meaning; the new
arm writes `L1-ACTIVE2-repN`. Control precedes both treatments inside every
task x repetition cell; v1 precedes v2 so the M1 replication comparison stays
primary and the policy A/B is nested inside it. Every leg: fresh temp fixture
copy, manifest allowedTools verbatim, the single manifest prompt issued once,
per-leg oracle + regression + writable-conformance checks, fixture summary.

### 5.1 Removal policy v2 semantics (what ACTIVE_V2 changes, and why)

M1 measured, on the same tasks with the same binding
([analysis](../verification/cr004-matrix-run-analysis-2026-08-27.md)):

- only **8/31** sent interventions produced a net context drop at the next
  model call — one removed block per edit boundary is too fine to bend the
  trajectory (lever (a): coarser removal);
- **11 re-reads of removed targets**, L2 worst at **5/6** post-intervention
  reads — removing the freshest read a model still needs forces a re-fetch
  that inflates the ACTIVE totals (lever (b): retention awareness).

Policy v2 (`v2-retain-latest-coarse`) implements both data-named levers; the
composer/guard seam is UNCHANGED — v2 only changes WHICH read pairs the
lifecycle signals mark superseded before planning:

- At each intervention boundary — SAME trigger as v1: a NEW edit/write-class
  toolCall observed — the sweep covers EVERY edited path, not just the trigger
  path: for EVERY path E with at least one edit toolCall in the basis, every
  still-active read pair for E is marked superseded EXCEPT the LATEST read for
  E (**retain-latest**: the model keeps the freshest content it saw, so it
  never needs to re-fetch — targets the L2 re-read pattern).
- Reads of paths with NO edit toolCall are NEVER removed (conservative:
  unedited exploration stays).
- One intervention may remove many blocks at once (**coarse sweeps**), bounded
  by `maxBlocksPerIntervention = 12`: with more candidates the OLDEST are
  removed up to the cap and the rest wait for the next boundary.
- Per-leg bounds for the v2 arm are RAISED to **8 sends / 12 attempts**
  (option-driven; the extension defaults and the Stage 1 frozen 1/1 and C0
  behavior are unchanged — v1 remains the default policy).
- Telemetry per intervention: `policy`, `candidateBlocks`, `removedBlocks`,
  `retainedLatestReadTargets` (readTargetHash of the kept latest per swept
  path), on top of the full M1 intervention telemetry.

Deterministic offline coverage: the v2 sweep (retain-latest, unedited-path
conservatism, the oldest-first cap and its next-boundary continuation, and the
v1 regression) is tested through the REAL planner in
`packages/pi-context-integration/tests/cr004-policy-v2.test.ts`; provider calls 0.

All other M1 multi-intervention semantics carry over unchanged to both
treatment arms: boundaries are never re-attempted (by edit toolCallId), read
pairs are never removed twice, failed attempts consume attempts but not sends,
removals CARRY for the rest of the leg, guard-trip and kill-switch semantics
are identical (a guard `FALLBACK_NATIVE` trips the per-Run kill switch
permanently — the leg continues natively as S-5 evidence; neither ends the
matrix).

## 6. Stop policy — leg-level continue, matrix-level terminal (unchanged from M1)

| ID | Condition | Scope |
| --- | --- | --- |
| S-1 | strict provider binding failure at preparation | MATRIX-TERMINAL |
| S-7 | matrix totals breach (600 provider-call records / 180 minutes; checked between legs — over budget => stop launching new legs, evidence preserved) | MATRIX-TERMINAL |
| S-8 | operator kill-switch file: a trip between legs (or inside an Active leg) is MATRIX-TERMINAL — no later Active leg may run rewrite-free under a treatment label (the M1 aborted-run contamination fix, kept verbatim) | MATRIX-TERMINAL |
| S-1..S-9 (any) | provider/safety/validation error, replay mismatch, protected removal, or per-leg manifest-budget breach inside ONE leg | LEG-FAILED only — the leg is marked FAILED with its stop condition and the matrix CONTINUES |

Only matrix-level S-1 (binding), S-7 (totals) and S-8 (operator kill switch)
stop everything. A failed leg still evidence-closes (observations flushed, leg
record written) before the matrix moves on. S-5 guard fallbacks are recorded
evidence, not leg failures. No degradation path: no retry, no provider switch,
no mid-run budget change, no continuation under the same identity after a
matrix-terminal stop.

## 7. Budgets

| Budget | Limit | Scope |
| --- | --- | --- |
| Legs | 27 (3 x 3 x 3), fixed order | matrix |
| Provider-call records | 600 total across the matrix (C0 counting semantics; raised from M1's 400 for the third arm) | matrix, hard-fail S-7 |
| Wall clock | 180 minutes from strict preparation to evidence-close, watchdog checked between legs | matrix, hard-fail S-7 |
| Per-leg semantic calls | manifest `maxSemanticCalls` (expected 40) | leg |
| Per-leg tool calls | manifest `maxToolCalls` (expected 120) | leg |
| Per-leg wall clock | manifest `wallClockMs` (expected 600000), post-hoc | leg |
| Interventions per ACTIVE leg | 5 sends / 8 attempts (v1 arm — M1 values) | leg (bounded observe-only after) |
| Interventions per ACTIVE_V2 leg | 8 sends / 12 attempts (v2 arm — raised) | leg (bounded observe-only after) |
| Blocks per v2 intervention | 12 (oldest-first; leftovers wait for the next boundary) | intervention |
| Token / cost | `WAIVED by Lead direction` | — |

Matrix totals are deliberately larger than the worst case (27 x 40 = 1080
potential records vs 600 allowed): if live legs run hot, the matrix stops at
the total with all completed-leg evidence preserved — intended fail-closed
behavior, not a defect.

## 8. Evidence plan — incremental, never buffered (layout identical to M1)

Layout under `research/context-benchmarks/reports/cr004-matrix/<runId>/` (same
root as M1; the run identity separates them), manifest field
`matrixDesign: "M2-three-arm"`:

```text
manifest.json                                binding, budgets, ledgers, stop
                                             conditions, legs index, the M2
                                             design (arms, v2 policy + bounds,
                                             leg order) — rewritten after
                                             EVERY leg
legs/<task>-<strategy>-rep<N>/leg.json       per-leg full record: oracles,
                                             counts, wallClockMs, trajectory,
                                             intervention telemetry (events,
                                             attempts, sends, fallback reasons,
                                             removedSourceKeys, removedReadTarget
                                             Hashes, policy, candidateBlocks,
                                             removedBlocks, retainedLatestRead
                                             Targets), fixture summary
                                             (ACTIVE_V2 dirs are ...-ACTIVE2-rep<N>)
legs/<task>-<strategy>-rep<N>/observations.jsonl   per-model-call observations
matrix.json                                  aggregate so far (rewritten after
                                             EVERY leg)
analysis.json                                offline analyzer output
```

INCREMENTAL EVIDENCE is mandatory: after EACH leg the runner writes that leg's
directory immediately and rewrites manifest.json + matrix.json. Evidence is
metadata-only (hashes, counts, source keys; never prompts, transcripts,
provider payloads or credentials); raw reports stay local and untracked.

## 9. Measured metrics + non-claims

Per leg (both treatment arms): completion (oracle, regression oracle,
writable-path conformance), tool-call count, provider-call record count,
wallClockMs, replay mismatches, observed token estimates (internal estimates,
NOT provider token/cost measurements), the context trajectory (per-model-call
`observedMessageTokenEstimate`: peak, final, sum/area), and the full
intervention telemetry including the v2 policy fields and the M1 re-read
detection (post-intervention reads whose `readTargetHash` matches a removed
pair).

Analysis (offline, `--analyze`):

- Per-task THREE cells (task x arm): n, oracle pass rate, mean/median
  records/tools/wall, tokenEstimateSum mean, mean trajectory peak AND final,
  trajectory sum.
- Exact permutation tests over tokenEstimateSum for all THREE arm pairs per
  task — NATIVE vs ACTIVE (M1 replication), NATIVE vs ACTIVE_V2, and ACTIVE vs
  ACTIVE_V2 (the policy A/B) — each with the explicit n=3 caveat.
- Mechanism metrics PER ACTIVE ARM: interventions sent, `removedBlocks` total
  (with `candidateBlocks`, so cap pressure is visible),
  `retainedLatestReadTargets` total, **drop-at-boundary rate** (fraction of
  SENT interventions where `series[seq-1] < series[seq-2]` — the 8/31 M1
  metric, now per arm), and `reReadsOfRemovedTargets` per arm (the 11-total /
  L2 5-of-6 M1 metric, now per arm).
- Aggregate verdict lines reporting raw per-arm reliability and the
  context-efficiency direction as numbers only.

Non-claims, binding on every reader:

- n = 3 per cell supports DESCRIPTIVE statistics and exact permutation
  p-values only — explicitly low power; **no causal claim** is made or implied
  by this contract or any analysis it produces.
- The policy A/B comparison is one run of one policy pair on one model at
  flash scale; direction-of-numbers reporting is not an effect estimate.
- No quality, provider-cost or model-efficiency claim. Token figures are
  internal estimates over agent messages pre-provider, not provider usage.

## 10. Out of scope / unchanged

- No product-path change: no Electron, Renderer, Persistence, Worker or public
  contract modification; the Stage 0 composer/guard seam is consumed as-is
  (v2 changes only the lifecycle supersede decisions).
- No planner changes, no modification of the frozen C1–C6 or L-task manifests,
  prompts, fixtures or oracles.
- The Stage 1 single-pair runner keeps `maxInterventions: 1, maxAttempts: 1`
  with the v1 default policy; C0 semantics untouched.
- No compaction arm (still the designed-not-built M1 lever), no cross-model
  replication, no n>=8 confirmatory replication (a later decision).
