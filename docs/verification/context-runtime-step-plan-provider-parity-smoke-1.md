# Step Plan provider parity smoke — Run 1

- **Status:** PROVIDER_PARITY_PASS — not benchmark evidence
- **Provider layer commit:** `07d9b5469d71bbff2574833818520dc4d32bd8b7`
- **Strict binding commit:** `b9f4426690b452d7fa8dfaf31515a697be1414bb`
- **Run identity:** `cspv-step-plan-parity-20260825-001`
- **Runtime session:** `smoke-provider-2026-08-25T07-20-35-320Z`
- **Requested provider:** `step-plan`
- **Actual provider:** `step-plan`
- **Model:** `step-3.7-flash`
- **Fallback:** forbidden and not used
- **Provider config hash:** `dbcbff3eb4549710faaa018aab784dbb56c3082dae673931c50cb15d999eabc8`
- **B0/CSPV traces:** not used
- **C0 evidence:** not produced

## Result

The opt-in Pi smoke completed successfully through the strict provider entry
point. Provider identity remained bound to Step Plan, the selected model was
registered before the session prompt, and no DeepSeek fallback occurred.

The smoke used one session prompt but produced **two model-call records**:

```text
model-call records: 2
sequences:          1, 2
tool result counts: 0, 1
provider calls:     2
```

This count is recorded explicitly. It must not be reported as one provider
call merely because it was one smoke session.

## Provenance

The live smoke executed against the strict-binding implementation at commit
`b9f44266`. That implementation was later rebased equivalently onto the
post-PR-45/PR-46 `main`, producing `f64d5a1`; the current PR #47 head
`f94a753` adds only a credential-independent `providerConfigHash` test
follow-up. The provider implementation used by the smoke is therefore
preserved by provenance; no live rerun is required.

## Boundary

This is provider compatibility and strict-binding evidence only. It does not
validate CSPV-B1 policy behavior, Gate B, lifecycle decisions, REMOVE or
REHYDRATE semantics, task quality, token savings or causal context effects.

The raw smoke JSONL remains an ignored local artifact; this document contains
only redacted metadata and no credential or model transcript.

## Next step

PR #47 is now based on `main` after PR #45 and PR #46 and remains pending
normal review. After #47 merges, this evidence PR should retarget/rebase onto
the resulting `main`; the observed two-call behavior must be reflected in the
future C0 manifest by separating `scenarioRunLimit` from
`providerCallBudget`.
