# CR-004 M3 Matrix Run Contract — Verify-Window-Dedup Policy A/B (NATIVE / ACTIVE v2 / ACTIVE v3), targeted L2 first

## 1. Header block

| Field | Value |
| --- | --- |
| Status | `AUTHORIZED (Lead direction 2026-08-27: continue per the M2 analysis next-levers) — no further per-run approval required` |
| Date | 2026-08-27 |
| Artifact | Mandatory reviewed run contract before the CR-004 M3 policy A/B matrix runs (removal-policy v2 vs v3 plus NATIVE control), beginning with the targeted L2 run |
| Authorization | Lead direction given 2026-08-27, quoted verbatim above: continue per the M2 improvement levers (the verification-window policy and duplicate-read dedup named in the M2 analysis), which this contract implements |
| Cost ceiling | `WAIVED by Lead direction` (token consumption unconstrained; the mechanical budgets in §7 remain in force as stop conditions, not as cost control) |
| Provider calls during drafting | `0` |
| Sibling contracts | [M2 matrix contract](./cr004-m2-matrix-run-contract-2026-08-27.md) (executed 27/27) · [M1 matrix contract](./cr004-matrix-run-contract-2026-08-27.md) (executed 18/18) · [Stage 1 single-pair contract](./cr004-stage1-run-contract-2026-08-27.md) · [CSPV-C0 run contract](./cspv-c0-run-contract-2026-08-27.md) (binding discipline) |
| Primary upstream evidence | [M2 matrix analysis](../verification/cr004-m2-matrix-analysis-2026-08-27.md) — v2 is cheapest overall (−11%) but L2 stays +81% vs an unusually cheap native cell; verification-heavy reads of edited files are the remaining mass |
| Task fixtures | The SAME three L-task manifests under `research/context-benchmarks/matrix-manifests/` that M1/M2 consumed (read-only, unmodified) |

The Lead authorization this contract records: continue per the M2 next levers.
Authorization removes the approval step, never a stop condition; the contract
still fails closed mechanically.

## 2. Run identity

```text
format      cr004-m3-<ISO-date-undashed>-<8-hex>
example     cr004-m3-20260827-9c1d2e3f
freshness   generated once by the matrix runner (suggest + refuse pattern)
uniqueness  MUST NOT collide with any prior run identity in any evidence store
scope       one identity covers ALL legs (§5) of the single M3 matrix run
```

Validation accepts `cr004-m1-*` and `cr004-m2-*` (consumed identities, so M1/
M2 evidence dirs keep analyzing under `--analyze`) and `cr004-m3-*`; new runs
are M3 only. Binding rules inherit the C0/Stage 1/M1/M2 discipline: single-use
identity; a terminal run is never retried or resumed under the same identity;
one binding per run, no rebinding after execution starts; never collides with
the consumed C0, Stage 1, M1, M2 or Wave A identities.

## 3. Provider and model profile

Identical to M1/M2 (single-model run; cross-model replication stays out of
scope):

| Field | Value |
| --- | --- |
| Provider | `step-plan` / `step-3.7-flash` |
| Credential | `STEP_PLAN_API_KEY`, resolved in memory only, never recorded |
| executionMode | `experiment-strict`, `fallbackUsed = false`, fallback provider `none` |

ONE strict binding (`prepareModelProvider` once) for the WHOLE matrix — all
legs share the single binding and `providerConfigHash`. A
`PROVIDER_BINDING_FAILURE` at strict preparation is the matrix-terminal stop
S-1. A provider failure DURING a leg is a leg-level failure (§6). Recorded
divergence (unchanged): the L-manifests pin a DeepSeek-class model profile;
this run binds `step-plan/step-3.7-flash`; no cross-baseline comparison is
claimed.

## 4. Task manifests — the same three L-tasks

The M1/M2 fixtures are reused verbatim (L1 multi-file refactor, L2 TTL cache
feature, L3 noisy bug hunt; 14–16 files each): the same manifests under
`research/context-benchmarks/matrix-manifests/`, resolved read-only at start,
REFUSAL on missing/ambiguous manifest or (live mode) missing fixture
directory. Per-leg budget envelope unchanged: `maxSemanticCalls 40 /
maxToolCalls 120 / wallClockMs 600000`.

## 5. Matrix design — configurable shape, targeted L2 first

### 5.1 Arms and default shape

