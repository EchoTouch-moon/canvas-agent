# CR-004 Matrix Run Contract — Multi-Intervention Active Pair Matrix (3 L-Tasks)

## 1. Header block

| Field | Value |
| --- | --- |
| Status | `AUTHORIZED (Lead direction 2026-08-27 overnight) — no further per-run approval required` |
| Date | 2026-08-27 |
| Artifact | Mandatory reviewed run contract before the CR-004 Stage 1 MATRIX run (multi-intervention Active pair matrix) |
| Authorization | Lead direction given overnight 2026-08-27, paraphrased quote-free: all gates of this contract are pre-approved as a blanket authorization, and token consumption for the matrix is unconstrained by any cost ceiling |
| Cost ceiling | `WAIVED by Lead direction` (token consumption unconstrained; the mechanical budgets in §7 remain in force as stop conditions, not as cost control) |
| Provider calls during drafting | `0` |
| Sibling contracts | [Stage 1 single-pair contract](./cr004-stage1-run-contract-2026-08-27.md) (executed: first Active rewrite canary) · [CSPV-C0 run contract](./cspv-c0-run-contract-2026-08-27.md) (binding discipline) |
| Primary upstream evidence | [Stage 1 run 1](../verification/context-runtime-cr004-stage1-run-1-2026-08-27.md) — the first Active rewrite was composed, guarded, sent and completed end-to-end on a live provider |
| Task fixtures | Three large L-task manifests under `research/context-benchmarks/manifests/` (schema-identical to the frozen C1 manifest shape; resolved by the runner at start) |

The Lead authorization this contract records: blanket overnight approval of every
gate in this contract (binding profile, budgets, stop policy, evidence plan) with
no per-run re-authorization required, and explicit unconstrained token
consumption. The contract still fails closed mechanically: authorization removes
the approval step, never a stop condition.

## 2. Run identity

```text
format      cr004-m1-<ISO-date-undashed>-<8-hex>
example     cr004-m1-20260827-4d7e9a1b
freshness   generated once by the matrix runner (suggest + refuse pattern)
uniqueness  MUST NOT collide with any prior run identity in any evidence store
scope       one identity covers ALL 18 legs (§5) of the single matrix run
```

Binding rules inherit the C0/Stage 1 discipline: single-use identity; a terminal
run is never retried or resumed under the same identity; one binding per run, no
rebinding after execution starts; never collides with the consumed C0
(`c0-20260827-8cdb65c4` / `c0-20260827-9faf18ac` / `c0-20260827-46eca174`),
Stage 1 (`cr004-s1-20260826-38bd266f`, `cr004-s1-20260826-1f75a6fa`),
replacement-canary or Wave A identities.

## 3. Provider and model profile

Same strict binding as the sibling contracts:

| Field | Value |
| --- | --- |
| Provider | `step-plan` / `step-3.7-flash` |
| Credential | `STEP_PLAN_API_KEY`, resolved in memory only, never recorded |
| executionMode | `experiment-strict`, `fallbackUsed = false`, fallback provider `none` |

ONE strict binding (`prepareModelProvider` once) for the WHOLE matrix — all 18
legs share the single binding and `providerConfigHash`. A
`PROVIDER_BINDING_FAILURE` at strict preparation is the matrix-terminal stop
S-1. A provider failure DURING a leg is a leg-level failure (§8): that leg is
marked FAILED and the matrix continues; no provider switch ever occurs.

Recorded divergence (unchanged from Stage 1): the L-manifests pin a
DeepSeek-class model profile; this run binds `step-plan/step-3.7-flash`. No
cross-baseline comparison is claimed.

## 4. Task manifests — three L-tasks

Three large task fixtures L1/L2/L3 are created as manifests under
`research/context-benchmarks/manifests/` (one file per task, named
`L<n>-*.json`), schema-identical to the frozen C1 manifest shape: verbatim
prompt, allowedTools, expectedTools, expectedWritablePaths, oracle +
regressionOracle, and a per-task budget. The runner resolves the manifests at
start and REFUSES with a clear error if a manifest (or, in live mode, its
fixture directory) is missing or ambiguous. The frozen C1–C6 manifests are not
modified; the L-manifests are new files consumed read-only.

