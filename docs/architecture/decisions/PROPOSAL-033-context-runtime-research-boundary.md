# PROPOSAL-033 — Context Runtime research boundary and Electron reference client

- **Status:** PHASE 1 IN PROGRESS — logical separation only
- **Date:** 2026-09-09
- **Scope:** CI surfaces, dependency audit boundaries and repository architecture language
- **Non-impact:** no physical repository split, no Product MVP contract change, no Context Runtime policy change

## 1. Context

The project began as a local-first Electron application. Its research object is now broader:

```text
Context Runtime / Context Lifecycle / Working Set / Provenance
Intervention / Replay / Effectiveness
```

Electron remains useful as the Product MVP shell and a visualization/reference client, but it is not
the research object. Keeping the Electron RC job in the default source gate makes an unrelated
desktop dependency, packaging binary or macOS runner failure appear to be a Context Runtime failure.
It also makes a whole-repository commit SHA a noisy experimental execution binding when only UI code changes.

## 2. Decision

Use a one-way dependency direction:

```text
Electron reference client
          ↓ consumes
contracts / domain / persistence / worker
          ↓ supports
headless Context Runtime and research harness
```

The Context Runtime core and research harness must not import Electron, Chromium, desktop IPC or
packaging code. This is a logical boundary inside the current monorepo. A second repository is deferred
until the client has an independent release cadence, the Runtime has multiple external consumers and a
published package boundary is useful.

## 3. Phase 1 implementation

### Context Runtime CI (`.github/workflows/ci.yml`)

- Runs only for `packages/**`, `research/**`, core CI scripts, workspace manifests and the core workflow.
- Installs the workspace with `pnpm install --frozen-lockfile --filter '!@canvas-agent/desktop'`.
- Runs core formatting, available core lint hooks, typecheck, tests and builds.
- Uses `scripts/ci/audit-core.mjs` to evaluate only high/critical findings whose audit path reaches a
  headless package or research workspace. Electron-only paths are reported as excluded, not silently hidden.
- Keeps job id `check` for compatibility with existing repository checks.

### Electron Reference Client CI (`.github/workflows/electron.yml`)

- Runs only for `apps/desktop/**`, the packages directly consumed by the desktop app, the workspace manifest,
  or the Electron workflow. It also supports an explicit manual dispatch for lockfile-only client updates.
- Installs with the desktop dependency closure, runs the full production audit, desktop format/lint/typecheck/test/build,
  and then the credential-free macOS RC suite.
- Owns `electron-check` and `macos-electron`; a research-only change does not wait for these jobs.

The path filters are conservative for shared packages: contracts, domain, persistence and worker changes
trigger both surfaces because Electron consumes them and the Runtime/research packages may also depend on them.
Research-only package changes do not trigger the Electron workflow.

## 4. Deliberate current limitations

Non-Electron packages currently do not define package-level lint scripts. `lint:core` runs every available
non-desktop lint hook and succeeds when none are declared; adding a dedicated core lint policy is a separate
tooling decision. The Phase 1 boundary must not pretend that absence of a lint script is lint coverage.

The root lockfile still describes the full monorepo. Core audit isolation is path-scoped, while Electron CI
continues to audit the complete production graph. A future physical split or a dedicated core lockfile is a
Phase 3 option, not a prerequisite for SV2.

## 5. Acceptance

- A research-only change runs Context Runtime CI without `macos-electron`.
- An Electron-only change runs Electron Reference Client CI and does not require core package installation.
- A high/critical advisory on an Electron-only path does not fail the core audit; the same advisory on a core
  path does fail it.
- A high/critical advisory on a core path remains visible and blocking.
- README and architecture documents call Electron a reference client/visualization shell.
- No product contract, frozen experiment, Provider authorization or raw evidence is changed.

## 6. Later phases

Phase 2 may reduce the shared dependency graph and introduce package-level core linting after evidence shows
the boundary is useful. Phase 3 may move the client to a separate repository only after release cadence,
consumer count and package publication justify the migration. Neither phase is allowed to block the current
SV2 mechanism work.
