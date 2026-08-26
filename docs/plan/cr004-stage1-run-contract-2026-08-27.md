# CR-004 Stage 1 Run Contract — First Active Rewrite Canary (Single C1 Pair)

## 1. Header block

| Field | Value |
| --- | --- |
| Status | `DRAFT — PENDING STAGE 0 VERIFICATION + LEAD AUTHORIZATION` |
| Date | 2026-08-27 |
| Artifact | Mandatory reviewed run contract before the FIRST Active rewrite canary (CR-004 Stage 1) |
| Grants | `NOTHING`. This draft authorizes no provider execution, no rewritten provider request, no code change, no run |
| Provider calls during drafting | `0` |
| Upstream Gate D | [CR-004 Gate D adjudication 2026-08-27](../verification/context-runtime-cr004-gate-d-adjudication-2026-08-27.md) — `PASS`, CR-004 `STAGE_0_PREPARATION_ALLOWED` (`gate-d:3`, `gate-d:10`) |
| Sibling contract | [CSPV-C0 run contract](./cspv-c0-run-contract-2026-08-27.md) — structural and discipline precedent, strict binding basis |
| Primary upstream evidence | [CSPV-C0 canary live runs 1–3](../verification/cspv-c0-canary-runs-2026-08-27.md) — 51 provider-call records, three single-use identities, strict Step Plan binding (`c0-runs:6-8`) |
| Readiness criteria | [v0.3 research rebaseline](../research/context-runtime-v0.3-research-rebaseline-2026-08-13.md) §5 Gate D (`rebaseline:199-217`) |
| Task corpus | [CR-005 corpus](../../research/context-benchmarks/README.md) + [C1 manifest](../../research/context-benchmarks/manifests/C1-localized-bug-fix.json) |

The authorization boundary this draft must satisfy, verbatim from the Gate D
adjudication (`gate-d:60-63`):

> No Active provider rewrite. CR-004 Stage 1 (the first Active canary)
> requires a separate Lead authorization with its own run contract, fresh run
> identity, budgets and fail-closed stop policy — including the carried-forward
> materialization stop condition.

Authorization preconditions, all of which must hold before this draft can
authorize anything:

1. Stage 0 (the offline safety seam) has its own bounded implementation and
   verification review completed and green — "before anything else"
   (`gate-d:55-56`).
2. A Lead explicitly authorizes this contract, including its budgets (§9) and
   cost ceiling.
3. Until both hold, the standing boundary is unchanged: "Implement or send
   CR-004 Active rewritten context — `NO_GO`" (`rebaseline:230`).

Citation keys used below:

- `gate-d` — CR-004 Gate D adjudication 2026-08-27
- `c0-contract` — CSPV-C0 run contract 2026-08-27
- `c0-runs` — CSPV-C0 canary live run records 2026-08-27
- `rebaseline` — v0.3 research rebaseline 2026-08-13
- `c1-manifest` — research/context-benchmarks/manifests/C1-localized-bug-fix.json
- `corpus-readme` — research/context-benchmarks/README.md
- `rc-gate` — CR-005 replacement canary execution gate
- `rc-run2` — CR-005 replacement canary run 2
- `provider-layer` — docs/architecture/model-provider-layer.md
- Fixture and source citations are absolute file paths with line numbers.

## 2. Run identity

```text
format      cr004-s1-<ISO-date>-<8-hex>
example     cr004-s1-2026-08-27-4d7e9a1b
freshness   generated once, at strict preparation, by the Stage 1 runner
uniqueness  MUST NOT collide with any prior run identity in any evidence store
scope       one identity covers BOTH legs (§5) of the single pair
```

Binding rules, inheriting the C0 discipline (`c0-contract:48-72`):

- Single-use. A terminal run (any §10 stop condition) is never retried or
  resumed under the same identity.
