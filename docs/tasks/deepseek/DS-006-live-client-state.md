# DS-006 — Live-first client, workspace state and functional onboarding

## Task owner

DeepSeek V4 Flash — logic-first Renderer integration. This packet grants temporary ownership to client/hook/reducer files plus narrowly named functional onboarding components built only from existing primitives. Luna remains the visual owner after merge.

- **Branch:** `agent/deepseek-ds-006-live-client-state`
- **Depends on:** DS-004 and DS-005 merged; rebase/merge latest `main`
- **Blocks:** UI-003

## Goal

Give the Renderer a complete typed product state model for workspace selection and Live operation, remove the production Fixture default, and freeze stable component-facing props so Luna can finish the visual layer without designing application state.

## Read first

- `CONTRIBUTING.md`
- `docs/PRODUCT_MVP_V0.2_PLAN.md` sections 5.4 and 6
- `docs/architecture/decisions/PROPOSAL-029-first-workspace-bootstrap-flow.md`
- `docs/architecture/decisions/PROPOSAL-028C-agent-readiness-command-contract.md`
- accepted DS-004 workspace command schemas
- `apps/desktop/src/renderer/src/App.tsx`
- `apps/desktop/src/renderer/src/lib/workspace-client.ts`
- `apps/desktop/src/renderer/src/hooks/use-workspace.ts`
- `apps/desktop/src/renderer/src/state/workspace-ui-reducer.ts`
- existing Renderer tests

## Authorized files

- `apps/desktop/src/renderer/src/lib/workspace-client.ts`
- `apps/desktop/src/renderer/src/lib/workspace-types.ts`
- new adjacent non-visual workspace model/selectors under `lib/**`
- `apps/desktop/src/renderer/src/hooks/use-workspace.ts`, `use-runtime-info.ts` and new workspace lifecycle hooks
- `apps/desktop/src/renderer/src/state/workspace-ui-reducer.ts` and new adjacent state modules
- `apps/desktop/src/renderer/src/App.tsx` only for mode/composition wiring
- new `components/app/product-onboarding.tsx`, `project-setup-flow.tsx`, `task-setup-flow.tsx` (or fewer equivalently named files) and adjacent tests
- existing `components/app/live-workspace-view.tsx` only for the smallest integration seam; do not restyle unrelated sections
- adjacent unit/interaction tests
- `apps/desktop/src/renderer/src/env.d.ts` if an explicit development-only fixture flag needs typing
- one short interface handoff for UI-003 under `docs/tasks/luna/**`

Do not modify visual CSS, base UI primitives, i18n copy, Main, Preload or Contracts.

## Required implementation

1. Extend the typed client for all accepted workspace lifecycle and `agent.*` readiness commands.
2. Model explicit states: booting, no workspace, choosing, opening/reopening, ready, switch blocked, invalid/error, closing and unavailable/read-only, plus Agent checking/not-found/auth-required/unsupported/ready.
3. Keep last successful READY view visible during a failed candidate switch while presenting the recoverable error separately.
4. Prevent project/run commands outside READY and prevent repeat open/close actions during transitions.
5. Wire production `App` to Live lifecycle by default.
6. Make Fixture available only behind a compile-time or explicit development flag. Production bundle behavior must not expose a Live/Fixture chooser.
7. Preserve formal domain transitions. Do not auto-run, auto-evaluate, auto-complete, auto-apply or auto-activate based on status changes.
8. Expose stable view-model props/callbacks for UI-003. Props must use product concepts, not raw command envelopes.
9. Add API-fake interaction tests for every lifecycle state and race guard.
10. Implement PROPOSAL-029 using existing commands: first Project, user-authored GOAL/charter NodeVersion, initial DRAFT Baseline, separate activation, Task and TaskSpec.
11. After every partial setup failure, rehydrate and resume at the next missing durable fact; never compensate with deletes or create duplicates on retry.
12. Add an existing-Project selector and empty-project flow. Creating a second Project is not required.
13. Keep the forms visually neutral and composed from existing primitives; UI-003 receives all visual polish.
14. Read `revision.current` readiness and block initial executable Baseline/Run actions when `workingTreePatchHash` is non-null; keep project inspection available.

## Prohibited scope

- No design-system changes, custom CSS or broad JSX redesign outside the named functional forms.
- No fake project data in production Live state.
- No direct `window.canvasAgent` calls outside the existing typed client boundary.
- No new IPC/command schema.
- No component file refactor unless the architect explicitly expands scope.
- No hiding errors by falling back to Fixture.

## Acceptance criteria

1. Production composition starts in Live booting/status resolution, never Fixture.
2. No-workspace state can choose or reopen a repository through typed callbacks.
3. Picker cancel returns to the prior stable state without an error banner.
4. Opening/switching disables duplicate lifecycle and execution actions.
5. Failed candidate switch preserves the prior READY data and offers retry/dismiss behavior.
6. Project data is cleared only after a successful close or successful switch to another identity.
7. Fixture cannot be entered in a production build through visible UI or query state.
8. Tests do not require Electron, Git or real filesystem access.
9. A fresh repository can reach a DRAFT initial Baseline without demo seed, but activation always requires a separate user action.
10. A task created before a failed TaskSpec publication resumes at the same DRAFT Task and does not duplicate it.
11. Run is disabled until Workspace, Agent, active Baseline, published TaskSpec and FROZEN Snapshot prerequisites are all satisfied.
12. Dirty repository status explains that the user must commit/stash externally; no cleanup mutation is offered.

## Required verification

```bash
pnpm --filter @canvas-agent/desktop test -- workspace-client use-workspace workspace-ui product-onboarding
pnpm --filter @canvas-agent/desktop typecheck
pnpm --filter @canvas-agent/desktop build
pnpm check
```

## UI-003 handoff contract

Provide Luna:

- view-model type and state table;
- callbacks and their disabled/busy rules;
- which existing components may be reused;
- screenshot/state fixture harness that contains no fake production state;
- functional onboarding component map and partial-failure/resume cases;
- explicit list of files Luna may edit without touching this task's state logic.
