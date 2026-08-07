# PROPOSAL-021: Phase 2 — UtilityProcess worker host

- **Status:** Approved with required changes (architecture review 2026-08-07)
- **Drafted by:** DeepSeek V4 Flash
- **Owner (implementation):** lead architect (delegated: DeepSeek on request)
- **Date:** 2026-08-07
- **Depends on:** PROPOSAL-019/020 (Phase 0/1, merged through `9b9a94c`),
  ADR-018 (separate Utility Process worker host)

## Review verdict

PROPOSAL-021 is **approved with required changes**. The four open questions are
ruled:

| # | Question | Ruling |
|---|---|---|
| 1 | Lazy fork | **Lazy, single-flight** (started on first dispatch, guarded by `startPromise`) |
| 2 | Adapter | **FixtureAgentAdapter** stays for Phase 2, but the runtime smoke must produce **real patch/verification evidence**, not a no-op |
| 3 | Protocol location | **`apps/desktop/src/worker/protocol.ts`** (internal Electron shell detail, not `@canvas-agent/contracts`) |
| 4 | Crash policy | **No automatic retry/replay** of a failed request; a fresh Utility Process may be lazily started for the **next independent dispatch** |

Required changes before implementation (no further proposal needed):

1. **Transport correlation uses `messageId`; `executionRequestId` is the domain
   execution identity.** Main keeps `pending: Map<messageId, PendingRequest>`; the
   worker keeps `executions: Map<executionRequestId, { controller, completion }>`.
2. Add **`init:ack`**; `ensureStarted(): Promise<void>` becomes a single-flight
   state machine (`STOPPED → STARTING → READY → DISPOSING`) with `startPromise`.
3. **`dispose` aborts all per-execution controllers, waits for active executions
   to drain, then acks**; the main side waits for `dispose:ack` with a timeout,
   then kills the process.
4. **Crash**: current request → `HostUnavailableError` (never replayed). The host
   returns to a restartable state for the next independent dispatch.
5. **Claim boundary documented**: the worker claim store is process-local; the host
   guarantees no automatic replay of an `executionRequestId` across Utility Process
   restarts. A retry must be a **new `ExecutionRequest`** (new id /
   `workerAttemptNumber`). Durable cross-app-restart claims remain future work.
6. **Fixed transport**: Electron Utility Process parent channel only
   (`child.postMessage` / `process.parentPort`). **No `node:worker_threads`
   `parentPort` fallback.**
7. **`apps/desktop/tsconfig.node.json` includes `src/worker/**/*`.**
8. **Main-side host lifecycle tests** with an injected process/transport factory
   (lazy-once, init handshake, dispatch correlation, **dispatch + concurrent
   cancel**, child exit → all pending rejected, dispose timeout, next dispatch
   after crash starts a new generation, same request never auto-replayed).
9. Protocol frames carry **`protocolVersion: 1`**; error frames carry
   `messageId` + `executionRequestId` + `code`; `cancel:result.cancelled: true`
   means **the cancellation signal was delivered to an active execution**, not that
   the execution has terminated (terminal state is the later
   `dispatch:result.outcome === 'CANCELLED'`).

## Context

Phase 1 closed the renderer↔main domain boundary and left the only worker-path gap:
the Worker must run in an Electron **Utility Process**, never in Electron Main
(ADR-018). `@canvas-agent/worker-runtime` stays Electron-free.

## Goal

Replace `UnavailableWorkerHost` with a `UtilityProcessWorkerHost` that:

1. lazily forks (single-flight) an Electron Utility Process running
   `@canvas-agent/worker-runtime` `createWorker`;
2. relays `worker.dispatch` / `worker.cancel` over a validated
   `MessagePortMain`-free parent-channel protocol, correlated by `messageId`;
3. owns process lifecycle (state machine, crash → reject → restartable, dispose
   with drain);
4. preserves per-execution cancellation, single-claim within a process lifetime,
   and no cross-restart replay.

## Topology

