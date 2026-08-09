# DS-006 → UI-003 interface handoff

DS-006 owns all lifecycle, onboarding and command logic. UI-003 may change hierarchy, spacing,
responsive composition and product copy without moving commands into visual components.

## Stable state surface

`useWorkspaceRuntime()` exposes product-level state and callbacks. Workspace phases are:

| Phase                                | Meaning                              | Project data                             |
| ------------------------------------ | ------------------------------------ | ---------------------------------------- |
| `BOOTING`                            | resolving the typed bridge status    | hidden                                   |
| `NO_WORKSPACE`                       | no active repository                 | empty                                    |
| `CHOOSING` / `OPENING` / `REOPENING` | lifecycle operation in progress      | retained but commands paused             |
| `READY`                              | Project and Run commands available   | live                                     |
| `SWITCH_BLOCKED`                     | active Run prevented a switch        | prior READY data retained                |
| `INVALID` / `UNAVAILABLE`            | typed open failure or bridge failure | retry/choose only                        |
| `CLOSING`                            | close in progress                    | retained until close succeeds            |
| `READ_ONLY`                          | dirty repository overlay             | inspection available; execution disabled |

Agent phases are `CHECKING`, `READY`, `NOT_FOUND`, `UNSUPPORTED_VERSION`, `AUTH_REQUIRED`,
`INTERPRETER_MISSING` and `ERROR`.

The resumable setup selector returns `NO_PROJECT`, `PROJECT_NEEDS_CHARTER`,
`PROJECT_NEEDS_BASELINE_DRAFT`, `BASELINE_DRAFT_REVIEW`, `READY_FOR_TASK`,
`TASK_DRAFT_NEEDS_SPEC`, `TASK_READY` or `REPOSITORY_DIRTY_BLOCKED`.

## Stable callbacks and disabled rules

- Workspace: `chooseRepository`, `reopenLast`, `closeWorkspace`, `refresh`, `dismissError`.
- Agent: `chooseAgentExecutable`, `clearAgentExecutable`.
- Setup props: `onAdvance`, `onActivateBaseline`, `repositoryDirty`; activation is always a
  separate action.
- Task props: `onAdvance`, `repositoryDirty`; Task creation and TaskSpec publication remain
  separate durable calls.
- `workspaceActionsDisabled` prevents repeated lifecycle operations.
- `projectCommandsDisabled` pauses Project/Run calls outside a coherent workspace.
- Run preparation additionally requires Agent READY, a clean RepositoryRevision, an ACTIVE
  Baseline and a published TaskSpec. Dispatch additionally requires a FROZEN Snapshot.

## Component map

- `product-onboarding.tsx`: composition/container and lifecycle shell.
- `project-setup-flow.tsx`: neutral Project/charter/DRAFT Baseline/activation form.
- `task-setup-flow.tsx`: neutral Task/TaskSpec form.
- `live-workspace-view.tsx`: existing execution, acceptance and adoption surface; DS-006 added only
  an `executionAvailable` seam.
- Reuse `components/ui/{button,input,badge,separator}` and existing app/domain components.

Partial failures always rehydrate durable facts. A lost response after any of `project.create`,
`node.create`, `nodeVersion.publish`, `baseline.createDraft`, `task.create` or `taskSpec.publish`
resumes at the next missing fact and must not add compensating deletes or duplicates.

## UI-003 editable files

UI-003 may edit the three app components above, the narrow presentation portions of
`live-workspace-view.tsx`, `App.tsx`, and Renderer visual CSS/theme files named by its packet. It
must not edit hooks, reducers, `lib/product-onboarding.ts`, Contracts, Preload, Main, persistence or
Worker code.

Visual QA state fixtures must inject the exported component props or typed fake clients in tests;
production `App` never imports fake business state. The production build removes the development
Fixture chooser unless `DEV` and `VITE_CANVAS_AGENT_ENABLE_FIXTURE=true` are both true.
