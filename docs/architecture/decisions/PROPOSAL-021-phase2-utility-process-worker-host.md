# PROPOSAL-021: Phase 2 — UtilityProcess worker host

- **Status:** Proposed (draft for architecture review)
- **Drafted by:** DeepSeek V4 Flash
- **Owner (implementation):** lead architect
- **Date:** 2026-08-07
- **Depends on:** PROPOSAL-019/020 (Phase 0/1, merged through `9b9a94c`),
  ADR-018 (separate Utility Process worker host)

## Context

Phase 1 closed the renderer↔main domain boundary: `canvas-agent:command` validates
requests/responses, the WorkspaceService persists to SQLite, and `worker.dispatch` /
`worker.cancel` return `HostUnavailableError` via `UnavailableWorkerHost`. The only
remaining worker-path gap is the approved process boundary: the Worker must run in
an **Electron Utility Process**, never in Electron Main (ADR-018).

`@canvas-agent/worker-runtime` stays Electron-free; the Electron-specific host lives
in the desktop package.

## Goal

Replace `UnavailableWorkerHost` with a `UtilityProcessWorkerHost` that:

1. forks an Electron Utility Process running `@canvas-agent/worker-runtime`
   `createWorker`;
2. relays `worker.dispatch` / `worker.cancel` over a narrow, validated
   `MessagePortMain` protocol, correlated by `executionRequestId`;
3. owns the process lifecycle (lazy fork, crash handling, dispose);
4. preserves per-execution cancellation and single-claim semantics.

## Non-goals (this proposal)

- Real Agent adapter (later phase; Phase 2 keeps the deterministic fixture adapter
  in the Utility Process to prove the boundary end-to-end).
- Multiple workers, queues, leases, checkpoint recovery, approval flows.
- Changes to the renderer (Phase 3).

## Topology

```text
Renderer
   └ canvas-agent:command → CommandRouter → worker.dispatch
                                             │
                                ┌────────────▼─────────────┐
                                │ UtilityProcessWorkerHost │   Electron Main
                                └────────────┬─────────────┘
                                             │ fork + MessagePortMain
                                             ▼
                                ┌──────────────────────────┐
                                │ Utility Process          │
                                │   src/worker/index.ts    │
                                │   └ WorkerService        │
                                │       └ createWorker()   │  @canvas-agent/worker-runtime
                                │           isolated worktree / artifacts / recovery
                                └──────────────────────────┘
```

## Protocol (`apps/desktop/src/worker/protocol.ts`)

Internal main↔worker-process protocol, validated with Zod (no unchecked casts).

```ts
// main → worker
type WorkerHostRequest =
  | { type: 'init'; sourceRepositoryPath: string; runtimeDirectory: string }
  | { type: 'dispatch'; executionRequestId: string; request: ExecutionRequestContract }
  | { type: 'cancel'; executionRequestId: string }
  | { type: 'dispose' }

// worker → main
type WorkerHostResponse =
  | { type: 'dispatch:result'; executionRequestId: string; result: DispatchResult }
  | { type: 'cancel:result'; executionRequestId: string; cancelled: boolean }
  | { type: 'error'; executionRequestId: string | null; message: string }
  | { type: 'dispose:ack' }
```

- `init` carries `AppConfig` values (the renderer can never supply paths).
- Responses are correlated by `executionRequestId`; the host keeps a
  `Map<executionRequestId, resolve/reject>`.
- Validation: each frame passes its Zod schema in both directions (in-process
  boundary, but treated like the IPC boundary).

## Worker side (`src/worker/`)

### `worker-service.ts` (pure, testable — no electron import)

```ts
interface WorkerTransport {
  send(response: WorkerHostResponse): void
}

class WorkerService {
  constructor(
    private readonly appConfig: AppConfig,
    private readonly transport: WorkerTransport
  )
  // owns ONE createWorker instance (shared claim store) + per-execution
  // AbortController map:
  //   Map<executionRequestId, AbortController>
  onRequest(request: WorkerHostRequest): Promise<void>
}
```

- `init` builds `createWorker({ runtimeDirectory, sourceRepositoryPath,
  capabilities: ['git','node'], commandAllowlist: ['git','node'],
  verificationCommands: [], agent: FixtureAgentAdapter(...) })`.
- `dispatch`: create a per-execution `AbortController`, `worker.dispatch({ request,
  signal })`, reply `dispatch:result` on settle, delete the controller.
