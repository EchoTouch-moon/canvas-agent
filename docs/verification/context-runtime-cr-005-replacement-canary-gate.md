# CR-005 Replacement Canary Execution Gate

- **Status:** SUPERSEDED AFTER LIVE RUN 1 — execution gate worked and stopped on missing world-state evidence
- **Branch:** `codex/cr005-replacement-canary-gate`
- **Base:** `main@d50e9c2dad466edd732be08b2ddb3a9589195b20`
- **Date:** 2026-08-13
- **Provider calls during implementation:** 0

## 1. Problem closed

The existing `benchmark:live` command intentionally represents the full CR-005 matrix. Once
opted in, it loads all six manifests with two repetitions and both strategies: 24 provider
records. It could not safely express the post-DS-014 replacement gate:

```text
C1-localized-bug-fix × repetition 1 × {NATIVE, SHADOW} = exactly 2 records
```

Using the broad command for the replacement canary would violate the frozen cost and stop
boundary. This packet adds a distinct fail-closed execution path; it does not modify the full
matrix and does not authorize provider execution.

## 2. Bounded command

The new command is:

```bash
CANVAS_CR005_REPLACEMENT_CANARY=1 \
  pnpm --filter @canvas-agent/context-benchmarks benchmark:replacement-canary
```

It has these fixed semantics:

1. select exactly the one `C1-localized-bug-fix` manifest, or throw before execution;
2. pass `repetitions: 1` to `runLiveCorpus`;
3. rely on the existing fixed strategy loop `{NATIVE, SHADOW}`;
4. write metadata-only JSONL under ignored `.live-output/replacement-canary/`;
5. evaluate the written in-memory records through the replacement-canary machine gate;
6. exit non-zero when skipped or when any gate check fails.

It uses a dedicated opt-in variable. Without exact value `1`, it returns
`REPLACEMENT_CANARY_STATUS=SKIPPED` with a non-zero exit before manifest loading, credential
lookup or provider execution. The existing broad `CANVAS_CR005_LIVE` variable cannot enable
this command.

## 3. Machine gate

`evaluateReplacementCanaryGate` requires all of the following:

- exactly two records;
- exactly one Native and one Shadow record;
- exact C1 task/category and repetition 1;
- both records independently `VALID` with objective, regression, acceptance, writable-path,
  message-identity and raw-provider-payload gates passing;
- durable evidence contains no macOS/Linux/Windows machine-absolute path;
- the current environment credential value is absent from serialized records;
- credential-name, Bearer-token and `sk-`-shaped retained text is absent;
- Shadow materialization has no `REVISION_MISMATCH` failure;
- an explicit `UNAVAILABLE(REVISION_MISMATCH)` repository observation is retained;
- the exact same repository source keeps its admitted/last-available SourceVersion;
- the exact same source is rematerialized as `FULL` or `LINE_RANGE` from that version.

The last three checks are source-key-bound. Evidence from unrelated repository paths cannot be
combined into a false PASS.

## 4. Credential-free evidence

```text
@canvas-agent/context-benchmarks tests       38 passed
@canvas-agent/context-benchmarks typecheck   PASS
pnpm check                                   PASS (695 tests + build)
git diff --check                             PASS
```

Test coverage includes exact manifest selection, a valid two-record pair, over-broad and
duplicate-strategy rejection, revision-degraded materialization, missing last-known/pinned
evidence, cross-source evidence mismatch, current credential retention, credential-shaped
text, Unix/macOS absolute paths, and Windows paths without confusing canonical
`repository/file://` Source keys.

The real command was also invoked without its opt-in flag and failed closed as expected:

```text
CR-005 replacement canary skipped: CANVAS_CR005_REPLACEMENT_CANARY=1 is required
REPLACEMENT_CANARY_STATUS=SKIPPED
exit 1
```

No provider credential was loaded and no provider call was made during implementation or
verification.

The first authorized two-record execution later completed and failed this machine gate. See
[`context-runtime-cr-005-replacement-canary-run-1.md`](./context-runtime-cr-005-replacement-canary-run-1.md).
That result does not retroactively invalidate the credential-free gate; it proves the gate
correctly refused to accept incomplete live evidence.

## 5. Frozen next gate

This change only makes the already-approved experiment shape executable and auditable.

```text
replacement C1 provider run    NOT RUN / requires explicit cost authorization
remaining CR-005 22 records    NO_GO
CR-004 Active rewrite          NO_GO
```

After this PR passes review and CI, the lead may request explicit cost authorization for the
two-record command. A failing replacement gate must stop the sequence; it must not fall
through to the broad matrix.
