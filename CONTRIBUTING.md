# Contributing

## Branches

Never develop directly on `main`.

```text
agent/deepseek-ds-001-persistence
agent/deepseek-ds-002-worker-runtime
agent/luna-ui-001-foundation
agent/luna-ui-002-core-flow
```

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
- screenshots at 1440×1080 and 1180×820 for UI work;
- unresolved questions, risks and scope deviations;
- confirmation that no unrelated files were changed.

The architect reviews outcomes as `ACCEPT`, `ACCEPT_WITH_FOLLOW_UP`, `REQUEST_CHANGES`, or `REJECT_AND_REPLAN`.

## Integration order

1. Merge contract/ADR changes first, when explicitly approved.
2. Merge DeepSeek persistence foundation.
3. Merge Luna UI foundation (may proceed in parallel if contracts remain unchanged).
4. Rebase second-wave branches on the integrated main.
5. Merge the Worker runtime before wiring real execution into UI.

Do not merge a UI implementation that bypasses IPC or a backend implementation that imports renderer code.
