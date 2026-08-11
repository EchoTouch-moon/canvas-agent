# Product MVP v0.2 operator guide

## Supported runtime

- Node.js 24 (`.node-version` and `.nvmrc`; verified with the Node 24 PATH used by CI/local evidence).
- pnpm 11.9.0.
- Git 2.40 or newer.
- macOS for the packaged internal RC gate.
- Codex CLI `0.146.x` for production execution. The deterministic RC suite substitutes a fake executable at the same process boundary and needs no personal account.

Install with `pnpm install --frozen-lockfile`, start source mode with `pnpm dev`, and run source quality with `pnpm check`.

## Choose a repository

Start the application without `CANVAS_AGENT_REPO`. Choose an existing local directory through the native picker. The repository must be readable, be a Git worktree and have a valid `HEAD`. A dirty repository can open for inspection, but execution and initial executable Baseline setup remain blocked until the operator independently commits or stashes changes. Canvas Agent does not clean, commit or push unrelated user changes.

Picker cancellation is a normal non-error outcome. `NOT_GIT_WORKTREE`, `MISSING_HEAD` and `PATH_UNREADABLE` are recoverable selection errors; choose another repository. Workspace application data is isolated below Electron userData in `workspaces/<sha256(canonical-path)>/`. Automated E2E additionally overrides `CANVAS_AGENT_USER_DATA`; normal operators should not set it.

## Agent readiness and authentication

Production never falls back to Fixture. If Codex is not ready:

- `NOT_FOUND`: install Codex or use Configure Agent to select its launcher.
- `UNSUPPORTED_VERSION`: install a supported `0.146.x` launcher.
- `INTERPRETER_MISSING`: repair the selected launcher/runtime installation.
- `AUTH_REQUIRED`: authenticate with the CLI outside Canvas Agent, then retry readiness.
- `ERROR`: retry; if it persists, retain the stable reason code for diagnosis.

Canvas Agent stores only the selected launcher path, never credentials. Finder-launch discovery does not rely solely on an interactive shell PATH. Do not paste tokens into tasks, argv or logs.

The authenticated proof is intentionally separate:

```bash
CANVAS_AGENT_REAL_AGENT_SMOKE=1 pnpm --filter @canvas-agent/desktop e2e:agent
```

It may use network/account quota. Its JSON report is `apps/desktop/dist/reports/agent-smoke.json` and always has one of `executed`, `skipped` or `failed`, the probed executable version when available, a fixed redacted reason, and six non-sensitive tri-state checks covering readiness, dispatch, patch, structured summary, Worker diff check and source-repository isolation. An executed PASS has all checks `true`; a skip records every check as `null`, never false. The report excludes raw prompts, process output, paths and Run identifiers. A skip is not release evidence that a real execution occurred.

## RC commands

```bash
pnpm check
pnpm audit --prod --audit-level high
pnpm e2e:rc
```

If a user-level registry mirror does not implement npm's audit endpoint, do not treat that endpoint error as a clean audit. With explicit network authorization, rerun against the official endpoint:

```bash
pnpm audit --prod --audit-level high --registry=https://registry.npmjs.org
```

`pnpm e2e:rc` is credential-free and macOS-specific. It builds an unsigned unpacked app, exercises repository and Agent executable selection through their E2E-only native-picker seams with isolated userData, validates a supported fake Codex launcher and its committed READY status, runs the full fake-Codex loop and restart/adoption checks, then runs packaged cold start/migration checks. It writes JSON to `apps/desktop/dist/reports/product-mvp-v0.2-rc.json`, scenario logs to `apps/desktop/dist/logs/`, and restart screenshots to `apps/desktop/dist/screenshots/`.

## Internal and external distribution

`pnpm --filter @canvas-agent/desktop build:unpack:unsigned` produces an unsigned internal test build and explicitly disables signing identity selection. macOS may warn when it is opened. This is sufficient only for local/internal RC verification.

Signed, notarized external distribution is a separate decision gate. It requires separately authorized Developer ID credentials, signing, notarization and distribution validation. DS-007 does not claim or perform that work.
