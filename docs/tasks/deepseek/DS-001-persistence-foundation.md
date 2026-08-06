# DS-001: Build the SQLite persistence foundation

## Task owner

DeepSeek V4 Flash — no visual work.

## Task goal

Provide a tested, framework-independent SQLite persistence package for the project-fact and task-planning portion of the MVP while preserving immutable history and legal domain transitions.

## Background and context

Canvas Agent is local-first. SQLite stores application state; Git stores code truth; large/repeated content belongs in a content-addressed Blob directory. Frozen `NodeVersion`, active/frozen `ProjectBaseline`, `TaskSpecVersion` and `ContextSnapshot` content must never be overwritten.

Read first:

- `AGENTS.md`
- `docs/architecture/implementation-baseline-v0.1.md`
- `canvas_agent_design_baseline_v1.1/02_核心领域模型与业务规则.md`
- `canvas_agent_design_baseline_v1.1/03_上下文与执行架构.md` sections 1–2
- `packages/domain/src/*`
- `packages/contracts/src/*`

## Current code foundation

- Repository workspace: pnpm + strict TypeScript
- Owned package placeholder: `packages/persistence/`
- Domain states/invariants: `packages/domain/`
- Runtime contracts: `packages/contracts/`
- Database choice: Node `node:sqlite` + Drizzle ORM
- Blob key: SHA-256; actual filesystem Blob adapter is not part of this task

## Implementation scope

You may create or modify only:

- `packages/persistence/**`
- `pnpm-lock.yaml` as an automatic dependency result

Implement:

1. package manifest, strict TypeScript config, Drizzle config and migration directory;
2. database factory with `foreign_keys=ON`, WAL, busy timeout and a caller-supplied database path;
3. normalized schema for Project, Node, NodeDraft, NodeVersion, Edge, ProjectBaseline and its items, Task, TaskDraft, TaskSpecVersion, TaskTarget, AcceptanceCriterion and TaskDependency;
4. minimal ContentBlob metadata, ContextSnapshot and ContextSnapshotItem tables needed to freeze a Context Composer result;
5. repositories/commands for:
   - create Project;
   - upsert a mutable NodeDraft;
   - publish an immutable NodeVersion;
   - create an Edge with lifecycle validation;
   - create a Baseline Draft and atomically activate it while superseding the previous Active Baseline;
   - publish an immutable TaskSpecVersion with criteria;
   - freeze a ContextSnapshot atomically;
6. optimistic concurrency on mutable drafts;
7. append-only audit entries for the commands above;
8. in-memory SQLite integration tests.

Use database constraints for uniqueness/referential integrity and domain functions for semantic transitions. Repositories must accept an existing database/transaction handle; do not hide transactions in global singletons.

## Prohibited scope

- Do not modify `packages/domain`, `packages/contracts`, `apps/**`, ADRs or baseline documents.
- Do not add RunEvent, ToolInvocation, Checkpoint or complete Artifact schemas.
- Do not add PostgreSQL, Redis, queues, vector stores or remote sync.
- Do not build a generic ORM abstraction or event-sourcing framework.
- Do not store secrets or Blob bodies in the database.
- Do not silently invent new entity states, Node types or Edge types.

If a frozen contract cannot represent a required rule, stop and report the exact gap with a minimal proposed diff.

## Design constraints

- One project may have at most one ACTIVE Baseline.
- Published NodeVersion and TaskSpecVersion rows are insert-only.
- Baseline activation and prior-baseline supersession are one transaction.
- Snapshot freeze pins TaskSpecVersion, Base Baseline and RepositoryRevision.
- Edge self-links are rejected; PARENT_OF and SUPERSEDES cycles are rejected; DEPENDS_ON cycles are stored with a warning result.
- IDs and timestamps are injected or generated at the application edge so tests are deterministic.
- All SQL values are parameterized.

## Suggested implementation steps

1. Map tables and constraints in `src/schema/`.
2. Add the initial checked-in migration.
3. Create database initialization and transaction helpers.
4. Implement one command/repository at a time with integration tests.
5. Add concurrency and immutability tests.
6. Run the full repository gate.

## Acceptance criteria

1. **Given** a database with an Active Baseline, **when** a new Draft is activated, **then** the transaction leaves exactly one Active Baseline and the prior one is Superseded.
2. **Given** a published NodeVersion or TaskSpecVersion, **when** an update is attempted, **then** the write is rejected and the original content hash remains unchanged.
3. **Given** two writers using the same draft revision, **when** both save, **then** one succeeds and the stale writer receives a typed concurrency error.
4. **Given** a snapshot draft with selected items, **when** freeze succeeds, **then** the pinned task spec, baseline, repository revision, item order, hashes and token estimates can be read back unchanged.
5. **Given** an invalid self-edge or PARENT_OF cycle, **when** it is created, **then** no row is committed.
6. **Given** the migration is applied twice, **then** database setup remains deterministic and tests start from a clean schema.

## Required verification

```bash
pnpm install --frozen-lockfile
pnpm --filter @canvas-agent/persistence typecheck
pnpm --filter @canvas-agent/persistence test
pnpm check
```

Also inspect the generated migration: no destructive drop/recreate of history tables, no nullable foreign keys where the baseline says binding is mandatory.

## Output requirements

Return the standard handoff contract from `docs/tasks/README.md`, plus a table mapping each implemented table to its authoritative project term.