- Never collides with: the three consumed C0 identities
  `c0-20260827-8cdb65c4` / `c0-20260827-9faf18ac` / `c0-20260827-46eca174`
  (`c0-runs:13-17`), any Wave A identity, the replacement-canary run
  identifiers (`rc-run2:91`), or any deterministic-suite session prefix.
- Wave A identities remain `TERMINAL / PRESERVED / NEVER RESUME`
  (`rebaseline:226`); C0 identities remain consumed and single-use.
- One binding per run, no rebinding after execution starts
  (`c0-contract:66-68`).
- The binding's `providerConfigHash` — derived from provider endpoint, model
  and compatibility configuration, without credentials (`provider-layer:66-70`)
  — is recorded in the run manifest (§11) and distinguishes this run from any
  other run sharing the same provider/model labels.

## 3. Provider and model profile

Same strict discipline as C0 (`c0-contract:76-111`):

| Field | Value | Source |
| --- | --- | --- |
| Provider | `step-plan` | `provider-layer:13-16` |
| Endpoint | `https://api.stepfun.com/step_plan/v1` | `provider-layer:13-16` |
| Model | `step-3.7-flash` | `provider-layer:13-16` |
| Credential | `STEP_PLAN_API_KEY`, resolved in memory only, never recorded | `provider-layer:13-16`, `provider-layer:8-10` |
| executionMode | `experiment-strict` | `provider-layer:51` |

Strict invariants, enforced at preparation and immutable after
(`provider-layer:50-58`; `c0-contract:87-93`):

```text
executionMode        = experiment-strict
runIdentity          = <§2 identity, supplied by the Stage 1 runner>
requestedProvider    = step-plan === actualProvider
requestedModel       = step-3.7-flash === actualModel
fallbackUsed         = false
```

Failure semantics:

- `PROVIDER_BINDING_FAILURE` at strict preparation is terminal (S-1); the run
  never continues with DeepSeek (`provider-layer:60-62`).
- No fallback path exists in the Stage 1 runner; provider failure after the
  first model call aborts the run rather than switching providers
  (`provider-layer:38-39`).
- Step Plan endpoint and account entitlement must be verified before the live
  run (`provider-layer:18-22`).
- The binding applies identically to BOTH legs: the Native control leg and the
  Active treatment leg run under one provider binding and one
  `providerConfigHash`. Any provider-profile difference between legs is a
  contract violation.

**Recorded divergence.** The C1 manifest pins `modelProfile:
deepseek/deepseek-v4-flash` (`c1-manifest:46-50`); this run binds
`step-plan/step-3.7-flash`. The manifest's frozen model profile is NOT the run
binding. Consequently this run's legs are not comparable to the historical
DeepSeek C1 records, and no such comparison is claimed (`rebaseline:66`:
C1 evidence is "different baseline; not pooled as the same controlled run").
The divergence is recorded in `pairs.json` (§11).

## 4. Task manifest — one C1-class task

### 4.1 C1 class definition

The CR-005 corpus is six deliberately small Git-backed fixtures; class C1 is
the localized bug fix — "1. localized bug fix" as the first corpus class
(`corpus-readme:9-16`). The canonical C1 definition is the frozen manifest
`research/context-benchmarks/manifests/C1-localized-bug-fix.json`:

```text
taskId            cr005-c1-localized-bug-fix            (c1-manifest:2)
category          C1-localized-bug-fix                  (c1-manifest:3)
title             Fix the localized percentage discount bug (c1-manifest:4)
fixture           c1-v1, corpus/C1-localized-bug-fix/fixture (c1-manifest:5-6)
revision pin      baseCommit ff32395…f10b, treeHash 4315df…ad9b,
                  initialStateHash 60ada7…ab4f          (c1-manifest:8-13)
prompt            verbatim, fixed by manifest           (c1-manifest:14)
acceptance        C1-1, C1-2, C1-3 — all OBJECTIVE_ORACLE (c1-manifest:15-31)
oracles           node --test test/discount.test.js (exit 0)
                  node --test test/regression.test.js (exit 0) (c1-manifest:32-43)
tools             allowed: read, ls, grep, find, bash, edit, write
                  expected: read, edit, bash             (c1-manifest:44-45)
writable scope    src/discount.js ONLY                   (c1-manifest:57)
```

