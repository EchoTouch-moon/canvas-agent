# Phase 3 contract additions — draft (for shape freeze)

- **Status:** Draft — pending architecture shape freeze before implementation
- **Author:** DeepSeek V4 Flash
- **Date:** 2026-08-07
- **Basis:** PROPOSAL-022 (approved with required changes, `3007368`)
- **Intended commit scope:** `packages/contracts/src/command.ts` +
  `packages/contracts/tests/command.test.ts` (+ the minimal Main/`command-core`
  adaptation required to keep `pnpm check` green — see "Ripple").

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
  project: projectSchema.nullable(),
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
const projectStateRequestSchema = z.object({}).strict()

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
'project.state':     { request: z.infer<typeof projectStateRequestSchema>;      response: z.infer<typeof projectStateViewSchema> }
'execution.dispatch':{ request: z.infer<typeof executionDispatchRequestSchema>; response: DispatchResult }
'execution.cancel':  { request: z.infer<typeof executionCancelRequestSchema>;   response: z.infer<typeof workerCancelResultSchema> }  // { cancelled }
```

**Remove (Renderer-facing CommandMap only):**

```ts
'worker.dispatch'
'worker.cancel'
```

This closes the Renderer path to constructing an `ExecutionRequest`; `execution.*`
is the only Renderer-facing Worker coordination surface.

## 4. Where each addition lands in `command.ts`

| Item | `CommandMap` | `commandRequestSchema` | `commandResponseSchemas` | `commandSchemas` |
|---|---|---|---|---|
| `project.state` | ✅ | ✅ member | ✅ | ✅ |
| `execution.dispatch` | ✅ | ✅ member | ✅ | ✅ |
| `execution.cancel` | ✅ | ✅ member | ✅ | ✅ |
| remove `worker.dispatch` | ❌ | ❌ | ❌ | ❌ |
| remove `worker.cancel` | ❌ | ❌ | ❌ | ❌ |

## 5. Tests (`command.test.ts`)

- `project.state` parses an empty request; response validates a full
  `ProjectStateView` (project null and project-present variants; non-empty
  edges/taskSpecs/baselines arrays).
- `execution.dispatch` parses `{ executionRequestId, contextSnapshotId }`; a
  malformed payload (missing id / extra field) is rejected.
- `execution.cancel` parses `{ executionRequestId }`.
- **`worker.dispatch` / `worker.cancel` are rejected as unknown commands** by
  `commandRequestSchema`.
- `CommandResponse` for `execution.dispatch` accepts a `DispatchResult` (`ok:true`
  with outcome `REVISION_MISMATCH` / `SUCCEEDED`).

## 6. Ripple — keeping `pnpm check` green

Removing `worker.*` from the Renderer-facing surface breaks references that must
be adapted in the **same commit** (contracts + minimal Main), otherwise the repo
is red:

- `apps/desktop/src/main/command-core.ts`: drop `worker.dispatch` /
  `worker.cancel` routes; add `execution.dispatch` / `execution.cancel` routes.
  `execution.dispatch` calls a new `WorkspaceService.executionDispatch(payload)`
  that **builds the ExecutionRequest from the frozen snapshot** (see §7).
- `apps/desktop/src/main/command-core.test.ts` end-to-end: replace
  `worker.dispatch(workerRequest(...))` with
  `execution.dispatch({ executionRequestId, contextSnapshotId })`; the
  `execution.cancel` route replaces the old `worker.cancel`.
- `worker-host.test.ts` / `worker-service.test.ts`: unaffected (they exercise
  `WorkerHost`/`WorkerService` directly, not the Renderer CommandMap).
- Phase 2 smoke calls `WorkerHost` directly — unaffected.

If the Main implementation (§7) is not in this commit, then either
(a) sequence it as an immediately-following commit, or (b) land the contract
change together with the `WorkspaceService.executionDispatch` + routes so the repo
stays green at every commit.

## 7. `execution.dispatch` Main semantics (for the Main packet)

Fixed order — **never calls `revision.current()`**:

```text
contextSnapshotId
  → getSnapshot()
  → assert status === 'FROZEN'
  → load TaskSpecVersion (from snapshot.taskSpecVersionId)
  → load snapshot.expectedRepositoryRevisionId → requireRepositoryRevision()
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
