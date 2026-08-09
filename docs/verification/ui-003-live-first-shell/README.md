# UI-003 live-first product shell verification

Date: 2026-08-10

Branch: `agent/luna-ui-003-live-first-shell`

Base: `main@1d9c82e`

Runtime: Node `24.x`

## Result

UI-003 passes its component, repository, Electron Live-loop and visual gates. Production still
boots directly into the Live product shell; the visual harness is an E2E-only Vite entry and is not
referenced by `App.tsx` or the production renderer build.

## State-to-screen map

| Supplied state | Product screen | Non-color distinction | Command posture |
| --- | --- | --- | --- |
| `BOOTING` | Local workspace check | Spinner, `Checking local workspace…`, disabled actions | No duplicate open/reopen |
| `CLOSED` / `NO_WORKSPACE` | Repository chooser | Repository icon, local-first explanation, one primary action | Choose is primary; reopen is secondary |
| `CHOOSING` / `OPENING` / `REOPENING` | Stable repository transition shell | Spinner plus explicit phase text | Choose/reopen actions disabled |
| `ERROR` / `INVALID` / `UNAVAILABLE` | Repository attention state | Alert icon, plain-language reason, dismiss/retry affordances | No project or Run mutation |
| `READY` | Project setup plus governed workbench | Repository identity, Agent badge, setup and workbench regions | Existing explicit Run sequence retained |
| `SWITCH_BLOCKED` | Last-ready workspace with warning strip | `Switch paused` badge and active-Run explanation | No implicit cancel action |
| Agent non-ready/auth/error | Last-ready workspace with Agent action | Agent-specific badge and `Configure Agent` | Run remains disabled; no Fixture fallback |
| `CLOSING` / switching | Last-ready spatial shell | Closing label and transition treatment | Project and Run mutations disabled |
| `READ_ONLY` / dirty repository | Inspection with warning banner | Warning icon and commit/stash recovery text | Setup, freeze and Run remain disabled |
| Project/charter/Baseline setup | Three-step Project progress card | Project → Charter → Baseline structure | DRAFT activation remains a separate button |
| Task/TaskSpec setup | Two-step Task progress card | Task intent and TaskSpec acceptance are separate | Partial state resumes without hidden publication |

## Visual captures

The harness sets a synthetic workspace path (`/Users/demo/Projects/canvas-agent`) and a fake typed
transport only inside `apps/desktop/e2e/ui003-harness/**`. No screenshot contains a real repository
path, credential, prompt, or source content.

### Required light/dark pairs

| State | Light | Dark |
| --- | --- | --- |
| No workspace · 1080×720 | [capture](./no-workspace-light-1080x720.png) | [capture](./no-workspace-dark-1080x720.png) |
| Opening · 1080×720 | [capture](./opening-light-1080x720.png) | [capture](./opening-dark-1080x720.png) |
| Error · 1080×720 | [capture](./error-light-1080x720.png) | [capture](./error-dark-1080x720.png) |
| Ready · 1440×960 | [capture](./ready-light-1440x960.png) | [capture](./ready-dark-1440x960.png) |
| Switch blocked · 1440×960 | [capture](./switch-blocked-light-1440x960.png) | [capture](./switch-blocked-dark-1440x960.png) |

Additional supplied-state captures:

- [Booting · light · 1080×720](./booting-light-1080x720.png)
- [Closing · dark · 1440×960](./closing-dark-1440x960.png)
- [Agent authentication required · light · 1440×960](./agent-auth-light-1440x960.png)
- [First Project · light · 1440×960](./first-project-light-1440x960.png)
- [First Task · light · 1440×960](./first-task-light-1440x960.png)
- [Initial Baseline DRAFT review · light · 1440×960](./baseline-draft-light-1440x960.png)
- [TaskSpec publication · light · 1440×960](./task-spec-light-1440x960.png)
- [Dirty/read-only setup · dark · 1440×960](./dirty-dark-1440x960.png)

For every capture, `ui003-visual.e2e.cjs` asserted:

- `document.documentElement.scrollWidth <= window.innerWidth`;
- every visible button, input, select and textarea stays within the viewport;
- at least one `aria-live` or `role="status"` announcement exists;
- the PNG pixel dimensions equal the named 1080×720 or 1440×960 viewport.

## Keyboard path

The visual harness starts at the document root and presses `Tab` until the primary
`Choose repository` button receives focus, presses `Enter` to accept a typed READY result, then
continues with keyboard input through `Task title` to the `Create task` action. The complete path
passed: `Choose repository → READY → Task title → Create task`. All controls retain the shared
`:focus-visible` ring from `main.css`.

The real Live E2E independently exercised the complete explicit sequence:

`Choose/ready → context selection → Freeze snapshot → Dispatch execution → Submit evaluation → Complete task → Authorize apply → Create baseline candidate → activate DRAFT after restart`.

## Automated verification

| Gate | Result |
| --- | --- |
| Setup/onboarding interaction tests | 11/11 PASS |
| `pnpm --filter @canvas-agent/desktop lint` | PASS |
| `pnpm --filter @canvas-agent/desktop typecheck` | PASS |
| `pnpm --filter @canvas-agent/desktop test` | 36 files, 251 tests PASS |
| `pnpm --filter @canvas-agent/desktop build` | PASS |
| `pnpm check` | 470 tests plus format/lint/typecheck/build PASS |
| `pnpm --filter @canvas-agent/desktop e2e:live` | ALL PASSED, including restart persistence and DRAFT review gate |
| `node apps/desktop/e2e/ui003-visual.e2e.cjs` | 18 captures plus overflow/control/full keyboard-path assertions PASS |
| `git diff --check` | PASS |

## Scope and visual debt

- Changed only the UI-003-authorized Renderer components, `main.css`, adjacent component tests,
  the E2E visual harness and this verification folder.
- No client, hook, reducer, state derivation, Contracts, Main, Preload, Worker, Persistence or schema
  file changed.
- IDs remain available only under collapsed `Technical details`; they are no longer primary UI.
- `CHOOSING`, `OPENING` and `REOPENING` intentionally share one spatial transition shell and differ
  through icon/status text. A distinct animation for each would add motion without improving the
  core loop, so it is not scheduled.
