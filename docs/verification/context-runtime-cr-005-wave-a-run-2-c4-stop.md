# CR-005 Wave A Run 2 — C4 Native stop evidence

## Scope and authorization

- **Authorization:** AUTHORIZED for at most ten frozen Wave A Native/Shadow records.
- **Provider/model:** `deepseek/deepseek-v4-flash`.
- **Harness:** post-CR-005B.
- **Baseline:** `main@b1984f794e3759421525abd7cefb416fb6606815`.
- **Authorized budget:** 160 semantic calls, 640 tool calls, 1,500,000 ms
  manifest wall-clock budget.
- **Not authorized:** Wave B and CR-004.

Run identity:

```text
wave-a-1786613262589-0262811a-ad35-4b8d-b745-4cda69e7b619
```

This was a new run from the post-CR-005B main baseline. Wave A Run 1's
terminal checkpoint was not resumed, and its run identity was not reused. The
manifest, frozen fixtures, model profile, and evaluator were not changed
during this execution.

## Execution result

| Scope item | Result |
| --- | --- |
| C2 Native | Executed; `VALID` |
| C2 Shadow | Executed; `VALID` |
| C2 pair gate | **PASS** |
| C3 Native | Executed; `VALID` |
| C3 Shadow | Executed; `VALID` |
| C3 pair gate | **PASS** |
| C4 Native | Executed; `INVALID` / `TASK_FAILURE` |
| C4 Shadow | Not executed |
| C5–C6 | Not executed |
| Completed pairs | 2 |
| Records written | 5 |
| Wave A status | `STOPPED` |

The progressive runner stopped at the C4 Native record gate with
`stopReason=record_gate_failed`. No provider task was started after that
record. The durable checkpoint is identified by this run-relative directory:

```text
.live-output/wave-a/wave-a-1786613262589-0262811a-ad35-4b8d-b745-4cda69e7b619/
checkpoint status: STOPPED
checkpoint stop reason: record_gate_failed
checkpoint output record count: 5
checkpoint output sha256: b2b10e9f7d2e510b62f4d851c07e948a344904a1ba2ad74428237fe61dc49fc2
```

The terminal `STOPPED` state is preserved and is not resumable. Any future
execution requires a new run identity and a separate decision; this
checkpoint is not a continuation point.

## Budget and durable-record accounting

The authorization budget is charged against all executed records, including
the failed C4 Native record:

| Counter | Executed | Authorized maximum |
| --- | ---: | ---: |
| Semantic calls | 38 | 160 |
| Tool calls/results | 74 / 74 | 640 |
| Record wall-clock time | 84,236 ms | 1,500,000 ms |

The terminal aggregate reports 28 semantic calls and 53 tool calls because its
research totals intentionally include only the four `VALID` records. The
38/74 figures above are the execution-budget totals across all five durable
records and are the relevant authorization accounting.

No raw provider payloads were retained. The run recorded zero materialization
failures, zero aborted records, and zero harness-contract failure diagnoses.

## Recorded failure evidence

C4 Native passed its objective and regression oracles, but changed an
out-of-scope path:

```text
changed paths:
  src/cli/normalize.js
  src/domain/normalize.js
  src/domain/user.js
out-of-scope path:
  src/cli/normalize.js
writable path scope: FAIL
failure class: TASK_FAILURE
failure signal: WRITABLE_PATH_SCOPE_FAILED
```

The C2 and C3 Shadow records also retain `OBSERVATION_FAILURE` metadata caused
by `REVISION_MISMATCH` repository observations (54 aggregate observation
failure entries). Under the current CR-005A record-validity predicate, these
records remained `VALID` and their pair gates passed; the observation evidence
is preserved for Wave A synthesis and must not be silently treated as clean
shadow evidence.

The run therefore remains a failed, incomplete benchmark attempt. The C4
task-scope failure is not reclassified as a harness-contract failure, and the
valid C2/C3 records do not authorize continuation after the terminal C4 stop.

## Decision

- Wave A Run 2: **STOPPED / BLOCKED at C4 Native**.
- Wave A Run 1 checkpoint: **TERMINAL / NOT RESUMED**.
- Wave B: **NO_GO**.
- CR-004: **NO_GO**.
- Next step: preserve this evidence and perform bounded Wave A evidence
  synthesis/diagnosis before any new execution decision.
