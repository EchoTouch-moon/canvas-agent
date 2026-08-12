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
fixed revision and state hash, runs the known-bad and known-good oracles, and
checks deterministic Native/Shadow aggregation fixtures. It does not call a
model provider.

Live runs are explicit opt-in only:

```sh
CANVAS_CR005_LIVE=1 pnpm --filter @canvas-agent/context-benchmarks benchmark:live
```

Live output is metadata-only and ignored by Git. The harness does not report
provider billing or token savings; Native estimates and Shadow semantic
estimates remain separate measurements.
