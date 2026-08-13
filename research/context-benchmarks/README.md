# CR-005 Native + Shadow benchmark corpus

This package is a research-only, credential-free harness for comparing the
existing Pi Native context path with the existing Shadow observation/planning
path. Both strategies receive the original Pi messages unchanged. Shadow
records hypothetical Working Set decisions and never rewrites a provider
payload.

The committed corpus contains six deliberately small Git-backed fixtures:

1. localized bug fix;
2. multi-file feature;
3. failing-test diagnosis;
4. refactor with an architectural constraint;
5. discovery across unrelated candidate files; and
6. a longer wrong investigative path that can exercise rehydration evidence.

The default validation command is credential-free:

```sh
pnpm --filter @canvas-agent/context-benchmarks benchmark:validate
```

It materializes each fixture into a temporary Git repository, verifies its
fixed revision and state hash, runs the focused objective oracle plus a
distinct regression oracle, and checks deterministic Native/Shadow aggregation
fixtures. Live records carry one machine-backed result per manifest acceptance
criterion, and `VALID` requires all of them to pass. It does not call a model
provider.

C2-3 has an additional deterministic executable contract check. The untrusted
CommonJS fixture modules run in a `shell: false` child process with a strict
environment allowlist, a fixed IPC JSON result schema, a timeout, process-tree
termination, and a bounded output pipe. The parent verifies that config exports
the punctuation, probes greeting with a sentinel config to verify formal
behavior, and injects a greeting spy to verify the public index forwards the
option and returns the greeting result. An adversarial index-only implementation
with comment/dead-code markers is covered and fails this check. C2 probe output
is not retained in benchmark evidence.

Oracle processes and the Agent `bash` tool use the same explicit environment
allowlist; provider credentials, Node preload hooks, and shell startup hooks
are not inherited. Credential-canary tests cover both boundaries.

When live mode is eventually authorized, Shadow repository/file candidates are
populated only after an actual Agent `read` has been observed and verified by
the RepositoryObserver. Manifest-known candidate/relevant paths remain
evaluator metadata and are never passed to the Planner. Final validity compares
committed changes from the fixture's initial Git commit as well as staged,
unstaged, and untracked changes, and rejects paths outside
`expectedWritablePaths`.

Live runs are explicit opt-in only:

```sh
CANVAS_CR005_LIVE=1 pnpm --filter @canvas-agent/context-benchmarks benchmark:live
```

Live output is metadata-only and ignored by Git. The harness does not report
provider billing or token savings; Native estimates and Shadow semantic
estimates remain separate measurements.

The post-DS-014 replacement canary has a separate fail-closed entry point. It
selects exactly `C1-localized-bug-fix`, uses one repetition, and therefore can
produce only one Native plus one Shadow record. It exits non-zero on skipped,
invalid, over-broad, unsanitized, revision-degraded, or missing world-state
evidence. This command does **not** authorize the remaining 22 records:

```sh
CANVAS_CR005_REPLACEMENT_CANARY=1 \
  pnpm --filter @canvas-agent/context-benchmarks benchmark:replacement-canary
```

The command is still a real provider operation and must only be used after the
lead's explicit cost authorization. Without the dedicated environment flag it
fails closed before loading provider credentials or starting a run.

The next research wave also has a separate fail-closed entry point. Wave A is
frozen to the first repetition of categories C2 through C6, with one Native and
one Shadow record per category: exactly ten records. C1 is excluded because its
first repetition already passed the replacement canary. Canonical fingerprints
pin each selected manifest's prompt, fixture identity, tools, model profile,
budget, oracles, acceptance criteria, writable paths and evaluator annotations.
Any drift is rejected before the provider runtime is created.

```sh
CANVAS_CR005_WAVE_A=1 \
CANVAS_CR005_WAVE_A_BASELINE_SHA="$(git rev-parse HEAD)" \
  pnpm --filter @canvas-agent/context-benchmarks benchmark:wave-a
```

The command is progressive and executes only `C2 Native → C2 Shadow`, then the
next category. Each record is written and re-read before the next boundary; a
failed pair or checkpoint stops the command before the next category. The
checkpoint is metadata-only and lives under:

```text
.live-output/wave-a/<run-id>/
  manifest.json
  records.jsonl
  progress.json
  aggregate.json       # only after PASS or STOPPED
```

`CANVAS_CR005_LIVE=1` and the replacement-canary flag cannot be combined with
the Wave A flag. The command also requires Node 24, a clean worktree, and an
exact current HEAD baseline. To resume a still-running checkpoint, provide the same baseline,
`CANVAS_CR005_WAVE_A_RUN_ID=<run-id>`, and
`CANVAS_CR005_WAVE_A_RESUME=1` under the same explicit Wave A authorization.
A terminal checkpoint cannot be resumed; use a new authorization and run
identity. This implementation does not authorize the ten provider records,
the twelve records left for a possible second wave, or CR-004 Active context
rewriting.
