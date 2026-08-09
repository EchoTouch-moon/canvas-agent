# Canvas Agent collaboration rules

These rules apply to human and AI contributors in the entire repository.

## Product scope gate

Do not automatically agree with or implement a newly proposed feature. Classify it first:

1. **Core** — required to complete the current MVP loop.
2. **Enhancement** — improves the loop but is not required for it to work.
3. **Future direction** — intentionally deferred until a named validation trigger.
4. **Idea repository** — interesting but not scheduled.

Only Core work enters the current implementation without a separate scope decision. Record the other three categories in `docs/product/scope-register.md` with a reason.

## Design authority

When sources conflict, use this order:

1. the user's latest explicit decision;
2. the current master design baseline;
3. the relevant specialist baseline;
4. accepted ADRs;
5. older plans or visual references.

Never treat fixture values, screenshots, Canvas coordinates, or Agent suggestions as formal project facts.

## Architectural invariants

- Node is not Task; Task is not Run; Run success is not Task completion.
- Task completion does not activate a Baseline.
- Approved does not mean consumed.
- Frozen versions, snapshots, requests and baselines are immutable.
- Renderer code has no Node.js, filesystem, database, Git or process access.
- Privileged work crosses narrow, runtime-validated IPC contracts.
- Workers execute an immutable `ExecutionRequest` in an isolated worktree.
- Git is authoritative for code; SQLite is authoritative for application state.
- No new core entity, state, edge type, public contract or database shape without architecture review.

## Code rules

- Read the target and adjacent files before editing.
- Make the smallest change that satisfies the task packet.
- TypeScript is strict; do not introduce `any` or unchecked casts.
- Parse data at trust boundaries with Zod.
- Never use shell interpolation for user-controlled process arguments.
- Do not hardcode secrets, tokens, absolute user paths or machine-specific settings.
- New behavior requires tests for its acceptance criteria.
- Run `pnpm check` before handoff.

## UI rules

- Reuse `components/ui`, then `components/app`, then `components/domain`.
- Use semantic CSS variables; no scattered raw status colors.
- Preserve the compact desktop workbench direction and light/dark themes.
- Include loading, empty, error, disabled and read-only states where relevant.
- Status must not rely on color alone.
- Do not turn screenshots into hardcoded layouts or fake business state.

## Cross-computer ownership

- DeepSeek V4 Flash owns `packages/persistence/**`, then `packages/worker-runtime/**` according to its task packet.
- GPT-5.6 Luna owns `apps/desktop/src/renderer/**` according to its task packet.
- The lead architect owns `packages/domain/**`, `packages/contracts/**`, Electron main/preload security boundaries and ADRs.
- Do not edit another owner's files. If a contract must change, stop and open a short proposal in the task handoff.

### Product MVP v0.2 temporary delegation

For the Product MVP closeout, the user has directed that most implementation go to DeepSeek. The following task packets are lead-approved, task-scoped exceptions to the default ownership above:

| Packet | Assignee | Temporary scope |
|---|---|---|
| DS-003 | DeepSeek | deterministic clock, package resources, package/Electron CI smoke; exact whitelist in packet |
| DS-004 | DeepSeek | approved workspace Contracts and Electron Main/Preload runtime wiring; exact whitelist in packet |
| DS-005 | DeepSeek | Worker/runtime and concrete local CLI integration; exact whitelist in packet |
| DS-006 | DeepSeek | Renderer client/hooks/reducers plus narrowly named functional onboarding components using existing primitives; no visual CSS/design-system work |
| DS-007 | DeepSeek | E2E/CI/release documentation, not unscoped production changes |
| UI-003 | GPT-5.6 Luna | visual Renderer components/CSS/i18n only, after DS-006 is merged |

The file whitelist and stop conditions in each packet are mandatory. Public contract, database shape, domain state or security-boundary deviations still require a new lead-accepted proposal. Temporary delegation ends when the named packet is merged or closed.
