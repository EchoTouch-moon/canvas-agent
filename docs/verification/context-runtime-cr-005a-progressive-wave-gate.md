# CR-005A — Progressive Wave A Pair Gate

- **Status:** READY_FOR_REVIEW / PROVIDER EXECUTION NOT AUTHORIZED
- **Baseline:** `main@b409de8ba1713dc1fe246326a6ca67e432c02c51`
- **Scope:** research-only Context Runtime benchmark harness
- **Provider calls during implementation and verification:** `0`
- **Wave A / Wave B / CR-004:** `NO_GO`

## Delivered behavior

The Wave A command now runs the frozen scope in this order:

```text
C2 Native → C2 Shadow → pair gate
C3 Native → C3 Shadow → pair gate
C4 Native → C4 Shadow → pair gate
C5 Native → C5 Shadow → pair gate
C6 Native → C6 Shadow → final Wave A gate
```

The runner writes one metadata-only record at a time using an fsync-backed
atomic rename, re-reads the JSONL and verifies record hashes/order, then runs
the pair gate before starting another category. A failed record, pair,
materialization/replay check, evidence safety check, budget check, or
checkpoint check returns `STOPPED` and does not invoke the next category.

Each run has a unique checkpoint directory:

```text
.live-output/wave-a/<run-id>/
  manifest.json       # baseline and frozen execution scope only
  records.jsonl       # durable benchmark metadata
  progress.json       # hashes, order, completed pairs, stop state
  aggregate.json      # terminal PASS/STOPPED metadata only
```

Resume requires the same baseline, the same frozen manifest fingerprints, an
explicit run identity, and explicit Wave A authorization. Terminal checkpoints
and identity mismatches fail closed. Broad `CANVAS_CR005_LIVE=1` and the
replacement-canary flag cannot authorize Wave A; the CLI also requires Node
24.x, a clean worktree, and an exact current HEAD baseline.

## Credential-free evidence

- Progressive tests: **6 passed**.
- Context-benchmark suite: **8 files / 55 tests passed**.
- Full Node 24 `pnpm check`: **PASS** — format, lint, workspace typecheck,
  workspace tests, and build.
- `git diff --check`: **PASS**.
- Adversarial coverage includes failed C2 stop, failed C4 checkpoint stop,
  unsafe absolute-path evidence, broad-flag isolation, terminal resume
  rejection, crash-checkpoint recovery without duplicate work, exact
  ten-record order, and metadata-only manifest checks.
- All progressive runner tests use a fake task executor; no provider runtime or
  provider credential is loaded.

This record does not authorize the ten real Wave A provider runs. A separate
Lead/user authorization is still required before any frozen fixture or task
context is sent to DeepSeek V4 Flash.
