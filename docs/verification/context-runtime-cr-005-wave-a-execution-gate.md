# CR-005 Wave A Execution Gate

- **Status:** CREDENTIAL-FREE READY / PROVIDER EXECUTION NOT AUTHORIZED
- **Branch:** `codex/cr005-wave-a-execution-gate`
- **Base:** `main@3a3b1fffcd752fda2e40db3be5010f41f7f2bd88`
- **Date:** 2026-08-13
- **Provider calls during implementation:** 0

## 1. Scope decision

This packet is research-validation infrastructure in the existing Context
Runtime v0.3 track. It is not Product MVP core work and changes no product
contract, persistence schema, Electron boundary, Worker behavior or Renderer.

Replacement canary run 2 closed the bounded C1 world-state blocker. It did not
authorize the remaining 22 records. The Lead divided those records into two
possible waves so that cross-category evidence is reviewed before repetition:

```text
Wave A: C2-C6 × repetition 1 × {NATIVE, SHADOW} = exactly 10 records
Wave B: C1-C6 × repetition 2 × {NATIVE, SHADOW} = exactly 12 records
```

This packet implements only the Wave A gate. Wave A provider execution, Wave B
and CR-004 all remain `NO_GO` without separate authorization.

## 2. Frozen execution identity

The command selects exactly these category/task pairs, in this order:

| Category | Task                              | Manifest execution fingerprint                                     |
| -------- | --------------------------------- | ------------------------------------------------------------------ |
| C2       | `cr005-c2-multi-file-feature`     | `8eacd176f3615471642d275f6f3db29f720d3e7edd2d767d54851d9e9c65ac2d` |
| C3       | `cr005-c3-failing-test-diagnosis` | `d9d79591dd3bfdbac736e9f56145c7f4acae6b345c81de974be97fe1081e0b78` |
| C4       | `cr005-c4-constrained-refactor`   | `7dd89d22161b6289c1a7f951236f71364d39d8b91de70ffcfda02ee6cda9cedb` |
| C5       | `cr005-c5-unrelated-discovery`    | `e0738b9644bd99de6d48de22c469a111bcf81a2439ff832a801f951e9be30017` |
| C6       | `cr005-c6-wrong-path-rehydration` | `955c20139dc11a12e5596aeaa3702c8367f15cce9f04b52c17cca3b7ede0fb03` |

The canonical fingerprint covers task/category, title, fixture version and
paths, pinned repository revision, initial state hash, prompt, acceptance
criteria, objective/regression oracles, allowed/expected tools, model profile,
strategies, all budgets, writable paths, retention policy, candidate/relevant/
irrelevant annotations and architectural rules. A prompt, fixture, model,
budget or evaluation change therefore fails before `runLiveCorpus` creates a
provider runtime.

The record gate additionally pins the observed model profile to:

```text
provider       deepseek
model          deepseek-v4-flash
thinkingLevel  medium
```

## 3. Dedicated command and cost boundary

```bash
CANVAS_CR005_WAVE_A=1 \
  pnpm --filter @canvas-agent/context-benchmarks benchmark:wave-a
```

Fixed semantics:

1. require the dedicated opt-in value to be exactly `1`;
2. select and fingerprint-check exactly C2-C6;
3. pass `repetitions: 1` to the existing fixed Native/Shadow runner;
4. permit at most ten records and no C1 or repetition-2 record;
5. retain metadata-only JSONL under ignored `.live-output/wave-a/`;
6. evaluate all records through the Wave A machine gate;
7. exit non-zero on skipped execution or any failed check.

The broad `CANVAS_CR005_LIVE=1` variable cannot enable this path. Without the
dedicated flag, the command exits before manifest loading, credential lookup or
provider runtime creation.

## 4. Machine gate

`evaluateWaveAGate` requires every check to pass:

1. exactly 10 records;
2. exact C2-C6 category/task set, two records per task;
3. exactly one Native and one Shadow record per task;
4. repetition exactly 1;
5. exact generated run-id set;
6. globally unique run IDs;
7. every record independently `VALID`, including objective, regression,
   acceptance, writable-path, original-message and payload-absence checks;
8. every record has the exact approved category-specific fixture identity;
9. each Native/Shadow pair has the same pinned fixture identity;
10. each pair has the same model profile;
11. every record has the frozen DeepSeek V4 Flash medium profile;
12. no raw provider payload was captured;
13. no retained Unix, macOS or Windows machine-absolute path;
14. the current credential value is absent;
15. no credential-name, Bearer-token or `sk-`-shaped retained text.

An extra, missing, duplicated, C1, repetition-2, renamed, reprofiled or
otherwise forged record makes the final status `FAIL`.

## 5. Credential-free evidence

Node: `v24.15.0`

```text
context-benchmarks tests                         48 passed
context-benchmarks typecheck                     PASS
credential-free validator                       PASS (C1-C6)
pnpm check                                       PASS (705 tests + build)
dedicated flag unit tests                        PASS
broad-live-only command                          SKIPPED / exit 1
git diff --check                                 PASS
provider calls                                   0
```

The command-level fail-closed probe used `CANVAS_CR005_LIVE=1` while explicitly
removing `CANVAS_CR005_WAVE_A`:

```text
CR-005 Wave A skipped: CANVAS_CR005_WAVE_A=1 is required
WAVE_A_STATUS=SKIPPED
exit 1
```

Tests cover manifest count/task/fingerprint drift, broad-variable isolation,
the exact valid matrix, extra/missing/duplicate strategies, C1 substitution,
repetition 2, forged run IDs, fixture/model mismatches, mutually consistent but
unauthorized fixture/model changes, invalid acceptance, credential canaries,
machine paths and credential-shaped evidence.

## 6. Frozen next gate

```text
replacement C1 run 2           PASS / evidence merged
Wave A credential-free gate    READY_FOR_REVIEW
Wave A 10 provider records     NO_GO / requires explicit data+cost authorization
Wave B 12 provider records     NO_GO
CR-004 Active rewrite          NO_GO
```

After code review and CI, the Lead may request a separate authorization for the
exact ten-record command. A Wave A `FAIL` stops the research sequence and never
authorizes Wave B. A Wave A `PASS` still requires a Lead value/cost/churn review
before any repetition-2 execution.