```text
M3 default: 3 tasks (L1, L2, L3) x 3 strategies (NATIVE, ACTIVE_V2, ACTIVE_V3) x 3 repetitions = 27 legs

leg order (deterministic, interleaved):
  for rep 1..R { for task (configured order) { NATIVE, ACTIVE_V2, ACTIVE_V3 } }
```

| Strategy | Context path | Role |
| --- | --- | --- |
| `NATIVE` | unmodified model-facing context; observer-only extension | control (M1/M2 semantics unchanged) |
| `ACTIVE_V2` | the Active rewrite seam, removal policy `v2-retain-latest-coarse` (8 sends / 12 attempts) | treatment A — the M2 winning policy, unchanged |
| `ACTIVE_V3` | the SAME Active rewrite seam, removal policy `v3-verify-window-dedup` (8 sends / 12 attempts) | treatment B — the M3 policy (§5.2) |

The v1 `ACTIVE` arm is M1/M2 history (its pathology replicated twice) and is
not part of the M3 design; the analyzer still understands it, so M1/M2
evidence dirs keep analyzing correctly. Evidence directory naming: `NATIVE`,
`ACTIVE2` (v2), `ACTIVE3` (v3) segments — `L2-ACTIVE3-rep4` etc. Control
always precedes both treatments inside every task x repetition cell; v2
precedes v3 (established policy first, new policy second).

### 5.2 Configurable shape (validated env knobs, recorded in the manifest)

| Knob | Semantics | Default | Validation |
| --- | --- | --- | --- |
| `CANVAS_MX_TASKS` | comma list of task slots to run | `L1,L2,L3` | each token ∈ {L1,L2,L3}; no duplicates; non-empty; canonical order regardless of listing |
| `CANVAS_MX_REPS` | repetitions per cell | `3` | integer in [1, 8] |

A misconfigured knob REFUSES the run before any leg launches (clear error,
`MX_STATUS=FAILED`). Both knobs are recorded in `manifest.json` under
`design.envConfig` alongside the resolved tasks/strategies/repetitions and the
full leg order. The leg-count stop bound scales with the shape (12 for the
targeted run); the matrix totals (§7) do not.

### 5.3 Sequencing — targeted L2 A/B/C first, then confirmatory

1. **Targeted L2 run (the first M3 run):** `CANVAS_MX_TASKS=L2
   CANVAS_MX_REPS=4` — L2 x {NATIVE, ACTIVE_V2, ACTIVE_V3} x 4 reps = **12
   legs** under one fresh identity and one binding. L2 is v2's one remaining
   weak cell and the cell the v3 levers were designed from; n=4/cell
   doubles the L2 evidence per arm at a third of the default leg cost.
2. **Confirmatory run(s):** later decision under this same authorization —
   the default 27-leg shape, or n>=8 on the informative tasks (L1+L2), each
   under its OWN fresh single-use identity and binding (no continuation under
   a consumed identity).

### 5.4 Removal policy v3 semantics (what ACTIVE_V3 changes, and why)

M2 measured, on the same tasks with the same binding
([analysis](../verification/cr004-m2-matrix-analysis-2026-08-27.md)): L2 stays
+81% above native — verification-heavy reads of edited files are the remaining
mass, and they happen AFTER editing stops, when NO further edit boundary
exists to trigger a v2 sweep. Policy v3 (`v3-verify-window-dedup`) = v2 + two
data-named levers; the composer/guard seam is UNCHANGED — v3 only changes
WHICH read pairs the lifecycle signals mark superseded, and WHEN:

- **Duplicate-read dedup (a NEW intervention trigger, not tied to edits).**
  When the SAME path has been read multiple times with IDENTICAL tool-result
  content — `readContentHash`, first 16 hex of sha256 over the toolResult
  text, computed in the extension where the raw messages are visible — and NO
  edit of that path occurred between the reads, the older duplicate read pair
  is immediately superseded: the information is fully preserved in the newer
  copy. The arrival of such a duplicate read opens an intervention boundary
  even with no edit in flight (verification re-reads become removable the
  moment they duplicate). Dedup sweeps are coarse (all paths' supersedeable
  older duplicates, oldest-first) under the same `maxBlocksPerIntervention =
  12` cap; both trigger kinds feed the SAME bounded send/attempt budget, and
  the same never-retry rules apply (a trigger read toolCallId is attempted at
  most once; pairs are never removed twice).
