# `@canvas-agent/persistence`

SQLite persistence foundation for Canvas Agent. **Owned by DeepSeek V4 Flash / DS-001.**

## Stack

- Node `node:sqlite` (`DatabaseSync`) with WAL, `foreign_keys=ON` and a busy timeout.
- Drizzle ORM `1.0.0-rc.4` (`drizzle-orm/node-sqlite`) for schema declaration, query
  building and migration generation via `drizzle-kit`. Stable Drizzle does not ship a
  `node:sqlite` driver; the `rc` line is Drizzle's official path for `node:sqlite`.
- Vitest integration tests against in-memory databases.

## Usage

```ts
import { openDatabase, applyMigrations, createProject } from '@canvas-agent/persistence'

const persistence = openDatabase({ path: '/path/to/canvas-agent.db' })
applyMigrations(persistence) // creates schema + immutability guards

const project = createProject(persistence, { id: 'proj_1', name: 'Canvas Agent' })
```

Repositories accept an existing `Persistence` handle (database + injected clock/id
services). Atomic commands run inside `BEGIN IMMEDIATE ... COMMIT` transactions;
nothing hides transactions in a global singleton.

## What is implemented

- Database factory: `openDatabase`, `applyMigrations`, `closeDatabase`, `withTransaction`.
- Normalized schema for Project, Node/NodeDraft/NodeVersion, Edge, ProjectBaseline +
  items, Task/TaskDraft/TaskSpecVersion/TaskTarget/AcceptanceCriterion/TaskDependency,
  ContentBlob metadata, ContextSnapshot + items, RepositoryRevision, and append-only
  AuditLog.
- Commands: create Project; upsert NodeDraft / TaskDraft with optimistic concurrency;
  publish immutable NodeVersion / TaskSpecVersion (with criteria and targets); create
  Edge with self-link, PARENT_OF/SUPERSEDES cycle rejection and DEPENDS_ON cycle
  warning; create Baseline Draft and atomically activate it while superseding the
  prior ACTIVE baseline; freeze a ContextSnapshot atomically.
- Database-level guards (installed idempotently by `applyMigrations`): one ACTIVE
  baseline per project, immutable NodeVersion / TaskSpecVersion rows, immutable frozen
  snapshots and their items, append-only audit log.

## Migrations

Schema lives in `src/schema/` and is the single source for `drizzle.config.ts`.
Regenerate a migration with:

```bash
pnpm --filter @canvas-agent/persistence exec drizzle-kit generate --name=change
```

## Verification

```bash
pnpm --filter @canvas-agent/persistence typecheck
pnpm --filter @canvas-agent/persistence test
pnpm check
```
