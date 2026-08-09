# UI-003 manual QA

Run date: 2026-08-10

## Findings ordered by severity

**CLEAN — no blockers found.** The expanded Node24 harness covers every required UI-003 state,
passes all 18 captures plus the complete keyboard path, and the screenshots are visually legible
with no clipping or horizontal overflow.

## manualQa

### surfaceEvidence

| scenario id | criterion reference | surface | exact invocation | verdict | artifactRefs |
|---|---|---|---|---|---|
| S-01 | AC-1, AC-2, AC-3, AC-7, AC-8; required no-workspace | Electron visual harness, no-workspace light 1080x720 | PATH=/opt/homebrew/opt/node@24/bin:$PATH node apps/desktop/e2e/ui003-visual.e2e.cjs (capture query ?state=no-workspace&theme=light, viewport 1080x720) | PASS | shot-no-workspace-light, e2e-transcript |
| S-02 | AC-2, AC-7, AC-8; required no-workspace | Electron visual harness, no-workspace dark 1080x720 | PATH=/opt/homebrew/opt/node@24/bin:$PATH node apps/desktop/e2e/ui003-visual.e2e.cjs (capture query ?state=no-workspace&theme=dark, viewport 1080x720) | PASS | shot-no-workspace-dark, e2e-transcript |
| S-03 | required choosing/opening/reopening; AC-2, AC-7, AC-8 | Electron visual harness, opening light/dark 1080x720 | PATH=/opt/homebrew/opt/node@24/bin:$PATH node apps/desktop/e2e/ui003-visual.e2e.cjs (capture queries ?state=opening&theme=light|dark, viewport 1080x720) | PASS | shot-opening-light, shot-opening-dark, e2e-transcript |
| S-04 | required invalid/error; AC-2, AC-5, AC-7, AC-8 | Electron visual harness, error light/dark 1080x720 | PATH=/opt/homebrew/opt/node@24/bin:$PATH node apps/desktop/e2e/ui003-visual.e2e.cjs (capture queries ?state=error&theme=light|dark, viewport 1080x720) | PASS | shot-error-light, shot-error-dark, e2e-transcript |
| S-05 | required ready; AC-2, AC-3, AC-4, AC-7, AC-8 | Electron visual harness, ready light/dark 1440x960 | PATH=/opt/homebrew/opt/node@24/bin:$PATH node apps/desktop/e2e/ui003-visual.e2e.cjs (capture queries ?state=ready&theme=light|dark, viewport 1440x960) | PASS | shot-ready-light, shot-ready-dark, e2e-transcript |
| S-06 | required switch-blocked; AC-2, AC-7, AC-8 | Electron visual harness, switch-blocked light/dark 1440x960 | PATH=/opt/homebrew/opt/node@24/bin:$PATH node apps/desktop/e2e/ui003-visual.e2e.cjs (capture queries ?state=switch-blocked&theme=light|dark, viewport 1440x960) | PASS | shot-switch-light, shot-switch-dark, e2e-transcript |
| S-07 | required booting; AC-2, AC-7 | Electron visual harness, booting light 1080x720 | PATH=/opt/homebrew/opt/node@24/bin:$PATH node apps/desktop/e2e/ui003-visual.e2e.cjs (capture query ?state=booting&theme=light, viewport 1080x720) | PASS | shot-booting-light, e2e-transcript |
| S-08 | required closing/switching; AC-2, AC-7 | Electron visual harness, closing dark 1440x960 | PATH=/opt/homebrew/opt/node@24/bin:$PATH node apps/desktop/e2e/ui003-visual.e2e.cjs (capture query ?state=closing&theme=dark, viewport 1440x960) | PASS | shot-closing-dark, e2e-transcript |
| S-09 | required Agent auth/unavailable; AC-2, AC-5 | Electron visual harness, agent-auth light 1440x960 | PATH=/opt/homebrew/opt/node@24/bin:$PATH node apps/desktop/e2e/ui003-visual.e2e.cjs (capture query ?state=agent-auth&theme=light, viewport 1440x960) | PASS | shot-agent-auth-light, e2e-transcript |
| S-10 | required First Project | Electron visual harness, first-project light 1440x960 | PATH=/opt/homebrew/opt/node@24/bin:$PATH node apps/desktop/e2e/ui003-visual.e2e.cjs (capture query ?state=first-project&theme=light, viewport 1440x960) | PASS | shot-first-project-light, e2e-transcript |
| S-11 | required Initial Baseline DRAFT review | Electron visual harness, baseline-draft light 1440x960 | PATH=/opt/homebrew/opt/node@24/bin:$PATH node apps/desktop/e2e/ui003-visual.e2e.cjs (capture query ?state=baseline-draft&theme=light, viewport 1440x960) | PASS | shot-baseline-light, e2e-transcript |
| S-12 | required First Task | Electron visual harness, first-task light 1440x960 | PATH=/opt/homebrew/opt/node@24/bin:$PATH node apps/desktop/e2e/ui003-visual.e2e.cjs (capture query ?state=first-task&theme=light, viewport 1440x960) | PASS | shot-first-task-light, e2e-transcript |
| S-13 | required TaskSpec | Electron visual harness, task-spec light 1440x960 | PATH=/opt/homebrew/opt/node@24/bin:$PATH node apps/desktop/e2e/ui003-visual.e2e.cjs (capture query ?state=task-spec&theme=light, viewport 1440x960) | PASS | shot-task-spec-light, e2e-transcript |
| S-14 | required dirty repository/read-only | Electron visual harness, dirty dark 1440x960 | PATH=/opt/homebrew/opt/node@24/bin:$PATH node apps/desktop/e2e/ui003-visual.e2e.cjs (capture query ?state=dirty&theme=dark, viewport 1440x960) | PASS | shot-dirty-dark, e2e-transcript |
| S-15 | keyboard choose → ready → task action | Electron visual harness keyboard path | PATH=/opt/homebrew/opt/node@24/bin:$PATH node apps/desktop/e2e/ui003-visual.e2e.cjs | PASS — Choose repository -> READY -> Task title -> Create task | shot-first-task-light, e2e-transcript |
| S-16 | DS-006 form seam smoke (supporting) | Renderer component test DOM | PATH=/opt/homebrew/opt/node@24/bin:$PATH pnpm --filter @canvas-agent/desktop exec vitest run src/renderer/src/components/app/project-setup-flow.test.tsx src/renderer/src/components/app/task-setup-flow.test.tsx src/renderer/src/components/app/product-onboarding.test.tsx src/renderer/src/App.test.tsx | PASS — 4 files / 12 tests | renderer-tests |