Expected per-leg budget envelope (from the manifests, enforced per leg in §7):
`maxSemanticCalls 40 / maxToolCalls 120 / wallClockMs 600000`.

## 5. Matrix design — 18 legs, one identity, one binding

```text
3 tasks (L1, L2, L3) x 2 strategies (NATIVE, ACTIVE) x 3 repetitions = 18 legs

leg order (deterministic, interleaved):
  for rep 1..3 { for task L1,L2,L3 { NATIVE then ACTIVE } }

rep1: L1-NATIVE, L1-ACTIVE, L2-NATIVE, L2-ACTIVE, L3-NATIVE, L3-ACTIVE
rep2: ... (same)
rep3: ... (same)
```

| Strategy | Context path | Role |
| --- | --- | --- |
| `NATIVE` | unmodified model-facing context; observer-only extension | control |
| `ACTIVE` | bounded repeated Active rewrite through the Stage 0 seam | treatment |

Every leg: fresh temp fixture copy, session with the manifest allowedTools
verbatim, the single manifest prompt issued once, per-leg oracle + regression +
writable-conformance checks, fixture summary (sha256 + lineCount). NATIVE
precedes ACTIVE inside every task x repetition cell (control data first), and
repetitions interleave tasks so drift is spread across the whole run.

### Multi-intervention policy (ACTIVE legs)

The Stage 1 once-only latch is replaced by BOUNDED repeated intervention:

- Each time a NEW superseded-evidence boundary qualifies — an edit/write-class
  toolCall for path P with earlier STILL-ACTIVE read pairs for P — the
  extension composes, guards and sends, up to **5 sent rewrites
  (`maxInterventions`) and 8 composition attempts (`maxAttempts`) per leg**.
- A boundary is NEW when its edit toolCallId was never attempted; a read pair
  superseded by any earlier intervention is never removed twice; a failed
  attempt consumes an attempt but not a send, and the same boundary is never
  retried.
- Removals CARRY: once an intervention removes a read pair from the
  model-visible context, it stays out for the rest of the leg; later
  compositions are built over that reduced basis (this is what makes a second
  intervention composable at all — composing over the raw native list would
  fail closed with `UNEXPLAINED_MEMBERSHIP`).
