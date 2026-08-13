# CR-005 Wave A Run 1 — C2 Native stop evidence

## Scope and authorization

- **Authorization:** GRANTED for at most ten frozen Wave A Native/Shadow records.
- **Provider/model:** `deepseek/deepseek-v4-flash`.
- **Baseline:** `main@635a72bb9c208ed3a4bc490d5e54392e36e43738`.
- **Authorized budget:** 160 semantic calls, 640 tool calls, 1,500,000 ms
  manifest wall-clock budget.
- **Not authorized:** Wave B and CR-004.

Run identity:

```text
wave-a-1786604041457-98cb9e49-797b-48a5-8797-cb79b47b1143
```

The run was executed from the clean merge baseline. The failed record and its
checkpoint were retained; neither was deleted, overwritten, or resumed.

## Execution result

| Scope item | Result |
| --- | --- |
| C2 Native | Executed; `INVALID` |
| C2 Shadow | Not executed |
| C3–C6 | Not executed |
| Provider calls | 1 record; 9 semantic calls |
| Tool calls/results | 20 / 20 |
| Record wall clock | 23,072 ms |
| Pair gate | Not reached |
| Wave A status | `STOPPED` |

The progressive runner stopped at the record gate with
`stopReason=record_gate_failed`. The durable checkpoint reports one record,
zero completed pairs, and the next category still at C2:

```text
checkpoint: /private/tmp/canvas-cr005a-main-635a72bb9/research/context-benchmarks/.live-output/wave-a/wave-a-1786604041457-98cb9e49-797b-48a5-8797-cb79b47b1143/
record hash: 9d72876f5d118f8866e4da9acc6a8033f6d5783486a0a9242900c0e9c50a99b4
checkpoint output sha256: fc1a19d57892ed538f2f3158bef6d4ba9dd5c5a2fa3c3332a83ad819551b9817
```

The terminal `STOPPED` state rejects resume by design. Any future execution
must use a new run identity and a new explicit authorization after the C2
validity decision; this checkpoint is not a resumable Wave A continuation.

## Recorded failure evidence

- Objective oracle: **PASS**.
- Regression oracle: **PASS**.
- `C2-3` contract probe: **FAIL** with
  `configRuntime=false;greetingRuntime=false;indexForwarding=true`.
- Writable-path scope: **FAIL** because the record changed `package.json` in
  addition to the three expected `src/*.js` paths.
- Raw provider payloads: not retained.
- Credential/security and observation failures: none recorded.

The record therefore remains a failed benchmark attempt, not a model-quality
pass. The historical probe reported `protocolValid=true`, so under the strict
post-CR-005B attribution rule this record is a `TASK_FAILURE` with two signals:
the trusted C2 contract returned false, and the `package.json` mutation violated
the writable-path scope. CR-005B is a post-hoc evaluator repair because the old
trusted probe was over-specific about reference implementation shape; it does
not prove that this particular model patch satisfied the intended contract.
The historical outcome remains `STOPPED` and is not reclassified as a success
or rewritten as a pure `HARNESS_CONTRACT_FAILURE`.

## Decision

- Wave A: **BLOCKED** after C2 Native.
- Wave B: **NO_GO**.
- CR-004: **NO_GO**.
- Next work item: **CR-005B — C2 Acceptance Contract Validity Repair**.

CR-005B is limited to the benchmark/evaluator. It must preserve this evidence,
avoid checkpoint resume, and complete credential-free regression before any
new Wave A authorization is considered.