### adversarialCases

| scenario id | criterion reference | adversarial class | expected behavior | verdict | artifactRefs |
|---|---|---|---|---|---|
| A-01 | AC-7 | responsive horizontal overflow | document.scrollWidth must not exceed the viewport at every captured 1080x720 or 1440x960 state | PASS — harness asserts this for all 18 captures | e2e-transcript, all-state-screenshots |
| A-02 | AC-2, AC-8 | light/dark parity and contrast | light and dark captures remain legible; state meaning must not depend on color alone | PASS — paired captures show readable text, badges, icons, and explanatory copy | paired-theme-screenshots |
| A-03 | AC-2 | color-only status encoding | each lifecycle status must include visible text/icon/structure | PASS — badges and headings/alerts repeat status meaning in every runnable state | all-state-screenshots |
| A-04 | required choosing/opening/reopening | duplicate actions during transition | primary and reopen controls are visibly disabled while opening | PASS — opening captures show disabled controls and “Preparing your workspace…” | shot-opening-light, shot-opening-dark |
| A-05 | AC-5 | error disclosure | error gives plain-language reason and recovery controls without stack trace/secret | PASS — error card states unreadable Git worktree/commit and offers Choose, Reopen, Retry, Dismiss | shot-error-light, shot-error-dark |
| A-06 | required switch-blocked | active Run safety | explain active Run and retain safe return; do not offer implicit cancel | PASS — warning says return to current work/try later; Dismiss is explicit; no cancel action appears | shot-switch-light, shot-switch-dark |
| A-07 | required Agent auth | auth/configuration vs Run outcome | Agent auth state must be distinct from Run state | PASS — top status reads SIGN-IN REQUIRED and exposes Configure Agent while Run remains separately labelled/disabled | shot-agent-auth-light |
| A-08 | AC-3 | prohibited developer labels | production surface must not expose Fixture switch or REAL IPC as a primary label | PASS — no Fixture switch or REAL IPC text appears in runnable captures | all-state-screenshots |
| A-09 | AC-6 | keyboard primary action | Tab navigation reaches the named primary Choose repository action with visible focus | PASS — harness keyboard scenario reaches Choose repository | shot-no-workspace-light, e2e-transcript |
| A-10 | AC-6 | status announcement | each state must expose at least one aria-live or role=status region | PASS — harness asserts nonzero live/status regions for each capture | e2e-transcript, all-state-screenshots |
| A-11 | required First Project/Baseline/Task/dirty states | visual fixture coverage | every required screen needs a runnable visual scenario and artifact | PASS — expanded harness provides all four classes and captures them at 1440x960 | shot-first-project-light, shot-baseline-light, shot-first-task-light, shot-task-spec-light, shot-dirty-dark |

