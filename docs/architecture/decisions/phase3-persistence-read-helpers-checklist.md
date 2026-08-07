# Persistence read-query helpers — implementation checklist

- **Status:** Checklist (implementation deferred until the Phase 3 contract shape
  freezes)
- **Owner:** DeepSeek V4 Flash (`packages/persistence/**`)
- **Basis:** PROPOSAL-022 (approved with required changes, `3007368`)

## Principle

Persistence provides **composable, project-scoped pure reads**. It does not build
a UI projection; `WorkspaceService.projectState()` composes these primitives into
`ProjectStateView` (an application read model).

```text
Persistence primitive reads
        ↓
WorkspaceService aggregation  →  ProjectStateView
        ↓
project.state (IPC)
```

## Checklist (by module)

| # | Function | Signature | Queries | Status |
|---|---|---|---|---|
| 1 | `listProjects` | `(p: Persistence) => ProjectRow[]` | `project` all | **new** |
| 2 | `listNodes` | `(p, projectId) => NodeRow[]` | `node` where project | **new** |
| 3 | `listNodeDrafts` | `(p, projectId) => NodeDraftRow[]` | `node_draft` join `node` by project | **new** |
| 4 | `listNodeVersions` | `(p, projectId) => NodeVersionRow[]` | `node_version` join `node` by project, order by sequence | **new** |
| 5 | `listEdges` | `(p, projectId) => EdgeRow[]` | `edge` where project | **new** |
| 6 | `listTasks` | `(p, projectId) => TaskRow[]` | `task` where project | **new** |
| 7 | `listTaskSpecVersions` | `(p, taskId) => TaskSpecVersionRow[]` | `task_spec_version` where task, order by sequence | **new** |
| 8 | `listTaskTargets` | `(p, taskSpecVersionId) => TaskTargetRow[]` | `task_target` where spec, order by position | **new** |
| 9 | `listCriteria` | `(p, taskSpecVersionId) => AcceptanceCriterionRow[]` | `acceptance_criterion` where spec | ✅ exists (`commands/task.ts`) |
| 10 | `listBaselines` | `(p, projectId) => ProjectBaselineRow[]` | `project_baseline` where project | **new** |
| 11 | `listBaselineItems` | `(p, baselineId) => BaselineItemRow[]` | `baseline_item` where baseline, order by position | ✅ exists (`commands/baseline.ts`) |
| 12 | `getActiveBaseline` | `(p, projectId) => ProjectBaselineRow \| undefined` | `project_baseline` where project + status ACTIVE | ✅ exists |

## Placement

- **Reuse** existing `listCriteria`, `listBaselineItems`, `getActiveBaseline`
  where they already live (`src/commands/task.ts`, `src/commands/baseline.ts`).
- **Add** the remaining `list*`/`get*` functions in the owning command module
  (`node.ts`, `edge.ts`, `task.ts`, `baseline.ts`, `project.ts`), each returning
  schema rows and using `orderBy` where ordering matters.
- **Aggregate** in `WorkspaceService.projectState()` (desktop main) — not in
  persistence — into `ProjectStateView` (project nullable, arrays, activeBaseline).

## Determinism & conventions

- All reads are read-only: no Git reads, no writes, no `revision.current`
  side effects inside a read helper.
- Return empty arrays (not `undefined`) for empty collections.
- Order: `nodes` by `createdAt`, `nodeVersions` by `sequence`, `taskSpecs` by
  `sequence`, `criteria`/`targets`/`baselineItems` by `position`, `baselines` by
  `createdAt`.
- Add unit tests per helper in `packages/persistence/tests/` (in-memory SQLite),
  asserting ordering and project scoping (items from another project are excluded).

## Tests

- `project.test.ts` (or a new `reads.test.ts`): seed two projects; assert every
  `list*` is scoped to the requested project and returns empty arrays for a
  project with no rows.
- Ordering assertions for `listNodeVersions` / `listCriteria` / `listBaselineItems`.

## Dependency

Implement **after** the Phase 3 contract shape freezes (the `ProjectStateView`
field names must match the frozen `contracts` response schema). No persistence
code is written before the contract commit.
