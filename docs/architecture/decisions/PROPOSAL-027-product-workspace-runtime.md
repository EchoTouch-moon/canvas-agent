# PROPOSAL-027 — Product Workspace Runtime and Repository Selection

- **Status:** APPROVED — implementation authorized through DS-004
- **Decision owner:** Lead architect
- **Date:** 2026-08-09
- **Scope:** Product MVP v0.2

## Problem

The desktop composition root binds an optional repository exactly once at startup through `CANVAS_AGENT_REPO`. The command router receives nullable fixed services, so the application cannot safely open, close or switch a repository at runtime. One global `canvas-agent.db` also cannot safely represent multiple repository contexts.

## Decision

Introduce one Main-owned `WorkspaceRuntimeManager` with a single active runtime. It becomes the stable dependency used by workspace-aware command routes.

The manager owns this coherent tuple:

```ts
interface ActiveWorkspaceRuntime {
  readonly identity: string
  readonly repositoryPath: string
  readonly persistence: Persistence
  readonly workspace: WorkspaceService
  readonly workerHost: WorkerHost
  readonly coordinator: ExecutionCoordinator
}
```

The concrete type remains Main-internal. It is not exported through IPC.

## Lifecycle

States: `CLOSED | OPENING | READY | CLOSING | ERROR`.

- Only `READY` accepts project and execution commands.
- Open validates a canonical real path, Git worktree and `HEAD` before opening Persistence.
- Failed candidate open does not tear down an already-ready runtime.
- Switching with an active execution fails with `ACTIVE_RUN_BLOCKS_SWITCH` in v0.2. No implicit cancel.
- Close disposes the WorkerHost before closing Persistence.
- Main shutdown awaits the same close path.
- Lifecycle operations are serialized; a second open/close request receives the current transition result and cannot interleave resources.

Repository cleanliness is not a workspace lifecycle state. A dirty Git worktree may be opened so the user can inspect project state, but Renderer must surface `revision.current().workingTreePatchHash !== null` as a blocking readiness condition for initial Baseline/execution. Canvas Agent does not stash, reset, commit or discard those changes automatically.

## Path trust boundary

- `workspace.chooseRepository` takes an empty payload.
- Electron Main opens a directory picker against the requesting trusted BrowserWindow.
- Renderer never supplies a free-form absolute path to a public command.
- Main applies `realpath`, permission and Git validation.
- The public status may return a display path for the user's own selected repository, but no subsequent privileged command trusts that returned value.

## Storage

Workspace identity is `sha256(canonicalRepositoryPath)` for v0.2.

```text
userData/workspaces/<identity>/canvas-agent.db
userData/workspaces/<identity>/runtime/
```

App preference `settings-v1.json` stores schema version and last repository path only. It is parsed with Zod and written atomically. Agent launcher preferences live separately in `agent-settings-v1.json` under PROPOSAL-028B. Secrets are prohibited in both.

A moved repository is treated as a new workspace in v0.2. The previous state remains untouched. State relinking is an Enhancement requiring an explicit repository-identity design.

The pre-v0.2 global database is never deleted automatically. Migration/import is deferred until there is non-development user data; DS-004 must preserve the file and document the compatibility behavior.

## Command intent

The public schemas are added to `packages/contracts/src/command.ts` only after the lead approves the exact Zod diff.

```text
workspace.status {}
workspace.chooseRepository {}
workspace.reopenLast {}
workspace.close {}
```

Workspace status includes lifecycle, optional sanitized summary and optional typed error. Project commands issued outside `READY` receive a stable host-unavailable response, not a null dereference or inferred empty state.

## Composition changes

- `index.ts` creates the manager before registering routes.
- The command router remains registered once.
- Existing command handlers resolve the current ready dependencies at invocation time.
- Smoke and E2E helpers open a workspace through the same manager API. The environment variable may remain as an explicit test/bootstrap input, but it is no longer the normal product path.

## Rejected alternatives

1. **Renderer passes an arbitrary path:** widens the renderer-to-filesystem authority unnecessarily.
2. **Restart application to switch:** leaves the product flow environment-driven and complicates error recovery.
3. **One global project database:** risks cross-repository state mixing.
4. **Multiple active workspaces:** adds scheduling, window ownership and worker lifecycle complexity before validation.
5. **Silently cancel runs on switch:** violates explicit user control and weakens execution evidence.

## Required tests

- state transition and operation serialization tests;
- picker cancel and untrusted-sender tests;
- unreadable/non-Git/missing-HEAD tests;
- failed candidate open preserves current READY runtime;
- active run blocks switch;
- close disposes Worker before database close;
- repository identity creates distinct state/runtime roots;
- last workspace reopens after restart and invalid last path degrades to a recoverable state;
- packaged application selects and opens a temporary Git repository.

## Non-goals

- repository creation or clone;
- multiple active repositories/windows;
- workspace cloud sync;
- recent-workspace catalog UI;
- state relinking after a repository move.