### 4.2 Why C1 is the lowest-risk class (tracked-artifact derivation)

- Smallest frozen budget in the corpus: `maxSemanticCalls: 12`,
  `maxToolCalls: 40`, `wallClockMs: 120000` (`c1-manifest:52-56`) — every
  other class is equal or larger on all three axes (C6 reaches 20/90/180000).
- Narrowest writable scope: exactly one file (`c1-manifest:57`).
- Established bounded-pair precedent: the corpus's own fail-closed entry point
  "selects exactly `C1-localized-bug-fix`, uses one repetition, and therefore
  can produce only one Native plus one Shadow record" (`corpus-readme:63-67`),
  and Wave A excluded C1 precisely because "its first repetition already
  passed the replacement canary" (`corpus-readme:79-81`). The prior C1 pair
  shape is `C1-localized-bug-fix × repetition 1 × {NATIVE, SHADOW} = exactly 2
  records` (`rc-gate:15-17`).

Stage 1 reuses the task definition only. It does not reopen, modify or extend
the frozen CR-005 manifests (frozen per `rebaseline:229`; unmodified by the
provider layer per `provider-layer:104-105`).

### 4.3 Divergence ledger (all recorded in `pairs.json`, §11)

| # | Divergence from frozen C1 manifest | Handling |
| --- | --- | --- |
| 1 | Model profile: manifest pins DeepSeek; run binds Step Plan (`c1-manifest:46-50` vs §3) | recorded; no cross-baseline comparison claimed |
| 2 | Strategy: manifest `contextStrategies` are `NATIVE/SHADOW` (`c1-manifest:51`); leg B is `ACTIVE` | manifest NOT modified; `ACTIVE` is a Stage 1 strategy outside the manifest, recorded in `pairs.json` |
| 3 | Harness: Pi-only Active capability profile (`gate-d:43`) | every other harness stays out of scope |

## 5. Pair design — one task, two legs, one identity

Exactly ONE C1-class task (§4), executed exactly TWICE under the single §2 run
identity:

| Leg | Strategy | Context path | Role |
| --- | --- | --- | --- |
| A | `NATIVE` | unmodified model-facing context, never rewritten | control |
| B | `ACTIVE` | rewritten context composed through the Stage 0 seam | treatment |

Both legs: same task prompt (verbatim, `c1-manifest:14`), same fixture repo
materialized from the pinned revision (`c1-manifest:8-13`), same allowed tools
(`c1-manifest:44-45`), same oracles and writable-path checks (§4.1), same
provider binding and `providerConfigHash` (§3).

**Order — fixed: leg A (Native) first.** Control data is secured before any
rewrite risk is taken. The Active leg may not begin until the Native leg has
evidence-closed within budget (§9 leg gate).

**Active-leg mechanics — through the Stage 0 seam only.** The rewrite is
composed exclusively through the seam at
`packages/pi-context-integration/src/active/` (as of this draft it contains
`pi-committed-context-adapter.ts` and `request-parity.ts`; module inventory
may grow — this contract binds the seam by its fixed location and by the Gate
D capability list, not by module internals). The seam must provide, per the
Gate D Stage 0 scope (`gate-d:40-53`):

- Pi-only Active capability profile (`gate-d:43`);
- explicit per-Run experimental opt-in for Active mode (`gate-d:44-46`) — a
  dedicated flag fixed at runner review, distinct from and not combinable with
  any CR-005 live flag (`corpus-readme:105` precedent), recorded in the
  manifest;
- mandatory/pinned items re-asserted before any rewrite is composed
  (`gate-d:46`);
- the composed rewrite binds its Working Set and Transition hashes
  (`gate-d:47`);
