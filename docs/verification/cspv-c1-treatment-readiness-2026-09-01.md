# CSPV-C1 Treatment Readiness — 2026-09-01

Status: `PASS / CREDENTIAL-FREE / NO NETWORK`

Readiness artifact: [`C1-C_TREATMENT_READINESS_V1`](../../research/context-benchmarks/c1/readiness/c1-treatment-readiness-v1.json)

This report records the zero-provider treatment-readiness probe authorized
after `C1_RUN_CONTRACT_V1` was frozen. It does not authorize C1 live
execution, CR-004, or any Provider call.

## Binding

| Field                     | Value                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| Frozen contract           | `C1_RUN_CONTRACT_V1`                                               |
| Contract SHA-256          | `1c82e095973b5cf9b47787f99a6ad41dccfd50d3f68379c68c02e8bd36d6f9f4` |
| C1-A manifest SHA-256     | `2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38` |
| Assignment matrix SHA-256 | `630d2f6a66d8ceb414533040052a96bf20566a7ddef33edc7236b6e4ecc711e7` |
| Readiness parent revision | `4321d361a47ca3ce1afde1e40aef64075ebc1f11`                         |
| Provider binding          | `step-plan / step-3.7-flash`                                       |
| Network mode              | disabled; in-memory capture and fake transport only                |
| Provider calls            | `0`                                                                |
| Usage                     | `NOT_OBSERVED_IN_READINESS / NOT_APPLICABLE`                       |
| Treatment revision        | `PENDING_C1_C_FREEZE`                                              |

The readiness implementation uses the real provider-neutral `policy-v0`
planner and the existing Active rewrite composition as a deterministic,
message-level context replacement seam. The captured request is stopped
before any network transport. No API key, environment credential, Provider
response, or usage ledger is read or written.

## Hard-gate results

All required gates are conjunctions. A partial pass is not a readiness pass.

| Gate                        | Result | Evidence                                                                                                                                                                                                                    |
| --------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native fidelity             | `PASS` | observer-only capture preserves five messages, role/order, semantic fingerprint, system/developer/tool definitions, and provider-native metadata                                                                            |
| Runtime treatment active    | `PASS` | policy transition emits two distractor `REMOVE`s; Active composition drops that pair; provider-bound semantic fingerprint differs from Native                                                                               |
| Structural preservation     | `PASS` | only the declared semantic region changes; system instruction is byte-identical, retained tool pair remains intact, opaque reasoning content is preserved                                                                   |
| Silent fallback forbidden   | `PASS` | materialization, replacement, binding, stale-revision, and invalid-transition injections all terminate with zero fallback/capture                                                                                           |
| Evidence join               | `PASS` | task/pair/arm/run/turn/model-call IDs join to Working Set, Transition, materialized fingerprint, and provider-bound request fingerprint for both arms                                                                       |
| Budget/identity/kill-switch | `PASS` | fake transport allows 24 and blocks the 25th before outbound for both arms; duplicate identities, terminal resume/overwrite, kill switch, and independent finalization attempts are checked                                 |
| T4 lifecycle chain          | `PASS` | `ADD → REMOVE(evaluate.js) → cold selected state → later need → REHYDRATE` is sent through Active composition and pre-network capture in both cold and restored states; exact SourceVersion and representation are restored |

## Treatment evidence

The Native arm is a metadata-only control: it returns the original model-facing
message list unchanged. The Runtime arm starts from the same five-message
fixture, runs `policy-v0`, materializes the resulting Working Set, and passes
the transition through the existing fail-closed Active composer. The Runtime
provider-bound message set retains the target tool pair and removes only the
registered distractor pair.

The readiness probe records these fingerprints:

```text
Native semantic context:  5074ca14eb66c4037c9e492e3ac935cea230c066f9ed66e7cfcc3aa8716af3d1
Runtime semantic context: 2e8dd5b0af38cdc0bcf5909d5947bfb0f65465dc2c705ac35b524eb7938f4a9b
```

The fixture, evaluator, provider/model binding, and hard budget are identical
across the two readiness arms. This is treatment readiness evidence, not a
comparative task outcome and not a live Provider request.

## T4 delayed-context probe

The T4 synthetic chain is derived from the actual frozen `policy-v0` planner:

```text
ADD src/parser/evaluate.js
→ REMOVE src/parser/evaluate.js  (RULED_OUT at WRONG_PATH_TRIAGE)
→ selected representation absent from the cold Working Set
→ DETAIL_REQUIRED evidence during RECOVERY
→ REHYDRATE src/parser/evaluate.js
→ exact SourceVersion + FULL representation restored
```

The originating `REMOVE` relationship is carried through `removalHistory`.
A first-time `ADD` is never treated as `REHYDRATE`. For both materialized
states, the probe invokes the existing Active composer and captures the
provider-bound request at the in-memory pre-network seam. The cold capture
must exclude both provider identities for `evaluate.js`; the restored capture
must include both identities and retain the exact SourceVersion,
representation, and a changed model-visible semantic fingerprint. These are
test-only provider identity projections used to exercise the existing
composition seam; they do not rewrite production source identity semantics.

## Fail-closed and evidence policy

Each injected Runtime failure is terminal. The harness never sends the Native
request as a fallback after a Runtime treatment failure; it records no
provider-bound request for that failing case and trips the per-run kill switch.
The readiness budget test is deliberately a fake transport test, so its 24
accepted attempts are not Provider calls.

The identity/checkpoint probe is in-memory and deterministic. It verifies
single-use study/run claims, terminal checkpoint non-resume/non-overwrite,
sticky kill-switch behavior, and independent transition/verdict/manifest
finalization attempts after an injected write failure. It is not a substitute
for the durable live-run artifact writer.

## Boundary and next gate

```text
C1-C treatment readiness       PASS
C1-C treatment revision        PENDING_C1_C_FREEZE
C1 live authorization          NO_GO
Provider execution             NO_GO
CR-004 Active Rewrite          NO_GO
```

This result proves that the reviewed zero-provider readiness seam can preserve
Native input and produce a distinct, structurally constrained Runtime input
for the synthetic opportunity. It does not prove task effectiveness, token or
cost savings, model behavior, live usage capture, removal precision, or
comparative superiority. Those require the separate Lead live authorization
and the frozen C1 32-pair feasibility contract.