- `cancel(id)`: abort the per-execution controller → the in-flight dispatch
  resolves `CANCELLED`; reply `cancel:result { cancelled: true }` (false if no
  active execution).
- `dispose`: `worker.cancel()` + reply `dispose:ack`.
- Errors → `{ type: 'error', message }` (mapped by the host to `CommandError`).

### `index.ts` (electron entry)

```ts
import { parentPort } from 'node:worker_threads'   // or process.parentPort (electron)
```

Wires the Electron Utility Process `MessagePortMain`/`parentPort` to `WorkerService`
and starts the transport. This is the only Electron-dependent file.

## Main side (`src/main/utility-process-worker-host.ts`)

Implements `WorkerHost`:

```ts
class UtilityProcessWorkerHost implements WorkerHost {
  private child: UtilityProcess | null
  private pending: Map<string, { resolve; reject }>
  private port: MessagePortMain | null

  ensureStarted(): void        // lazy fork of out/main/worker.js + init handshake
  async dispatch(request): Promise<DispatchResult>
  async cancel(id): Promise<boolean>
  async dispose(): Promise<void>
}
```

- Lazy fork on first `dispatch`; sends `init` with `AppConfig`.
- `dispatch`/`cancel` write a pending entry and `postMessage`; timeout/error paths
  reject with `HostUnavailableError` / `InternalError`.
- On child `exit` while requests are pending: reject all pending with
  `HostUnavailableError`; mark host unavailable for a new dispatch until restarted.
- `dispose`: send `dispose`, close the port, `child.kill()`.

## Build change (`electron.vite.config.ts`)

The main build gains a second entry so the Utility Process has a bundled entry that
also inlines the workspace packages:

```ts
main: {
  build: {
    rollupOptions: {
      input: { index: 'src/main/index.ts', worker: 'src/worker/index.ts' }
    },
    externalizeDeps: { exclude: [...@canvas-agent/...] }
  }
}
```

`UtilityProcessWorkerHost` forks `join(__dirname, 'worker.js')`.

`index.ts` swaps `UnavailableWorkerHost` → `UtilityProcessWorkerHost`; the
UnavailableWorkerHost stays only as a test/dev fallback and in `testing/`.

## Security invariants (unchanged)

- Worker never touches the app database (worker-runtime invariant).
- Paths come only from `AppConfig` (`init`); renderer never supplies paths.
- Protocol frames are Zod-validated at both ends.
- `worker-runtime` remains Electron-free; Electron only exists in the host + entry.

## Tests

- `protocol.test.ts`: request/response schemas accept valid frames, reject bad ones.
- `worker-service.test.ts`: drive `WorkerService` with a fake transport + temp git
  repo; assert `dispatch → SUCCEEDED`, `cancel(id)` aborts that execution,
  `cancel` of an unknown id returns `false`, `dispose` acks.
- `utility-process-worker-host` behavior is covered by a **manual runtime smoke**
  (`electron .` with `CANVAS_AGENT_REPO`): run `worker.dispatch` through the router
  and observe `SUCCEEDED` while the Utility Process runs it.
- Existing `InProcessWorkerHost` tests stay as the fast in-process path.

## Ownership & files

| File | Owner |
|---|---|
| `apps/desktop/src/worker/protocol.ts` | architect (drafted here) |
| `apps/desktop/src/worker/worker-service.ts` | architect |
| `apps/desktop/src/worker/index.ts` | architect |
| `apps/desktop/src/main/utility-process-worker-host.ts` | architect |
| `apps/desktop/electron.vite.config.ts` | architect |
| `apps/desktop/src/main/index.ts` (swap host) | architect |
| tests above | architect |
| `packages/worker-runtime` | unchanged |

## Open questions

1. **Lazy fork on first dispatch** (proposed) vs eager fork at app boot?
2. **Adapter in the Utility Process**: keep `FixtureAgentAdapter` for Phase 2
   (proposed) so the boundary is proven deterministically before a real Agent
   adapter is chosen?
3. **Protocol location**: internal `apps/desktop/src/worker/protocol.ts`
   (proposed) vs publishing the schemas in `@canvas-agent/contracts`?
4. **Worker process crash mid-dispatch**: return `HostUnavailableError`
   (proposed, no auto-restart) vs attempt one restart per request?

## Handoff

On approval: implement the host + entry + protocol + tests, swap the production
host, run the manual Utility-Process smoke, then update the Phase 1 delivery record
to Phase 2. Real Agent adapter, multi-worker and event protocols remain separate
later phases.