- continuity checks for tool-call/result pairs, the system instruction, and
  reasoning/opaque items (`gate-d:48-49`);
- a pre-send guard such that any unsupported or inconsistent item triggers a
  pre-send fallback to the Native context — fail closed, never a partial
  rewrite (`gate-d:50-51`).

**Guard semantics.** The pre-send guard runs before EVERY Active send (§6
kill-switch check included). Verdicts are recorded per send:

```text
PASS             rewrite sent; working-set/transition record extended
FALLBACK_NATIVE  Active leg aborted at that send; the send (and all remaining
                 sends of leg B) proceed under Native context
```

A `FALLBACK_NATIVE` verdict aborts the Active leg and records it (S-5, §10).
A fallback IS evidence — it is the seam's fail-closed behavior observed live,
not a failure of the run. After S-5 the run continues only as
Native-completed and evidence-closes; no Active retry occurs under this
identity.

## 6. Kill switch

- Operator-controlled, per-run (bound to the §2 identity), checked before
  EVERY Active send as part of the pre-send sequence.
- Once tripped: every remaining Active send of this run permanently falls back
  to Native context. Non-recoverable within the run identity — no un-trip, no
  re-enable, no second Active attempt under this identity.
- The trip is recorded: timestamp, send index at which it took effect, and the
  leg's resulting state (S-8, §10).
- Kill-switch behavior must already be verified by tests in Stage 0
  (`gate-d:52`); Stage 1 exercises it only as the live operator control, and
  protocol continuity / kill-switch / capability boundaries remain items Gate D
  explicitly reserved for separate review (`rebaseline:215-217`).
- The Native leg is unaffected by the switch; it never depends on the seam.

## 7. What is measured — and what one pair cannot claim

Descriptive pairing only. Per leg:

| Measurement | Content |
| --- | --- |
| Completion | objective oracle, regression oracle, acceptance C1-1..C1-3, writable-path conformance — the machine checks the corpus validator already defines (`corpus-readme:24-30`) |
| Tool calls | per-leg tool-call counts |
| Provider-call records | per-leg record count at the outbound transport seam (§9 counting) |
| Token estimates | internal estimates only; explicitly not provider token/cost measurements (`c0-contract:368`) |
| Active-leg record | the working-set/transition record of leg B (`LifecycleTransitionRecord` shape, `c0-contract:406`) |
| Guard verdicts | per-send `PASS` / `FALLBACK_NATIVE` with reasons (§5) |

Historical descriptive anchor, not pooled and not comparable (different
provider, §4.3): the prior C1 Native/Shadow pair recorded Native 7 semantic /
12 tool calls / 13.7 s and Shadow 9 / 13 / 18.2 s, both fully PASS
(`rc-run2:55-58`).

Explicit non-claims, binding on every reader of the evidence:

- ONE pair supports NO statistical or causal claim — the single-canary
  boundary already fixed for C0 (`c0-contract:442-446`).
- Quality comparison is NOT established by this contract. Gate D's boundary
  stands: no quality, provider-cost or model-efficiency claim; the value
  hypothesis remains `NOT_ESTABLISHED` (`gate-d:64-65`).
- This is a safety-and-mechanics first-contact experiment: it asks whether the
  Stage 0 seam can compose, guard, bind and record a live rewritten send on
  the lowest-risk corpus class without protection, continuity, replay or
  materialization violations — nothing more.

## 8. Materialization carry-forward (mandatory)

Gate D criterion 7 — "no unexplained materialization failure"
(`rebaseline:211`) — was `NOT_OBSERVED-IN-SHADOW` and carried forward:
"Becomes a mandatory Stage 1 fail-closed stop condition" (`gate-d:29`); the
Gate D boundary demands a stop policy including "the carried-forward
materialization stop condition" (`gate-d:60-63`). This section is that
condition.

- In the Active leg, EVERY materialization outcome must be either
  `MATERIALIZED` or carry a bounded machine-readable explanation.