- **Verification-window deferral.** While a verification sequence is in
  flight — operational definition: EVERY one of the last K = 2 tool calls in
  scan order is bash-class (tool name `bash`) — edit-triggered sweeps are
  DEFERRED: nothing is removed mid-verification (the model's working set
  stays stable while it is actively checking). The pending edit trigger stays
  eligible and the sweep resumes at the next non-verification boundary.
  Deferred boundary evaluations are recorded (`deferredByVerifyWindow` on the
  event, per-leg `deferredSweeps` count, reason `verification-window`).
  Dedup removals are STILL allowed during a verification window (pure win:
  information preserved).
- **Edit-triggered sweeps under v3 keep v2's retain-latest + coarse
  semantics EXACTLY** (every edited path, retain the latest read per path,
  unedited paths untouched, oldest-first cap). When both a dedup boundary and
  a non-deferred edit boundary are ready at the same event, the dedup
  boundary fires first (it is also what fires during verify windows).
- Per-leg bounds for the v3 arm equal the v2 arm's raised bounds: **8 sends /
  12 attempts**, cap 12 blocks per intervention, verify window 2 tool events.
  The extension default policy remains `v1-per-edit`; the Stage 1 frozen 1/1
  runner and C0 semantics are untouched.

Deterministic offline coverage: the dedup trigger (identical vs different
content, the edit-between guard, in-flight reads), the verify-window deferral
and resumption, dedup-inside-window, the v2-behavior inheritance, and the
cap/send bounds are tested through the REAL planner in
`packages/pi-context-integration/tests/cr004-policy-v3.test.ts`; provider
calls 0.

All other multi-intervention semantics carry over unchanged to both treatment
arms: boundaries are never re-attempted, read pairs are never removed twice,
failed attempts consume attempts but not sends, removals CARRY for the rest of
the leg, guard-trip and kill-switch semantics are identical (a guard
`FALLBACK_NATIVE` trips the per-Run kill switch permanently — the leg
continues natively as S-5 evidence; neither ends the matrix).

## 6. Stop policy — leg-level continue, matrix-level terminal (unchanged from M2)

| ID | Condition | Scope |
| --- | --- | --- |
| S-1 | strict provider binding failure at preparation | MATRIX-TERMINAL |
| S-7 | matrix totals breach (600 provider-call records / 180 minutes; checked between legs — over budget => stop launching new legs, evidence preserved); also the shape's leg-count bound | MATRIX-TERMINAL |
| S-8 | operator kill-switch file: a trip between legs (or inside an Active leg) is MATRIX-TERMINAL — no later Active leg may run rewrite-free under a treatment label (the M1 aborted-run contamination fix, kept verbatim) | MATRIX-TERMINAL |
| S-1..S-9 (any) | provider/safety/validation error, replay mismatch, protected removal, or per-leg manifest-budget breach inside ONE leg | LEG-FAILED only — the leg is marked FAILED with its stop condition and the matrix CONTINUES |

Only matrix-level S-1 (binding), S-7 (totals) and S-8 (operator kill switch)
stop everything. A failed leg still evidence-closes before the matrix moves
on. S-5 guard fallbacks are recorded evidence, not leg failures. No
degradation path: no retry, no provider switch, no mid-run budget change, no
continuation under the same identity after a matrix-terminal stop.

## 7. Budgets

| Budget | Limit | Scope |
| --- | --- | --- |
| Legs | the configured shape's total (targeted L2 run: 12; default: 27), fixed order | matrix |
| Provider-call records | 600 total across the matrix (C0 counting semantics) | matrix, hard-fail S-7 |
| Wall clock | 180 minutes from strict preparation to evidence-close, watchdog checked between legs | matrix, hard-fail S-7 |
| Per-leg semantic calls | manifest `maxSemanticCalls` (expected 40) | leg |
| Per-leg tool calls | manifest `maxToolCalls` (expected 120) | leg |
| Per-leg wall clock | manifest `wallClockMs` (expected 600000), post-hoc | leg |
| Interventions per ACTIVE_V2 leg | 8 sends / 12 attempts (v2 arm — M2 values) | leg (bounded observe-only after) |
| Interventions per ACTIVE_V3 leg | 8 sends / 12 attempts (v3 arm — same raised bounds) | leg (bounded observe-only after) |
| Blocks per intervention | 12 (oldest-first; leftovers wait for the next boundary of their kind) | intervention |
| Verify window | 2 trailing tool events, bash-class only | policy v3 |
| Token / cost | `WAIVED by Lead direction` | — |

