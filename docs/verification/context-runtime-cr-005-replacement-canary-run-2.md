# CR-005 Replacement Canary Run 2

- **Status:** PASS / BOUNDED CANARY COMPLETE
- **Research baseline:** `main@08b13dee2a712c5b0715a645443f72d07ea44072`
- **Date:** 2026-08-13
- **Authorized shape:** `C1-localized-bug-fix × repetition 1 × {NATIVE, SHADOW}`
- **Provider/model:** `deepseek/deepseek-v4-flash`
- **Provider records consumed:** exactly 2
- **Remaining CR-005 records:** `NO_GO` pending a separate Lead scope/cost decision
- **CR-004 Active rewrite:** `NO_GO`

## 1. Authorization and execution boundary

The user explicitly authorized both the cost and external transmission of the same synthetic
C1 fixture for exactly two additional records. The command explicitly removed the broad
`CANVAS_CR005_LIVE` switch and enabled only the dedicated replacement-canary path.

The transmitted repository remained the five-file synthetic percentage-discount fixture. No
Canvas Agent product source or user repository was placed in the fixture.

The dedicated command completed with exit code 0:

```text
REPLACEMENT_CANARY_STATUS=PASS
recordCount=2
```

No additional manifest, repetition or strategy was executed.

## 2. Machine-gate result

Every required check passed:

```text
exactRecordCount                         true
exactCategoryAndTask                    true
exactStrategyPair                       true
exactRepetition                         true
allRecordsValid                         true
rawProviderPayloadsAbsent               true
retainedEvidenceSanitized               true
credentialValueAbsent                   true
secretPatternsAbsent                    true
revisionMismatchMaterializationAbsent   true
dirtyWorldUnavailableRecorded           true
lastKnownVersionPreserved               true
pinnedRepresentationRecovered           true
```

This is the first live record that simultaneously proves task validity and the post-edit
world-state chain required by the replacement gate.

## 3. Task-level evidence

| Strategy | Semantic calls | Tool calls | File reads | Wall clock | Objective | Regression | Acceptance | Writable paths |
| -------- | -------------: | ---------: | ---------: | ---------: | --------- | ---------- | ---------- | -------------- |
| Native   |              7 |         12 |          5 |     13.7 s | PASS      | PASS       | PASS       | PASS           |
| Shadow   |              9 |         13 |          6 |     18.2 s | PASS      | PASS       | PASS       | PASS           |

Both records:

- had status `VALID`;
- changed only `src/discount.js`;
- preserved original Pi message identity;
- retained no raw Provider payload;
- had no abort reason.

## 4. World-state proof

The Shadow run recorded the post-edit transition at model-call sequence 6. For the exact
`repository/file://src/discount.js` source:

1. the initial clean read admitted SourceVersion
   `d941785dbce829b2efc7af7fd4bf8e711c7891d61f36c970bd93a21896e00824`;
2. the mutation refresh recorded `UNAVAILABLE(REVISION_MISMATCH)` after the worktree edit;
3. `admittedVersionId` and `lastAvailableVersionId` both remained bound to that exact version;
4. the representation provider produced `FULL` from that version on sequences 6–9;
5. no materialization failure contained `REVISION_MISMATCH`.

The repository observation ledger contained 21 bounded entries, including 16 expected
post-edit `UNAVAILABLE(REVISION_MISMATCH)` observations across the five already observed
fixture files. These expected unavailable states also appear in the existing bounded
diagnostic list; that naming/noise issue is not a correctness failure and is not changed by
this evidence-only packet.

## 5. Artifact integrity and retention

The metadata-only JSONL remains ignored and is not committed:

```text
artifact basename    cr005-1786554086587.jsonl
artifact bytes       538225
artifact lines       2
SHA-256              2a639659b51c4acb4cb6902b783fb01d36502784eff0cab489dc78cb00c11d78
Git status           ignored by repository rule
```

The artifact flags `rawProviderPayloadsCaptured=false` for both records. The machine gate also
found no retained credential value, secret-shaped token or durable absolute machine path.

## 6. What this result proves—and what it does not

Run 2 proves, for the bounded C1 case:

- the dedicated two-record cost gate is exact;
- the mutation refresh does not depend on a post-edit reread;
- dirty repository state reaches the Shadow Universe;
- `UNAVAILABLE` retains the exact last-known SourceVersion;
- immutable Git-blob materialization can recover a `FULL` representation after the worktree
  changes;
- both Native and Shadow still complete the objective without changing input messages.

It does **not** yet prove:

- quality or cost gains across the six-category corpus;
- stable behavior across the remaining 22 records;
- acceptable aggregate churn, rehydration and representation distributions;
- readiness for CR-004 Active context rewriting.

## 7. Frozen next gate

The technical blocker for discussing the remaining CR-005 matrix is closed. The matrix remains
`NO_GO` until the Lead makes a separate bounded scope/cost decision. CR-004 remains `NO_GO`
regardless of that decision.

```text
replacement run 1                FAIL / STOP (trigger coverage insufficient)
mutation refresh remediation     MERGED / CI GREEN
replacement run 2                PASS (exactly 2 records)
remaining CR-005 22 records      NO_GO / requires separate authorization
CR-004 Active rewrite            NO_GO
```

See also:

- [replacement canary run 1](./context-runtime-cr-005-replacement-canary-run-1.md)
- [mutation refresh preflight](./context-runtime-cr-005-mutation-refresh-preflight.md)
- [replacement canary execution gate](./context-runtime-cr-005-replacement-canary-gate.md)