- Every attempt/send/fallback is recorded per event in the leg telemetry,
  including per read-class tool call a privacy-safe `readTargetHash` (first 16
  hex of sha256 over the path argument) and, per intervention, the
  `readTargetHashes` of the removed pairs — so post-run analysis can detect
  re-reads of removed targets (a readTargetHash after an intervention matching
  a removed pair's hash = re-read).
- Kill switch and guard-trip semantics are unchanged from Stage 1: a guard
  `FALLBACK_NATIVE` trips the per-Run kill switch permanently (every remaining
  send of the leg proceeds natively, S-5 evidence); the operator kill-switch
  file does the same (S-8 evidence). Neither ends the matrix.

The Stage 1 single-pair runner pins `maxInterventions: 1, maxAttempts: 1`; its
frozen once-only contract semantics are unchanged.

## 6. Stop policy — leg-level continue, matrix-level terminal

| ID | Condition | Scope |
| --- | --- | --- |
| S-1 | strict provider binding failure at preparation | MATRIX-TERMINAL |
| S-7 | matrix totals breach (400 provider-call records / 180 minutes; checked between legs — over budget => stop launching new legs, evidence preserved) | MATRIX-TERMINAL |
| S-1..S-9 (any) | provider/safety/validation error, replay mismatch, protected removal, or per-leg manifest-budget breach inside ONE leg | LEG-FAILED only — the leg is marked FAILED with its stop condition and the matrix CONTINUES to the next leg |

Only matrix-level S-1 (binding) and S-7 (totals) stop everything. A leg that
fails still evidence-closes: its observations collected so far are flushed and
its leg record is written before the matrix moves on. Per-leg wall budgets are
enforced post-hoc at leg end (the Pi session prompt has no mid-flight abort);
the wall-clock overrun is recorded on the leg. S-5 guard fallbacks and S-8
kill-switch trips are recorded evidence on the leg, not leg failures (the leg
continues natively). No degradation path: no retry, no provider switch, no
mid-run budget change, no continuation under the same identity after a
matrix-terminal stop.

## 7. Budgets

| Budget | Limit | Scope |
| --- | --- | --- |
| Legs | 18 (3 x 2 x 3), fixed order | matrix |
| Provider-call records | 400 total across the matrix (C0 counting semantics) | matrix, hard-fail S-7 |
| Wall clock | 180 minutes from strict preparation to evidence-close, watchdog checked between legs | matrix, hard-fail S-7 |
| Per-leg semantic calls | manifest `maxSemanticCalls` (expected 40) | leg |
| Per-leg tool calls | manifest `maxToolCalls` (expected 120) | leg |
| Per-leg wall clock | manifest `wallClockMs` (expected 600000), post-hoc | leg |
| Interventions per ACTIVE leg | 5 sends / 8 attempts | leg (bounded observe-only after) |
| Token / cost | `WAIVED by Lead direction` | — |

Matrix totals are deliberately larger than the worst case (18 x 40 = 720
potential records vs 400 allowed): if live legs run hot, the matrix stops at
the total with all completed-leg evidence preserved — that is the intended
fail-closed behavior, not a defect.

## 8. Evidence plan — incremental, never buffered

Layout under `research/context-benchmarks/reports/cr004-matrix/<runId>/`:

```text
manifest.json                                binding, budgets, ledgers, stop
                                             conditions, legs index (rewritten
                                             after EVERY leg)
legs/<task>-<strategy>-rep<N>/leg.json       per-leg full record: oracles,
                                             counts, wallClockMs, trajectory,
                                             intervention telemetry (events,
                                             attempts, sends, fallback reasons,
                                             removedSourceKeys, removedReadTarget
                                             Hashes), fixture summary
legs/<task>-<strategy>-rep<N>/observations.jsonl   per-model-call observations
matrix.json                                  aggregate so far (rewritten after
                                             EVERY leg)
analysis.json                                offline analyzer output
```

INCREMENTAL EVIDENCE is mandatory: after EACH leg the runner writes that leg's
directory immediately and rewrites manifest.json + matrix.json. An overnight
crash at any point leaves complete evidence for every leg that already ended.
Evidence is metadata-only (hashes, counts, source keys; never prompts,
transcripts, provider payloads or credentials); raw reports stay local and
untracked.

## 9. Measured metrics + non-claims

Per leg: completion (oracle, regression oracle, writable-path conformance),
tool-call count, provider-call record count, wallClockMs, replay mismatches,
observed token estimates (internal estimates, NOT provider token/cost
measurements), the context trajectory (per-model-call
`observedMessageTokenEstimate`: peak, final, sum/area), the full intervention
telemetry (attempts, sends, fallback reasons, toolBlocksRemoved,
readTargetHashes removed, re-reads of removed targets, post-first-intervention
read count), fixture summary.

Analysis (offline, `--analyze`): per-cell (task x strategy) n, oracle pass
rate, mean/median records/tools/wall, tokenEstimateSum mean, mean trajectory
peak and sum; per-task exact permutation tests over tokenEstimateSum (all
C(6,3)=20 label assignments, two-sided, hand-checkable: perfectly separated 3v3
groups give p = 2/20); aggregate verdict lines reporting raw reliability
identical/differentiated and the context-efficiency direction as numbers.

Non-claims, binding on every reader:

- n = 3 per cell supports DESCRIPTIVE statistics and exact permutation
  p-values only — explicitly low power; **no causal claim** is made or implied
  by this contract or any analysis it produces.
- No quality, provider-cost or model-efficiency claim. Direction-of-numbers
  reporting is not an effect estimate.
- Token figures are internal estimates over agent messages pre-provider, not
  provider usage.

## 10. Out of scope / unchanged

- No product-path change: no Electron, Renderer, Persistence, Worker or public
  contract modification; the Stage 0 seam is consumed as-is.
- No policy edits, no planner changes, no modification of the frozen C1–C6
  manifests, prompts, fixtures or oracles.
- No harness beyond Pi; no Shadow legs (C0's completed line).
- No Wave B / CR-005 matrix resumption — this is the CR-004 Active line only.