Matrix totals are deliberately larger than the worst case; if live legs run
hot, the matrix stops at the total with all completed-leg evidence preserved —
intended fail-closed behavior, not a defect.

## 8. Evidence plan — incremental, never buffered (layout identical to M1/M2)

Layout under `research/context-benchmarks/reports/cr004-matrix/<runId>/` (same
root as M1/M2; the run identity separates them), manifest field
`matrixDesign: "M3-verify-window-dedup"`:

```text
manifest.json                                binding, budgets, ledgers, stop
                                             conditions, legs index, the M3
                                             design (arms, env config
                                             CANVAS_MX_TASKS/REPS, v2 + v3
                                             policies + bounds, leg order) —
                                             rewritten after EVERY leg
legs/<task>-<strategy>-rep<N>/leg.json       per-leg full record: oracles,
                                             counts, wallClockMs, trajectory,
                                             intervention telemetry (events,
                                             attempts, sends, fallback reasons,
                                             removedSourceKeys, removedReadTarget
                                             Hashes, policy, trigger ('edit' |
                                             'dedup'), candidateBlocks,
                                             removedBlocks, retainedLatestRead
                                             Targets, deferredByVerifyWindow),
                                             fixture summary (ACTIVE_V2 dirs
                                             are ...-ACTIVE2-rep<N>; ACTIVE_V3
                                             dirs are ...-ACTIVE3-rep<N>)
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
intervention telemetry including the v3 policy fields (`trigger`,
`deferredByVerifyWindow`) and the M1/M2 re-read detection.

Analysis (offline, `--analyze`; M1/M2 evidence dirs keep analyzing correctly —
the historical v1 ACTIVE arm remains understood):

- Per-task cells for the arms PRESENT: n (as configured — 4 per cell on the
  targeted run), oracle pass rate, mean/median records/tools/wall,
  tokenEstimateSum mean, mean trajectory peak AND final, trajectory sum.
- Exact permutation tests over tokenEstimateSum for ALL pairs of present arms
  per task — the targeted run yields NATIVE vs ACTIVE_V2, NATIVE vs
  ACTIVE_V3, and ACTIVE_V2 vs ACTIVE_V3 (the policy A/B) — each with the
  explicit low-power caveat.
- Mechanism metrics PER ACTIVE ARM: interventions sent, `removedBlocks` total
  (with `candidateBlocks`, so cap pressure is visible),
  `retainedLatestReadTargets` total, **drop-at-boundary rate**, re-reads of
  removed targets, and the v3-specific `dedupRemovals` and `deferredSweeps`
  totals (the dedup and verify-window mechanisms made visible per arm).
- Aggregate verdict lines reporting raw per-arm reliability and the
  context-efficiency direction as numbers only.

Non-claims, binding on every reader:

- n as configured per cell (4 on the targeted L2 run; 3 on the default shape)
  supports DESCRIPTIVE statistics and exact permutation p-values only —
  explicitly low power; **no causal claim** is made or implied by this
  contract or any analysis it produces.
- The policy A/B comparison is one run of one policy pair on one model at
  flash scale; direction-of-numbers reporting is not an effect estimate.
- Between-run native variance is large (M1's L2 native was ~2x M2's); the
  targeted run's native arm measures THIS run's native, not a pooled baseline.
- No quality, provider-cost or model-efficiency claim. Token figures are
  internal estimates over agent messages pre-provider, not provider usage.

## 10. Out of scope / unchanged

- No product-path change: no Electron, Renderer, Persistence, Worker or public
  contract modification; the Stage 0 composer/guard seam is consumed as-is
  (v3 changes only the lifecycle supersede decisions and their triggers).
- No planner changes, no modification of the frozen C1–C6 or L-task manifests,
  prompts, fixtures or oracles.
- The Stage 1 single-pair runner keeps `maxInterventions: 1, maxAttempts: 1`
  with the v1 default policy; C0 semantics untouched; the extension default
  policy stays `v1-per-edit`.
- No compaction arm (still the designed-not-built lever), no cross-model
  replication, no pooled multi-run meta-analysis (a later decision; each run
  reports its own numbers only).