```text
Renderer
   └ canvas-agent:command → CommandRouter → worker.dispatch
                                             │
                                ┌────────────▼─────────────┐
                                │ UtilityProcessWorkerHost │   Electron Main
                                │  (state machine)         │
                                └────────────┬─────────────┘
                                             │ fork + parent channel
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

Fixed transport: Electron Utility Process parent channel (`process.parentPort` in
the child; `child.postMessage` in main). Every frame is Zod-validated and carries
`protocolVersion: 1`.

```ts
type WorkerHostRequest =
  | { protocolVersion: 1; type: 'init'; sourceRepositoryPath: string; runtimeDirectory: string }
  | { protocolVersion: 1; type: 'dispatch'; messageId: string; executionRequestId: string; request: ExecutionRequestContract }
  | { protocolVersion: 1; type: 'cancel'; messageId: string; executionRequestId: string }
  | { protocolVersion: 1; type: 'dispose' }

type WorkerHostResponse =
  | { protocolVersion: 1; type: 'init:ack' }
  | { protocolVersion: 1; type: 'dispatch:result'; messageId: string; executionRequestId: string; result: DispatchResult }
  | { protocolVersion: 1; type: 'cancel:result'; messageId: string; executionRequestId: string; cancelled: boolean }
  | { protocolVersion: 1; type: 'error'; messageId: string; executionRequestId: string | null; code: 'NOT_INITIALIZED' | 'INVALID_FRAME' | 'SERVICE_FAILURE'; message: string }
  | { protocolVersion: 1; type: 'dispose:ack' }
```

Identity split:

- **`messageId`** = transport RPC identity (main `pending` map key).
- **`executionRequestId`** = domain execution identity (worker `executions` map
  key, AbortController per execution). They are never the same key.

`cancel:result.cancelled: true` = the cancellation signal was delivered to an
active execution (acknowledgment). The execution's terminal state is the later
`dispatch:result.outcome === 'CANCELLED'`.

## Worker side (`src/worker/`)

### `worker-service.ts` (pure, testable — no electron import)

```ts
interface WorkerTransport {
  send(response: WorkerHostResponse): void
}

class WorkerService {
  constructor(private readonly transport: WorkerTransport)
  // ONE createWorker for the process lifetime (shared claim store).
  // executions: Map<executionRequestId, { controller: AbortController; completion: Promise<void> }>
  onRequest(request: WorkerHostRequest): Promise<void>
}
```

- `init` → build `createWorker({ runtimeDirectory, sourceRepositoryPath,
  capabilities: ['git','node'], commandAllowlist: ['git','node'],
  verificationCommands: [...], agent: FixtureAgentAdapter({ steps: [...] }) })`;
  reply `init:ack`.
- `dispatch` → create per-exec `AbortController` + `completion` promise; call
  `worker.dispatch({ request, signal: controller.signal })`; on settle reply
  `dispatch:result` and delete the execution entry.
- `cancel(id)` → abort the per-exec controller; reply `cancel:result
  { cancelled: true }` if an active execution exists, else `{ cancelled: false }`.
- `dispose` → stop accepting `dispatch`; abort all per-exec controllers; `await
  Promise.allSettled(completions)`; reply `dispose:ack`. **It does not call
  `worker.cancel()`** (that only aborts `createWorker`'s internal controller and
  would not affect executions driven by external signals).
- `error` → `{ type: 'error', messageId, executionRequestId, code, message }`.

### `index.ts` (electron entry)

Wires `process.parentPort` messages to `WorkerService` and sends responses back.
The only Electron-dependent file.

## Main side (`src/main/utility-process-worker-host.ts`)

Implements `WorkerHost`:

```ts
type WorkerHostState = 'STOPPED' | 'STARTING' | 'READY' | 'DISPOSING'

class UtilityProcessWorkerHost implements WorkerHost {
  private state: WorkerHostState = 'STOPPED'
  private startPromise: Promise<void> | null = null
  private child: UtilityProcess | null = null
  private pending: Map<string, PendingRequest>   // key: messageId
  private submittedExecutionIds = new Set<string>()  // no cross-restart replay
  private messageCounter = 0

