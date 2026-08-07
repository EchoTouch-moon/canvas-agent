# Release record — 2026-08-07: bilingual UI + onboarding + flow guidance

Commit: `80acecf` (`feat(renderer): bilingual i18n, onboarding guide and flow progress rail`)
Scope: `apps/desktop/src/renderer/**` only.

## What changed

### 1. Bilingual i18n (中文 / English)
- New `lib/i18n.tsx` (provider + `useI18n`/`t`) and `lib/i18n-messages.ts`
  (strictly-typed `en`/`zh` dictionaries; TypeScript enforces key parity).
- Language toggle in the header and the command palette; defaults to the system
  locale; persisted in `localStorage` (`canvas-agent-locale`).
- Localized all visible UI: sidebar, header, command palette, inspector (incl.
  empty states), domain status badges, every action button, the 8 core-flow
  screens, and the typed fixture content (nodes/task/context/run/artifact/baseline).
- Reducer notices stay English as the source of truth and are translated at
  render time (including interpolated messages and freeze blockers).
- Language switch remounts the workspace (`key={locale}`) so fixture content
  reloads in the chosen locale; `RESET_FLOW` re-seeds with the current locale.

### 2. Inspector collapse bug fix
- `components/ui/resizable.tsx` treated `basis={0}` as falsy and fell back to
  `flex: 1 1 0%` (grow), leaving a large blank area when the inspector was
  collapsed. Now keyed on `basis !== undefined`, so collapsed panels truly
  collapse.

### 3. Onboarding — quick-start guide
- New `FlowGuide` dialog shown on first launch with the 7-step core loop and the
  "no hidden automation" principle; re-openable from a header help (`?`) button;
  dismissal persisted (`canvas-agent-flow-guide-seen`).

### 4. Flow guidance — persistent progress rail
- New `FlowProgress` rail (top of every core-flow screen): "Step X of 7 · current
  stage", a 7-segment progress bar, and the explicit next action with a
  one-click "Go" button that navigates to the right screen.
- New `state/flow-stage.ts` computes the current stage and next action from state
  (context → start → run → artifact → evaluate → complete → baseline).
- Run screen now shows an explicit next-step hint (start / prepare / execute /
  finish) under the run action.

## Verification
- `pnpm check` green (exit 0): desktop 7/7, domain 5/5, contracts 2/2,
  persistence 33/33, worker-runtime 16/16.
- Rebuilt `dist/mac-arm64/Canvas Agent.app` (signed, not notarized) and verified
  it launches and stays running.

## Open product decisions (confirmed, pending next change batch)
1. Collapse "apply artifact" + "accept artifact" into a single "接受产物" action
   for the prototype (accept implies apply); domain concepts stay separate.
2. Auto-navigate to the next stage's screen after each completed formal gate
   (finish run → artifact; accept → task/evaluate; evaluate → keep on task with
   scroll to Complete; complete → baseline; activate → done).
3. Remove the `>` breadcrumb; make the progress rail a clickable numbered step
   strip for flow-oriented navigation.
4. Disabled gate buttons must explain why and offer a "go there" link to remove
   bouncing between steps 4 and 5.

## Follow-up release (commit `6682830`): single-action core flow

All four decisions above are implemented and refined:

- **Accept implies apply**: the Artifact screen exposes a single "接受产物"
  action; accepting applies the patch and records human review in one command.
- **One explicit completion**: `COMPLETE_TASK` now atomically evaluates all
  acceptance criteria and records `completionRunId` (RUN-009), removing the
  standalone `EVALUATE_ACCEPTANCE` command and its redundant intermediate click.
  The Task screen bottom is a single "完成任务" confirmation card (criteria hint
  + one button), with a blocking reason + go-link when prerequisites are unmet.
- **Auto-navigation**: finish run → artifact; accept → task (completion);
  complete → baseline; activate → done. The flow is a one-way conveyor.
- **Run auto-advance**: the mock worker advances QUEUED → PREPARING → RUNNING
  by itself (timeline lights up), so the user only clicks start and finish.
- **`>` breadcrumb removed**: navigation moved to clickable numbered step pills
  in the progress rail.
- **6 stages** (context → start → run → artifact → complete → baseline) across
  the progress rail, the quick-start guide and all i18n strings.

### Verification
- `pnpm check` green (exit 0): desktop 8/8 (reducer tests updated: accept implies
  apply, complete implies evaluation, completion blocked until artifact accepted),
  domain 5/5, contracts 2/2, persistence 33/33, worker-runtime 16/16.
- Rebuilt `dist/mac-arm64/Canvas Agent.app` (signed, not notarized) and launched.
- UI-002 acceptance criterion 5 still holds: the Task stays `WAITING_REVIEW`
  until the single explicit completion action.