- Any unexplained materialization failure is a terminal stop (S-6, §10):
  run halts immediately, evidence preserved, identity never reused.
- No degradation path: no retry, no re-composition under the same identity, no
  downgrade of the criterion. The Shadow-mode structural blind spot
  (`c0-runs:48-50`) makes this the single Gate D criterion Stage 1 evidences
  for the first time.

## 9. Budgets

Four separate budgets, all hard-fail. Exceeding ANY budget is a terminal stop
(S-7): the run halts, evidence is preserved, and no retry occurs under the
same run identity (`c0-contract:364-375` discipline).

| Budget | Limit | Notes |
| --- | --- | --- |
| Legs | max `2` completed legs — exactly leg A (Native) and leg B (Active) of the single §4 task | no repeats, no second task, no second pair |
| Provider-call records | max `30` total; per-leg gate `15` | counted at the outbound transport seam (C0 semantics, `c0-contract:367`). Sized for live burst reality: C0 run 2 observed a single E3 turn yield 14 records (`c0-runs:16`), so 15 covers the worst observed single-turn burst plus one. **Leg gate:** the Active leg may NOT begin if the Native leg already exceeded 15 records — starting a budget-doomed Active leg would spend rewrite risk on a guaranteed S-7. Note the counting change vs CR-005: a CR-005 "record" was one task execution (the prior C1 pair consumed exactly 2, `rc-run2:8`); this contract counts provider-call records per C0 |
| Token / cost | `PLACEHOLDER, REQUIRES LEAD CONFIRMATION` | internal token estimates are not provider token/cost measurements (`c0-contract:368`); ceiling applies to provider-reported usage |
| Wall clock | `30` minutes | measured from strict preparation (binding) to evidence-close (both legs + terminal recording). Floor: the manifest's per-task wall clock is 120000 ms per leg (`c1-manifest:55`); the ceiling absorbs burst-yield turns (`c0-runs:16`) and Stage 1 seam composition/guard overhead absent from C0's budget. C0 used 60 minutes for four scenarios (`c0-contract:369`); this is half that for one pair |

Separation requirement: the leg budget and the provider-call budget are
independent ledgers (`c0-contract:371-375` precedent). Failing to complete
both legs within the call budget is a budget-constrained outcome, not
permission to overspend calls.

## 10. Stop policy — fail closed at every gate

Each condition below is terminal and is recorded with evidence preserved. Two
scopes: RUN-terminal (halt everything, evidence-close immediately) and
LEG-terminal (Active mode ends; the run continues to evidence-close as
Native-completed only where explicitly stated).

| ID | Stop condition | Detection | Scope |
| --- | --- | --- | --- |
| S-1 | Provider binding failure | `PROVIDER_BINDING_FAILURE` at strict preparation (`provider-layer:60-62`); any provider failure after the first model call (`provider-layer:38-39`) | RUN |
| S-2 | Observation / validation failure | any observation or composed item fails normalization or validation before planning or composition | RUN |
| S-3 | Replay mismatch in the Active leg's transition chain | re-executed digest comparison against the recorded transition chain (C0 mechanic, `c0-contract:388`) | RUN |
| S-4 | Mandatory / pinned violation | any mandatory/pinned item absent, weakened or not re-asserted in the composed rewrite (`gate-d:46`) | RUN |
| S-5 | Guard `FALLBACK_NATIVE` after opt-in during the Active leg | pre-send guard verdict (`gate-d:50-51`); verdict + reason recorded; Active leg aborted; the run continues to evidence-close as Native-completed. A fallback is evidence, not a failure of the run | ACTIVE LEG |
| S-6 | Unexplained materialization failure | any Active-leg materialization outcome neither `MATERIALIZED` nor carrying a bounded explanation (§8; `gate-d:29`) | RUN |
| S-7 | Budget breach | any of the four §9 budgets exceeded | RUN |
| S-8 | Kill switch tripped by operator | §6; all remaining Active sends permanently Native; trip recorded; non-recoverable within the identity | ACTIVE MODE |
| S-9 | Provider error / safety-classified output | any provider transport error, refusal or safety-classified output in either leg | RUN |

