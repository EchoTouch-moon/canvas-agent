# Canvas Agent implementation baseline v0.1

**Status:** ACCEPTED for MVP foundation  
**Date:** 2026-08-06

## Problem

The product baseline fixes domain and execution semantics but intentionally leaves the desktop shape, service language, local storage and Worker process boundary open. Those choices now block implementation and cross-computer delegation.

## Decision

Use a pnpm TypeScript workspace with an Electron desktop client:

```text
React Renderer (unprivileged)
        │ typed, validated IPC
Electron Main (application boundary)
        ├─ SQLite repositories
        ├─ content-addressed local Blob store
        ├─ Git repository adapter
        └─ Utility Process worker host
                 └─ configured Agent CLI in isolated worktree
```

### Technology baseline

- Desktop: Electron + electron-vite
- UI: React 19, TypeScript, Tailwind CSS v4, shadcn/ui, Base UI, Rhea, Lucide
- Runtime validation: Zod
- Local database: SQLite through Node's built-in `node:sqlite`, mapped with Drizzle
- Blob storage: local content-addressed directory keyed by SHA-256
- Tests: Vitest for domain, contract and component tests; Playwright is added when real UI flows begin
- Package manager: pnpm workspaces

## Boundaries

### Renderer

May render state and invoke explicit application commands. It must not access Node.js, Electron IPC primitives, the filesystem, Git, SQLite, processes or credentials.

### Preload

Exposes a deliberately small `window.canvasAgent` API. It never exposes raw `ipcRenderer`, callbacks carrying Electron event objects or general-purpose filesystem/process methods.

### Main process

Validates IPC sender and payload, invokes application services and owns privileged adapters. It must not contain page-specific view logic.

### Worker host

Runs outside the renderer and main event loop. It validates schema version, hash, expiry, capability, revision and claim state before work. The first implementation supports one local Worker and one configured CLI adapter.

### Persistence

SQLite stores durable application state and append-only audit facts. WAL and foreign keys are enabled. Frozen rows are never updated. Large or repeated content is addressed by hash in the Blob store; the database stores metadata and references.

### Credentials

Agent CLI credentials remain in the user's configured CLI/OS environment. They are never copied into Snapshot, SQLite, renderer state, logs or Git.

## Core now

- domain language and legal state transitions;
- runtime-validated IPC and `ExecutionRequest` contracts;
- secure desktop process boundary;
- design tokens and representative application shell;
- SQLite/persistence and Worker task packets;
- MUSICDB fixtures only for UI validation.

## Deferred

- complete RunEvent and ToolInvocation catalogs;
- real Checkpoint recovery;
- multiple Worker scheduling;
- second Agent adapter;
- automatic relationship inference;
- vector indexing;
- complete Canvas/SavedView behavior;
- packaging, signing and auto-update.

## Validation

- `pnpm check` passes on a clean clone;
- Renderer has `sandbox`, `contextIsolation`, no Node integration and no raw IPC;
- domain tests prevent concept-collapsing transitions;
- contracts reject unknown or malformed execution fields;
- external tasks own disjoint file sets.
