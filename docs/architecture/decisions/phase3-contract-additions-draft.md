# Phase 3 contract additions — draft (for shape freeze)

- **Status:** Final shape (approved with required changes; `project.list` +
  `project.state({ projectId })` ruled; `ExecutionCoordinator` split ruled)
- **Author:** DeepSeek V4 Flash
- **Date:** 2026-08-07
- **Basis:** PROPOSAL-022 (approved with required changes, `3007368`)
- **Intended commit scope:** `packages/contracts/**` +
  `apps/desktop/src/main/{command-core,execution-coordinator,workspace-service}.ts`
  + `packages/persistence` read helpers — one green slice (every commit
  `pnpm check` green).

> This is a **draft**, not code. Implementation waits until the shape below is
> frozen.

## 1. New response schemas (`command.ts`)

These are **response-only** schemas — they must not reuse the request/input
schemas used by create/publish commands.

```ts
const edgeSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  sourceNodeId: idSchema,
  targetNodeId: idSchema,
  type: z.enum(EDGE_TYPES),
  status: z.enum(EDGE_STATUSES),
  anchoredNodeVersionId: idSchema.nullable(),
  note: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime
}).strict()

const taskTargetSchema = z.object({
  id: idSchema,
  taskSpecVersionId: idSchema,
  nodeId: idSchema.nullable(),
  nodeVersionId: idSchema.nullable(),
  position: z.number().int().nonnegative()
}).strict()

const baselineItemSchema = z.object({
  id: idSchema,
  baselineId: idSchema,
  nodeVersionId: idSchema,
  position: z.number().int().nonnegative()
}).strict()

const taskSpecAggregateSchema = z.object({
  spec: taskSpecSchema,
  targets: z.array(taskTargetSchema),
  criteria: z.array(acceptanceCriterionSchema)
}).strict()

const baselineAggregateSchema = z.object({
  baseline: baselineSchema,
  items: z.array(baselineItemSchema)
}).strict()

const projectStateViewSchema = z.object({
  project: projectSchema,           // non-nullable — project.state requires projectId
  nodes: z.array(nodeSchema),
  nodeDrafts: z.array(nodeDraftSchema),
  nodeVersions: z.array(nodeVersionSchema),
  edges: z.array(edgeSchema),
  tasks: z.array(taskSchema),
  taskSpecs: z.array(taskSpecAggregateSchema),
  baselines: z.array(baselineAggregateSchema),
  activeBaseline: baselineSchema.nullable()
}).strict()
```

Note: `activeBaseline` comes **only from persisted state** (`getActiveBaseline`),
never from a live Git read.

## 2. New request schemas

```ts
const projectListRequestSchema = z.object({}).strict()

const projectStateRequestSchema = z.object({ projectId: idSchema }).strict()

const executionDispatchRequestSchema = z.object({
  executionRequestId: idSchema,
  contextSnapshotId: idSchema
}).strict()

const executionCancelRequestSchema = z.object({
  executionRequestId: idSchema
}).strict()
```

## 3. CommandMap changes

**Add:**

```ts
'project.list':      { request: z.infer<typeof projectListRequestSchema>;      response: Project[] }
'project.state':     { request: z.infer<typeof projectStateRequestSchema>;     response: ProjectStateView }  // project required
'execution.dispatch':{ request: z.infer<typeof executionDispatchRequestSchema>; response: DispatchResult }
'execution.cancel':  { request: z.infer<typeof executionCancelRequestSchema>;   response: { cancelled: boolean } }
```

- `ProjectStateView.project` is **non-nullable** (`project.state` requires a
  `projectId`; missing → `NotFoundError`).
- **Remove** `worker.dispatch` / `worker.cancel` from the Renderer-facing
  CommandMap — the Renderer cannot construct an `ExecutionRequest`.

## 4. Where each addition lands in `command.ts`

| Item | `CommandMap` | `commandRequestSchema` | `commandResponseSchemas` | `commandSchemas` |
|---|---|---|---|---|
| `project.list` | ✅ | ✅ member | ✅ | ✅ |
| `project.state` | ✅ | ✅ member | ✅ | ✅ |
| `execution.dispatch` | ✅ | ✅ member | ✅ | ✅ |
| `execution.cancel` | ✅ | ✅ member | ✅ | ✅ |
| remove `worker.dispatch` | ❌ | ❌ | ❌ | ❌ |
| remove `worker.cancel` | ❌ | ❌ | ❌ | ❌ |

## 5. Tests (`command.test.ts`)

- `project.list` parses an empty request; response validates `Project[]`.
- `project.state` parses `{ projectId }`; response validates a full
  `ProjectStateView` (non-empty edges/taskSpecs/baselines arrays; `project` null
  is rejected).
- `execution.dispatch` parses `{ executionRequestId, contextSnapshotId }`; a
  malformed payload (missing id / extra field) is rejected.
- `execution.cancel` parses `{ executionRequestId }`.
- **`worker.dispatch` / `worker.cancel` are rejected as unknown commands** by
  `commandRequestSchema`.
- `CommandResponse` for `execution.dispatch` accepts a `DispatchResult` (`ok:true`
  with outcome `REVISION_MISMATCH` / `SUCCEEDED`).

## 6. Ripple — keeping `pnpm check` green

Removing `worker.*` from the Renderer-facing surface requires a single green
slice (contracts + Main + persistence reads together):

- `apps/desktop/src/main/command-core.ts`: drop `worker.dispatch` /
  `worker.cancel` routes; add `project.list`, `project.state` and
  `execution.dispatch` / `execution.cancel` routes.
- **`execution.dispatch` is routed to a new Main-only `ExecutionCoordinator`
  (`apps/desktop/src/main/execution-coordinator.ts`)** — not `WorkspaceService`
  (keeps WorkspaceService free of WorkerHost).
- `WorkspaceService.projectState(projectId)` composes the persistence read helpers.
- `apps/desktop/src/main/command-core.test.ts`: end-to-end uses
  `execution.dispatch({ executionRequestId, contextSnapshotId })`.
- `worker-host.test.ts` / `worker-service.test.ts`: unaffected (direct `WorkerHost`
  / `WorkerService`).
- Phase 2 smoke calls `WorkerHost` directly — unaffected.

## 7. `execution.dispatch` Main semantics (`ExecutionCoordinator`)

Fixed order — **never calls `revision.current()`**:

```text
contextSnapshotId
  → getSnapshot()
  → assert status === 'FROZEN'
  → requireTaskSpecVersion(snapshot.taskSpecVersionId)
  → requireRepositoryRevision(snapshot.expectedRepositoryRevisionId)
  → build ExecutionRequest (runId/attempt generated, requestHash computed)
  → WorkerHost.dispatch(request)
```

Repo changed after freeze → worker-runtime returns `REVISION_MISMATCH` (no silent
upgrade to the latest revision).

## 8. Deferred / kept

- `baseline.activate` **stays** in the contract (valid domain command); the
  Phase-3 UI simply does not call it (lock badge).
- Raw `worker.dispatch`/`worker.cancel` schemas may be kept as **internal**
  (not in the Renderer CommandMap) if Main/Worker tooling needs them; the
  Renderer-facing surface excludes them.
