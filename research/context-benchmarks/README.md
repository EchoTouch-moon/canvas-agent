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

C2-3 has an additional deterministic executable contract check: it loads the
real CommonJS modules, verifies config exports the punctuation, probes greeting
with a sentinel config to verify formal behavior, and injects a greeting spy to
verify the public index forwards the option and returns the greeting result.
An adversarial index-only implementation with comment/dead-code markers is
covered and fails this check.

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