  constructor(
    private readonly appConfig: AppConfig,
    private readonly processFactory: (entry: string) => UtilityProcessLike = defaultFork
  )
  ensureStarted(): Promise<void>   // single-flight; init handshake awaits init:ack
  async dispatch(request): Promise<DispatchResult>
  async cancel(id): Promise<boolean>
  async dispose(): Promise<void>
}
```

- **`ensureStarted()`**: if `STARTING`, await `startPromise`; if `READY`, return;
  else fork + wire transport + send `init` and await `init:ack` (with a timeout).
  `processFactory` is injectable for host-lifecycle tests.
- **`dispatch`**: `await ensureStarted()`; generate `messageId`; register pending;
  record `executionRequestId` in `submittedExecutionIds`; `child.postMessage(frame)`.
- **`cancel(id)`**: `await ensureStarted()`; send cancel with a new `messageId`;
  resolve with `{ cancelled }` from `cancel:result`.
- **Child exit** while pending: reject every pending request with
  `HostUnavailableError`; set state `STOPPED` (restartable). The failed
  `executionRequestId` stays in `submittedExecutionIds`, so it can never be
  auto-replayed by the host — a retry must be a new `ExecutionRequest`.
- **`dispose()`**: set `DISPOSING`; send `dispose`; wait `dispose:ack` with a
  timeout; then `child.kill()` and close.

## Claim semantics (documented boundary)

`createWorker`'s claim store is an in-memory `Set` per process. Within one Utility
Process lifetime, single-claim holds (one shared store). Across a crash, a fresh
process has a fresh store; the **host-level `submittedExecutionIds`** prevents
automatic replay of the same id, but durable cross-app-restart claim semantics
remain future orchestration work.

## Build & config changes

- `electron.vite.config.ts` main build adds a second entry:
  `input: { index: 'src/main/index.ts', worker: 'src/worker/index.ts' }`; the
  worker entry keeps the same `externalizeDeps.exclude` for `@canvas-agent/*`.
- `apps/desktop/tsconfig.node.json` includes `"src/worker/**/*"`.
- `index.ts` swaps `UnavailableWorkerHost` → `UtilityProcessWorkerHost`
  (`UnavailableWorkerHost` remains only in `testing/`).

## Security invariants (unchanged)

- Worker never touches the app database (worker-runtime invariant).
- Paths come only from `AppConfig` (`init`); renderer never supplies paths.
- Protocol frames Zod-validated at both ends; `protocolVersion: 1`.
- `worker-runtime` remains Electron-free.

## Tests

- `protocol.test.ts`: frame schemas accept valid frames, reject bad ones; identity
  split (`messageId` ≠ `executionRequestId`) is type-enforced.
- `worker-service.test.ts`: fake transport + temp git repo; assert `dispatch →
  SUCCEEDED` with a real patch (fixture writes a file, verification runs),
  `dispatch + cancel` on the same execution → cancel ack `true`, later
  `dispatch:result.outcome === 'CANCELLED'`, `cancel` unknown id → `false`,
  `dispose` drains and acks.
- `utility-process-worker-host.test.ts` (injected `processFactory`): lazy start
  only once, init handshake, dispatch correlation, **dispatch + concurrent
  cancel**, child exit → all pending rejected with `HostUnavailableError`, dispose
  timeout → kill, next dispatch after crash starts a new generation, same
  `executionRequestId` never auto-replayed.
- Manual runtime smoke: `electron .` with `CANVAS_AGENT_REPO`; drive
  `worker.dispatch` through the router and observe `SUCCEEDED` with a real patch
  hash, while the Utility Process hosts the work.

## Ownership & files

| File | Owner |
|---|---|
| `apps/desktop/src/worker/protocol.ts` | architect (drafted here) |
| `apps/desktop/src/worker/worker-service.ts` | architect |
| `apps/desktop/src/worker/index.ts` | architect |
| `apps/desktop/src/main/utility-process-worker-host.ts` | architect |
| `apps/desktop/electron.vite.config.ts` | architect |
| `apps/desktop/tsconfig.node.json` | architect |
| `apps/desktop/src/main/index.ts` (host swap) | architect |
| tests above | architect |
| `packages/worker-runtime` | unchanged |

## Handoff

On approval, implement Phase 2 as scoped above; then update the Phase 1 delivery
record. A real Agent adapter, multi-worker scheduling, event/checkpoint protocols
remain separate later phases.