No degradation path: no retry, no provider switch, no mid-run task edit, no
mid-run budget or constant change, no continuation under the same identity
(`c0-contract:395-397`). S-5 and S-8 are the only non-RUN-terminal conditions,
and both still permanently end Active mode for the identity.

## 11. Evidence plan

Captured per run — same report shape as C0 (`c0-contract:403-421`) plus one
new pairing artifact:

| Evidence | Content | Mechanism |
| --- | --- | --- |
| Observation JSONL | every normalized observation and trace event, in sequence, both legs | context-runtime sinks (`packages/context-runtime/src/sink/jsonl-sink.ts`) |
| Working-set transitions | `LifecycleTransitionRecord` fields: decision kind, source/version/representation IDs, reason codes, originating REMOVE and later-need refs, from/to working-set hashes, transition hash (`c0-contract:406`) | planner output records |
| Admission / decision records | every active-set change with reason codes | planner + runner |
| Guard verdicts | per-Active-send `PASS` / `FALLBACK_NATIVE` with reasons; kill-switch state and trip record (§6) | Stage 0 seam + runner |
| Provider binding | `providerConfigHash`, requested/actual provider/model, `fallbackUsed=false`, run identity — no credential (`provider-layer:66-70`) | `safeProviderSelection` record |
| Pairing (`pairs.json`, NEW) | the Native/Active pairing: taskId, category, fixture identity + hashes, leg A and leg B strategy/completion/counts, per-send guard verdicts, kill-switch events, §4.3 divergence ledger | Stage 1 runner |
| Run manifest | run identity, ISO timestamps, fixture identity hash, this contract's identity/hash, §9 budget ledgers, §10 stop conditions fired, per-leg verdicts | Stage 1 runner |

Storage location — reports directory pattern, following the C0 and CR-005
research-only boundary (`c0-contract:414-421`):

```text
research/context-benchmarks/reports/cr004-stage1/<runId>/
  observations.jsonl
  transitions.jsonl
  decisions.jsonl
  binding.json
  pairs.json
  manifest.json
```

Retention and safety:

- Metadata-only; no credentials, no provider payloads, no provider responses
  are ever recorded into the repository (`c0-contract:423-425`;
  `provider-layer:8-10`).
- Raw JSONL stays local and untracked, per the standing raw-evidence policy
  (`c0-runs:75-77`).
- This contract performs no adjudication: per-leg verdicts are mechanical
  (oracle/acceptance/writable-path checks, §7); any next-step decision is a
  separate Lead review.

## 12. Out of scope / unchanged

- No second pair, no repetition, no corpus matrix. Wave B remains `NO_GO`
  (`rebaseline:228`); the CR-005 matrix remains `NO_GO` (`rc-run2:130`).
- No Wave A or C0 identity reuse, resume, or extension (`rebaseline:226`;
  `c0-runs:13-17`).
- No quality, provider-cost or model-efficiency claim (§7; `gate-d:64-65`).
  Experiment-plan milestone item 5 can close only via a Stage 1 Active canary
  result or a new explicit waiver (`gate-d:66-67`) — this contract is the
  vehicle for the former, and only if authorized and executed.
- No product-path change: no Electron, Renderer, Persistence, Worker or public
  contract modification; the Stage 0 seam is consumed as-is and is frozen for
  the duration of the run — no mid-run seam edits.
- No harness beyond Pi. The Active capability profile is Pi-only
  (`gate-d:43`); OpenCode/Codex stay out of scope.
- No modification of frozen CR-005 manifests, prompts, fixtures, oracles or
  evaluators (`rebaseline:229`); Stage 1 reuses the C1 task definition read-only
  (§4.3).
- No Shadow leg. The pair is Native/Active only; Shadow observability is C0's
  completed line, not repeated here.
