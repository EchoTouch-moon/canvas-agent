# Contributing

## Branches

Never develop directly on `main`.

```text
agent/deepseek-ds-003-release-reliability
agent/deepseek-ds-004-workspace-runtime
agent/deepseek-ds-005-local-cli-adapter
agent/deepseek-ds-006-live-client-state
agent/luna-ui-003-live-first-shell
agent/deepseek-ds-007-product-mvp-rc
```

Only create the branch for a task marked READY in `docs/tasks/README.md`. Completed foundation branches are historical and must not be reused.

Start from the latest remote main:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git switch -c <assigned-branch>
pnpm install --frozen-lockfile
pnpm check
```

## Commits

Use Conventional Commits and keep one logical change per commit:

```text
feat(persistence): add immutable node version schema
feat(ui): add compact application shell
test(worker): cover revision mismatch rejection
docs(adr): record blob storage decision
```

## Pull requests

Every pull request must include:

- task packet ID;
- modified file list;
- acceptance-criterion evidence;
- exact validation commands and results;
- screenshots at the sizes/themes required by the assigned UI packet (UI-003: 1440×960 and 1080×720, light and dark);
- unresolved questions, risks and scope deviations;
- confirmation that no unrelated files were changed.

The architect reviews outcomes as `ACCEPT`, `ACCEPT_WITH_FOLLOW_UP`, `REQUEST_CHANGES`, or `REJECT_AND_REPLAN`.

## Integration order

1. Merge DS-003 release reliability.
2. Merge DS-004 workspace runtime. DS-005A Worker-only work may proceed separately, but DS-005 Main/command integration waits for DS-004.
3. Merge DS-005 real local Agent after rebasing/integrating current `main`.
4. Merge DS-006 Live client state and functional onboarding.
5. Start and merge Luna UI-003 only after DS-006.
6. Merge DS-007 RC evidence/doc work after all implementation tasks.
7. The lead architect makes the final Product MVP status decision.

Do not merge a UI implementation that bypasses IPC or a backend implementation that imports renderer code.
