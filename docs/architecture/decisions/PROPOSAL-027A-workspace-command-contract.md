# PROPOSAL-027A — Workspace command contract addendum

- **Status:** APPROVED — exact public shape frozen for DS-004
- **Decision owner:** Lead architect
- **Date:** 2026-08-09
- **Parent:** `PROPOSAL-027-product-workspace-runtime.md`

## Purpose

Freeze the path-free Renderer/Main contract for opening one local repository and observing runtime lifecycle without exposing Electron dialog or filesystem APIs through Preload.

## Schemas

Add these runtime schemas to `packages/contracts/src/command.ts` following existing naming/export conventions:

```ts
const workspaceLifecycleSchema = z.enum(['CLOSED', 'OPENING', 'READY', 'CLOSING', 'ERROR'])

const workspaceErrorReasonSchema = z.enum([
  'PATH_UNREADABLE',
  'NOT_GIT_WORKTREE',
  'MISSING_HEAD',
  'RUNTIME_NOT_WRITABLE',
  'SETTINGS_INVALID',
  'DATABASE_OPEN_FAILED',
  'WORKER_DISPOSE_FAILED',
  'ACTIVE_RUN_BLOCKS_SWITCH',
  'OPERATION_IN_PROGRESS',
  'PICKER_FAILED',
  'UNKNOWN'
])

const workspaceSummarySchema = z
  .object({
    identity: contentHashSchema,
    repositoryName: z.string().min(1),
    displayPath: z.string().min(1)
  })
  .strict()

const workspaceOperationErrorSchema = z
  .object({
    reasonCode: workspaceErrorReasonSchema,
    message: z.string().min(1),
    recoverable: z.boolean()
  })
  .strict()

const workspaceRuntimeStatusSchema = z
  .object({
    state: workspaceLifecycleSchema,
    activeWorkspace: workspaceSummarySchema.nullable(),
    lastError: workspaceOperationErrorSchema.nullable()
  })
  .strict()

const workspaceChooseResultSchema = z
  .object({
    cancelled: z.boolean(),
    status: workspaceRuntimeStatusSchema
  })
  .strict()
```

Export inferred `WorkspaceLifecycle`, `WorkspaceErrorReason`, `WorkspaceSummary`, `WorkspaceOperationError` and `WorkspaceRuntimeStatus` types where Renderer needs them.

## CommandMap additions

```ts
'workspace.status': {
  request: {}
  response: WorkspaceRuntimeStatus
}
'workspace.chooseRepository': {
  request: {}
  response: { cancelled: boolean; status: WorkspaceRuntimeStatus }
}
'workspace.reopenLast': {
  request: {}
  response: WorkspaceRuntimeStatus
}
'workspace.close': {
  request: {}
  response: WorkspaceRuntimeStatus
}
```

All four requests use the existing strict empty-object schema. They are registered in request union, response map and route registry. Preload continues to expose only `canvasAgent.command(request)`; no `showOpenDialog`, path or filesystem method is added to `CanvasAgentDesktopApi`.

## Semantics

- Initial fresh state: `{ state: "CLOSED", activeWorkspace: null, lastError: null }`.
- Picker cancel: `cancelled: true`; status is byte-for-byte equivalent to the prior stable state and no new `lastError` is introduced.
- Successful open: READY with summary and null error.
- Failed initial open: ERROR, no active workspace, typed `lastError`.
- Failed candidate switch while a workspace was READY: READY with the original active summary and typed `lastError` describing the failed candidate operation.
- During OPENING/CLOSING, workspace-aware project/execution commands return the existing `HostUnavailableError` envelope.
- A successful status-changing operation clears prior `lastError`.
- `displayPath` is output-only. No later privileged command consumes it.

## Settings schema

Main-internal `settings-v1.json`:

```ts
z.object({
  schemaVersion: z.literal(1),
  lastRepositoryPath: z.string().min(1).nullable()
}).strict()
```

An invalid file is preserved or quarantined for diagnosis, returns `SETTINGS_INVALID`, and does not trigger an arbitrary open.

## Required contract tests

- all four strict empty payloads accept `{}` and reject path/extra keys;
- response correlation for all commands;
- every lifecycle/reason enum round trip;
- READY may retain active workspace plus a failed-switch `lastError`;
- ERROR cannot be emitted with a READY replacement candidate;
- picker cancellation response shape;
- Preload API surface has no additional method.

## Non-goals

- filesystem path input;
- recent-workspace arrays;
- dirty/clean revision state in this lifecycle contract (Renderer derives it from `revision.current` after READY);
- Agent readiness (PROPOSAL-028B).
