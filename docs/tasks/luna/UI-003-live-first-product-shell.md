# UI-003 — Live-first product shell and visual release pass

## Task owner

GPT-5.6 Luna — one consolidated visual task. Do not start before DS-006 is merged and its interface handoff is marked ready.

- **Branch:** `agent/luna-ui-003-live-first-shell`
- **Depends on:** DS-004, DS-005 and DS-006 merged
- **Blocks:** DS-007 final visual gate only

## Why this is one task

Luna owns only the visual interpretation of already-frozen workspace states. Runtime, contracts, client calls, reducers and business transitions are complete before this starts, avoiding repeated visual rework while backend behavior changes.

## Goal

Turn the existing prototype shell into a compact production workspace that opens Live-first, explains repository and Agent readiness in user language, and gives every workspace lifecycle a coherent light/dark visual state without inventing business data.

## Read first

- `AGENTS.md`
- `docs/PRODUCT_MVP_V0.2_PLAN.md` sections 3 and 5.4
- DS-006 interface handoff in this directory
- `docs/architecture/decisions/PROPOSAL-029-first-workspace-bootstrap-flow.md`
- `apps/desktop/src/renderer/src/components/ui/**`
- `apps/desktop/src/renderer/src/components/app/app-shell.tsx`
- `apps/desktop/src/renderer/src/assets/main.css`
- local UI visual references, used as direction rather than source-of-truth state

## Authorized files

- `apps/desktop/src/renderer/src/components/app/**`
- `apps/desktop/src/renderer/src/components/domain/**` only for status presentation
- `apps/desktop/src/renderer/src/components/ui/**` only when an existing primitive cannot satisfy the frozen interface
- `apps/desktop/src/renderer/src/assets/main.css`
- `apps/desktop/src/renderer/src/lib/i18n-messages.ts`
- `apps/desktop/src/renderer/src/App.tsx` only for final visual composition after DS-006
- adjacent component/interaction tests and visual capture harness
- `docs/verification/**` for screenshot evidence

Do not modify client, hooks, state reducers, Contracts, Main, Preload, Worker or Persistence.

## Required screens/states

1. **Booting:** restrained skeleton/status; no fake project.
2. **No workspace:** one primary “Choose repository” action, optional “Reopen last” when supplied by the view model, and a concise local-first explanation.
3. **Choosing/opening/reopening:** visible progress, duplicate actions disabled and status not represented by color alone.
4. **Invalid/error:** plain-language reason, path/detail secondary, Retry/Choose another/Dismiss according to supplied callbacks.
5. **Ready:** repository identity visible but subordinate to project/task work; existing core flow remains available.
6. **Switch blocked:** active run explanation and safe return to work; no implicit cancel affordance.
7. **Agent unavailable/auth/error:** distinguish configuration problem from Run outcome; do not show Fixture fallback.
8. **Closing/switching:** preserve spatial stability and prevent edits until the supplied view model returns READY.
9. **First Project:** visually polish the DeepSeek-built Project/charter form without changing its command sequencing.
10. **Initial Baseline:** make DRAFT review and separate activation unmistakable.
11. **First Task:** visually polish Task/TaskSpec/criterion input while keeping partial-resume states visible.
12. **Dirty repository:** keep inspection available, visibly block execution/setup actions and explain commit/stash without offering destructive cleanup.

## Visual direction

- Preserve the compact desktop workbench, information density and existing semantic token system.
- Use one clear primary action per state.
- Remove ordinary-user emphasis on “REAL IPC,” schema command names and raw IDs. Keep IDs accessible in secondary details where useful.
- Preserve light and dark themes.
- Use existing UI primitives before adding new ones.
- Use local screenshots for rhythm, hierarchy and feel only; do not reproduce fixed coordinates or screenshot data.
- Avoid celebratory landing-page styling. This is a working tool.

## Prohibited scope

- No state-machine, command, contract or data-fetch changes.
- No Canvas/graph editor.
- No full rewrite of `core-flow-workspace.tsx` or `live-workspace-view.tsx`.
- No change to the DS-006 onboarding command order, retry semantics or derived states.
- No fake success, seeded project or fixture switch in production Live mode.
- No automatic formal transitions.
- No scattered raw status colors.

## Acceptance criteria

1. A first-time user can identify how to choose a repository in under one screen without developer terminology.
2. Every supplied lifecycle state is visibly distinct through text/icon/structure, not color alone.
3. Production UI contains no Live/Fixture switch and no “REAL IPC” primary label.
4. A READY workspace retains the existing explicit Run → Acceptance → Complete → Apply → Candidate → Activate sequence.
5. Error details are useful but do not expose stack traces or secrets.
6. Keyboard focus order, visible focus, button names, status announcements and contrast pass the project accessibility checks.
7. No horizontal overflow at 1080×720; intended dense layout is verified at 1440×960.
8. Light and dark mode captures exist for no-workspace, opening, ready, switch-blocked and error states.

## Required verification

```bash
pnpm --filter @canvas-agent/desktop lint
pnpm --filter @canvas-agent/desktop typecheck
pnpm --filter @canvas-agent/desktop test
pnpm --filter @canvas-agent/desktop build
pnpm check
```

Use the project browser/Electron visual test harness to capture both target sizes and themes. Return absolute artifact paths or committed verification paths.

## Handoff additions

Include:

- state-to-screen map;
- screenshots for required states/sizes/themes;
- keyboard path through choose → ready → task action;
- any visual debt consciously left for Enhancement;
- confirmation that no data/state/contract files changed.
