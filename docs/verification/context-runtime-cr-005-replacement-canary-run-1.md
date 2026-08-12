# CR-005 Replacement Canary Run 1

- **Status:** FAIL / STOP
- **Research baseline:** `main@a359636609856977a98a883831392084f7cb4a4d`
- **Date:** 2026-08-13
- **Authorized shape:** `C1-localized-bug-fix × repetition 1 × {NATIVE, SHADOW}`
- **Provider/model:** `deepseek/deepseek-v4-flash`
- **Provider records consumed:** exactly 2
- **Remaining CR-005 records:** `NO_GO`
- **CR-004 Active rewrite:** `NO_GO`

## 1. Authorization and data boundary

The user explicitly authorized both the cost and external transmission boundary for exactly
two records. The transmitted repository was the synthetic C1 fixture only: five small files
containing a percentage-discount bug and tests. No Canvas Agent product source or user
repository was placed in the benchmark fixture.

The runner retained metadata-only JSONL under the gitignored
`.live-output/replacement-canary/` directory. Raw provider payload capture remained disabled.

```text
artifact basename    cr005-1786551983273.jsonl
artifact bytes       408342
artifact lines       2
SHA-256              d2d7b1a81a34245fdc73a64a0dda51da36131db124ee9dad9966c11eca99121b
Git status           ignored by repository rule
```

## 2. Machine-gate result

The dedicated command selected exactly one manifest, one repetition and the fixed two-strategy
loop. It wrote exactly two records and exited non-zero:

```text
recordCount                              2       PASS
exactCategoryAndTask                     true    PASS
exactStrategyPair                        true    PASS
exactRepetition                          true    PASS
allRecordsValid                          true    PASS
rawProviderPayloadsAbsent                true    PASS
retainedEvidenceSanitized                true    PASS
credentialValueAbsent                    true    PASS
secretPatternsAbsent                     true    PASS
revisionMismatchMaterializationAbsent    true    PASS
dirtyWorldUnavailableRecorded            false   FAIL
lastKnownVersionPreserved                false   FAIL
pinnedRepresentationRecovered            false   FAIL

REPLACEMENT_CANARY_STATUS=FAIL
```

The broad `CANVAS_CR005_LIVE` switch was explicitly removed from the command environment. No
additional manifest, repetition or strategy was executed after the failure.

## 3. Task-level result

Both individual task runs were independently `VALID`:

| Strategy | Semantic calls | Tool calls | File reads | Wall clock | Objective | Regression | Writable paths |
| -------- | -------------: | ---------: | ---------: | ---------: | --------- | ---------- | -------------- |
| Native   |              8 |         12 |          6 |     10.9 s | PASS      | PASS       | PASS           |
| Shadow   |              8 |         12 |          5 |     14.7 s | PASS      | PASS       | PASS           |

Both changed only `src/discount.js`, preserved original Pi message identity and retained no raw
provider payload.

Task success is not world-state proof. The aggregate therefore remains FAIL.

## 4. Root cause: the live trigger did not occur

The Shadow run recorded five authoritative repository observations, all `AVAILABLE`. Its real
file-read evidence ended before the mutation:

```text
model call 1: read src/discount.js
model call 2: read README.md, package.json
model call 3: read test/regression.test.js, test/discount.test.js
model calls 4–8: no file read
```

The Agent then fixed the file and ran the checks without rereading a repository file. The
runner only invoked `RepositoryObserver` after `read`, so the post-edit dirty world was never
observed. Consequently:

- there was no `UNAVAILABLE(REVISION_MISMATCH)` observation to reconcile;
- the admitted source never exercised `RETAIN_LAST_KNOWN` in this live record;
- pinned Git-blob materialization was never asked to recover that unavailable source.

There were also no `REVISION_MISMATCH` materialization failures. This result therefore neither
proves nor disproves the DS-014 pinned-blob fix. It exposes a deterministic trigger-coverage
gap in the benchmark runner.

## 5. Bounded credential-free remediation

The remediation is limited to `research/context-benchmarks`:

1. a completed `edit`, `write` or `bash` tool marks a one-shot mutation refresh pending;
2. the next model-call boundary first waits for earlier read observations;
3. it refreshes only repository paths discovered by actual Agent reads;
4. evaluator candidate/relevant annotations never enter the refresh set;
5. refreshed `UNAVAILABLE` state reaches the existing DS-014 reconciliation and pinned-blob
   materializer before Shadow planning;
6. the signal is consumed exactly once per boundary.

This is harness reliability work, not Product MVP behavior and not an Active context rewrite.

## 6. Frozen next gate

Credential-free implementation, review and CI must complete before another live execution is
considered. Because the first authorization was consumed by exactly two records, any
replacement rerun requires a new explicit authorization for another two Provider records and
the same synthetic-fixture transmission boundary.

```text
replacement run 1                FAIL / STOP (2 records consumed)
credential-free mutation refresh CREDENTIAL-FREE READY / review pending
replacement rerun                NOT AUTHORIZED
remaining CR-005 22 records      NO_GO
CR-004 Active rewrite            NO_GO
```

The follow-up credential-free evidence is recorded in
[`context-runtime-cr-005-mutation-refresh-preflight.md`](./context-runtime-cr-005-mutation-refresh-preflight.md).
