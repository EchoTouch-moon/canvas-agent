# Delivery record — Phase 2: UtilityProcess worker host

- **Date:** 2026-08-07
- **Implemented by:** DeepSeek V4 Flash (delegated by the lead architect)
- **Basis:** PROPOSAL-021 (approved with required changes, merged `b2147b8`)
- **Repository:** https://github.com/EchoTouch-moon/canvas-agent

## Scope delivered

Replaces the Phase 1 `UnavailableWorkerHost` with a `UtilityProcessWorkerHost` so
`worker.dispatch` / `worker.cancel` run a real `@canvas-agent/worker-runtime`
Worker inside an Electron **Utility Process** (ADR-018), never in Electron Main.
The renderer still runs on fixtures (Phase 3); the Worker now executes against the
isolated Git worktree over the validated internal protocol.

## Commit

| SHA | Message |
|---|---|
| `659fda8` | feat(worker): UtilityProcess worker host for the real execution boundary |

## Deliverables

| File | Responsibility |
|---|---|
| `src/worker/protocol.ts` | Zod-validated internal protocol; `protocolVersion: 1`; `messageId` (transport) vs `executionRequestId` (domain) are distinct identities; typed error frames (`NOT_INITIALIZED` / `INVALID_FRAME` / `SERVICE_FAILURE`) |
| `src/worker/worker-service.ts` | One `createWorker` per process (shared claim store); per-execution `AbortController` + `completion`; `cancel:result.cancelled` = signal delivered (terminal state is the later `dispatch:result.outcome === 'CANCELLED'`); `dispose` aborts all executions, drains, then acks (does not rely on `worker.cancel()`) |
| `src/worker/index.ts` | Electron Utility Process entry via `process.parentPort` (no `worker_threads` fallback) |
| `src/main/utility-process-worker-host.ts` | Lazy single-flight state machine (`STOPPED/STARTING/READY/DISPOSING` + `startPromise`); pending keyed by `messageId`; child exit → all pending rejected with `HostUnavailableError` and host returns to a restartable state; `submittedExecutionIds` prevents cross-restart auto-replay; `dispose` waits for `dispose:ack` (timeout) then kills |
| `src/main/worker-smoke.ts` | Env-gated runtime smoke (`CANVAS_AGENT_SMOKE=1`): forks the Utility Process, dispatches, verifies real patch evidence |
| `electron.vite.config.ts` | Main build gains a second entry (`index` + `worker`) bundling the workspace packages |
| `tsconfig.node.json` | Includes `src/worker/**/*` |
| `src/main/index.ts` | Uses `UtilityProcessWorkerHost` when a valid `AppConfig` exists |
| `packages/worker-runtime/src/worker.ts` | Cancellation now propagates to `outcome: 'CANCELLED'` when the abort lands mid-verification (previously only via agent-catch / loop-start) |

## Review constraints honored (PROPOSAL-021 required changes)

1. `messageId` transport correlation; `executionRequestId` is domain-only. ✅
2. `init:ack` + `ensureStarted(): Promise<void>` single-flight state machine. ✅
3. `dispose` aborts per-execution controllers, drains, then acks; main waits with
   timeout then kills. ✅
4. Crash → current request `HostUnavailableError` (no replay); next independent
   dispatch may lazily start a fresh Utility Process. ✅
5. Claim store is process-local; `submittedExecutionIds` blocks cross-restart
   replay; retry must be a new `ExecutionRequest`. ✅
6. Fixed transport: `process.parentPort` / `child.postMessage`; no
   `node:worker_threads` fallback. ✅
7. `tsconfig.node.json` includes `src/worker/**/*`. ✅
8. Host lifecycle tests (lazy-once, init handshake, dispatch correlation,
   dispatch + concurrent cancel, child exit → pending rejected, dispose
   ack/timeout, restart on next dispatch, no auto-replay). ✅
9. `protocolVersion: 1`; typed error frames; `cancel:result.cancelled` semantics
   documented. ✅
10. FixtureAgentAdapter kept for Phase 2; the runtime smoke produces **real patch
    evidence** (fixture writes `docs/phase2.md`, verification exit 0). ✅

## Verification

```text
pnpm check  PASS (exit 0)

@canvas-agent/domain          5/5
@canvas-agent/contracts      13/13
@canvas-agent/persistence    33/33
@canvas-agent/worker-runtime 18/18
@canvas-agent/desktop        30/30   (added protocol, worker-service and host
                                      lifecycle tests; total 99)
```

Runtime smoke (real Utility Process):

```text
CANVAS_AGENT_REPO=/tmp/…/repo CANVAS_AGENT_SMOKE=1 pnpm --filter @canvas-agent/desktop exec electron .
[workspace] ready at /private/tmp/…/repo
[worker-smoke] outcome=SUCCEEDED
[worker-smoke] PASSED (real patch evidence produced in the Utility Process)
```

The worker-path boundary is now fully wired:

```text
Renderer → validated IPC → Main → validated internal protocol → Utility Process →
worker-runtime → isolated Git worktree → patch / verification → DispatchResult
```

> Verification above records **local `pnpm check`**; CI status is not part of this
> delivery evidence (no GitHub Actions pipeline yet).

## How to use

```bash
# real workspace + Worker in the Utility Process
CANVAS_AGENT_REPO=/path/to/repo pnpm --filter @canvas-agent/desktop dev

# runtime smoke (forks the Utility Process, dispatches, prints evidence, quits)
CANVAS_AGENT_REPO=/path/to/repo CANVAS_AGENT_SMOKE=1 pnpm --filter @canvas-agent/desktop dev
```

## Known limits / next steps

- Phase 2 keeps the deterministic `FixtureAgentAdapter`; a **real Agent adapter**
  is a separate later phase.
- Renderer still uses fixtures — Phase 3 (Luna) swaps in a `WorkspaceClient` over
  `window.canvasAgent.command`.
- Multi-worker scheduling, queues, event/checkpoint protocols remain future work;
  claim semantics are process-local (cross-app-restart durability is future
  orchestration).
- The worker process is not auto-restarted after a crash; the next independent
  dispatch lazily starts a fresh Utility Process.
