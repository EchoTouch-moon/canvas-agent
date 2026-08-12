# Contributing

Canvas Agent welcomes focused contributions that improve the local-first project-control loop. Before starting a larger change, please open or comment on an issue so the scope and acceptance criteria are explicit.

## External contributor quick start

Use a fork and a short-lived branch; do not develop directly on `main`.

```bash
git clone https://github.com/your-account/canvas-agent.git
cd canvas-agent
git switch -c contributor/short-description
pnpm install --frozen-lockfile
pnpm check
```

Keep the change focused and include tests or documentation for the behavior being changed. A documentation-only change does not need to manufacture code changes, but its links and commands should still be checked.

Before proposing a new feature, explain whether it is required for the current loop, an enhancement, a future direction or an unscheduled idea. Only work required for the current loop enters implementation without a separate scope decision.

## Branches

Never develop directly on `main`.

```text
contributor/short-description
```

Use a dedicated branch for each change and do not reuse completed work branches.

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

- task packet ID when one is assigned, or the issue/discussion that defines the change;
- modified file list;
- acceptance-criterion evidence;
- exact validation commands and results;
- screenshots at the sizes/themes required by the assigned UI packet (UI-003: 1440×960 and 1080×720, light and dark) when UI is changed;
- unresolved questions, risks and scope deviations;
- confirmation that no unrelated files were changed.

Do not include secrets, access tokens, private customer data or raw provider payloads in a pull request. Use the [Security Policy](SECURITY.md) for vulnerability reports rather than opening a public issue.

The architect reviews outcomes as `ACCEPT`, `ACCEPT_WITH_FOLLOW_UP`, `REQUEST_CHANGES`, or `REJECT_AND_REPLAN`.

Do not merge a UI implementation that bypasses IPC or a backend implementation that imports renderer code.
