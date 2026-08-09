# PROPOSAL-029 — First workspace Project/Baseline/Task bootstrap flow

- **Status:** APPROVED — implementation authorized through DS-006/UI-003
- **Decision owner:** Lead architect
- **Date:** 2026-08-09
- **Scope:** Product MVP v0.2 Renderer flow using existing commands

## Problem

After a user selects a fresh Git repository, its repository-scoped SQLite database contains no Project. The current Live view only calls `project.list`/`project.state`, assumes demo seed data and offers no way to create the Project facts, initial Baseline or Task required to enter the execution loop.

## Decision

Implement a resumable first-workspace flow by composing existing explicit commands. Do not add a backend `project.bootstrap` mega-command and do not seed fake state in production.

The flow uses these durable domain steps:

```text
1. project.create
2. node.create(type = GOAL)
3. nodeVersion.publish(title/body = user-confirmed project charter)
4. revision.current
5. baseline.createDraft(nodeVersionIds = [charter], repositoryRevisionId = current)
6. user reviews and separately invokes baseline.activate
7. task.create(type = IMPLEMENT_CHANGE)
8. taskSpec.publish(description, scope, optional target, ≥1 criterion)
9. existing Context Composer → snapshot.freeze → execution.dispatch
```

Steps 1–5 may be presented as a guided setup, but they are not a hidden business-state fixture. Step 6 is always a separate confirmation because DRAFT is not ACTIVE. Run, acceptance, completion, adoption and later Baseline activation remain separate actions.

## View states, not new domain states

- `NO_PROJECT`
- `PROJECT_NEEDS_CHARTER`
- `PROJECT_NEEDS_BASELINE_DRAFT`
- `BASELINE_DRAFT_REVIEW`
- `READY_FOR_TASK`
- `TASK_DRAFT_NEEDS_SPEC`
- `TASK_READY`
- `REPOSITORY_DIRTY_BLOCKED` (derived readiness overlay; inspection remains available)

These are derived Renderer view states. They are not persisted entities or domain transitions.

## Input surface

### Project setup

- project name, suggested from the selected repository display name but confirmed by the user;
- optional project description;
- required charter title;
- required charter body/goal.

### Initial Baseline review

- shows repository revision, charter version and DRAFT status;
- activation requires a distinct button/confirmation;
- no automatic activation after creation.

### Task setup

- required task title;
- required description/objective;
- required scope/non-goals text;
- optional target from the active Baseline's NodeVersions;
- at least one acceptance criterion;
- verification method defaults to `MANUAL_REVIEW` but is visible/editable.

Task creation and TaskSpec publication are separate durable calls. The UI may guide them in one form, but a failure after Task creation must resume at `TASK_DRAFT_NEEDS_SPEC`, not create a duplicate Task.

## Failure and resume behavior

- Never attempt compensating deletes; no delete contract exists and durable facts may already be valid.
- After any command failure, rehydrate `project.list`/`project.state` and derive the next missing step.
- Retrying must not create a second charter Node, Baseline or Task when the previous step succeeded. Use returned IDs in the current operation and hydrated facts after restart.
- If more than one plausible incomplete fact exists, stop automatic continuation and show a user choice/details rather than guessing.
- A failed initial Baseline activation leaves the DRAFT visible and retryable.

## Project selection

- If the workspace contains Projects, show a compact Project selector and open the last/first valid selection.
- Creating additional Projects after the first is an Enhancement. v0.2 must support the empty-workspace first Project and switching among existing Projects.

## Ownership

- DS-006 owns typed orchestration, view-state derivation, functional forms using existing UI primitives and interaction tests. It adds no custom visual system.
- UI-003 owns hierarchy, spacing, responsive behavior, language, theme and accessibility polish after DS-006 merges.

## Required tests

- empty workspace → project/charter/baseline DRAFT;
- baseline never auto-activates;
- explicit activation → READY_FOR_TASK;
- task/spec creation → TASK_READY;
- failure after each durable command → refresh/restart resumes at the correct next step without duplication;
- existing multi-project list can select a Project;
- production path never calls demo seed or injects fixture records;
- Run dispatch remains disabled until Workspace, Agent, active Baseline, TaskSpec and FROZEN Snapshot prerequisites are ready.
- dirty repository opens but initial executable Baseline/Run is blocked without automatic stash/reset/commit.

## Non-goals

- importing arbitrary project facts from a repository automatically;
- generating a charter or acceptance criteria with an Agent;
- Project deletion;
- full Project/Node administration;
- additional-Project creation UX;
- automatic TaskSpec rewriting or acceptance.