## artifactRefs

| id | kind | description | path |
|---|---|---|---|
| e2e-transcript | terminal transcript | 18 visual captures, overflow/control/live-region assertions, and complete keyboard focus path | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/ui003-visual-e2e-transcript.txt |
| renderer-tests | test transcript | supporting renderer component tests: 4 files / 12 tests | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/ui003-renderer-component-tests.txt |
| harness-source | source artifact | runnable visual fixture state list, including first-project, baseline-draft, first-task, task-spec, dirty, and keyboard-path states | /Users/v/Documents/V/apps/desktop/e2e/ui003-harness/main.tsx |
| all-state-screenshots | screenshot set | all 18 state captures listed below | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/ |
| paired-theme-screenshots | screenshot set | light/dark pairs for no-workspace, opening, error, ready, and switch-blocked | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/ |
| shot-no-workspace-light | screenshot | no-workspace light 1080x720 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/no-workspace-light-1080x720.png |
| shot-no-workspace-dark | screenshot | no-workspace dark 1080x720 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/no-workspace-dark-1080x720.png |
| shot-opening-light | screenshot | opening light 1080x720 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/opening-light-1080x720.png |
| shot-opening-dark | screenshot | opening dark 1080x720 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/opening-dark-1080x720.png |
| shot-error-light | screenshot | invalid/error light 1080x720 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/error-light-1080x720.png |
| shot-error-dark | screenshot | invalid/error dark 1080x720 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/error-dark-1080x720.png |
| shot-ready-light | screenshot | ready light 1440x960 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/ready-light-1440x960.png |
| shot-ready-dark | screenshot | ready dark 1440x960 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/ready-dark-1440x960.png |
| shot-switch-light | screenshot | switch-blocked light 1440x960 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/switch-blocked-light-1440x960.png |
| shot-switch-dark | screenshot | switch-blocked dark 1440x960 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/switch-blocked-dark-1440x960.png |
| shot-booting-light | screenshot | booting light 1080x720 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/booting-light-1080x720.png |
| shot-closing-dark | screenshot | closing dark 1440x960 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/closing-dark-1440x960.png |
| shot-agent-auth-light | screenshot | Agent auth/sign-in required light 1440x960 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/agent-auth-light-1440x960.png |
| shot-first-project-light | screenshot | First Project light 1440x960 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/first-project-light-1440x960.png |
| shot-baseline-light | screenshot | Initial Baseline DRAFT review light 1440x960 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/baseline-draft-light-1440x960.png |
| shot-first-task-light | screenshot | First Task light 1440x960 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/first-task-light-1440x960.png |
| shot-task-spec-light | screenshot | TaskSpec publication light 1440x960 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/task-spec-light-1440x960.png |
| shot-dirty-dark | screenshot | Dirty/read-only setup dark 1440x960 | /Users/v/Documents/V/docs/verification/ui-003-live-first-shell/dirty-dark-1440x960.png |
