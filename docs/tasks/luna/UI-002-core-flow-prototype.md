# UI-002: Build the MUSICDB core-flow prototype

## Task owner

GPT-5.6 Luna — visual task. Start after UI-001 is merged.

## Task goal

Implement the typed, mock-driven screens that demonstrate the MVP navigation flow from Dashboard to Task to Context Composer to Run result and Artifact/Baseline review.

## Background and context

This task validates information architecture and interaction, not backend completeness. Fixture data must model domain distinctions faithfully: Run outcome is separate from Task status; accepting an Artifact is separate from completing a Task; completing a Task is separate from activating a Baseline.

## Current code foundation

- UI-001 foundation and component gallery
- domain types from `@canvas-agent/domain`
- runtime desktop health API exposed as `window.canvasAgent`
- local PNG visual references

## Implementation scope

You may modify only `apps/desktop/src/renderer/**`.

Implement routes and mock interactions for:

1. Project Dashboard focused on exceptions and next actions;
2. Project Outline and a representative Node Workspace;
3. Task Workspace with immutable TaskSpecVersion and acceptance criteria;
4. Context Composer with candidates, selected items, authority, priority, tokens, conflicts, preview and freeze confirmation;
5. simplified Run result/timeline with status/outcome split and expandable test failure;
6. Artifact Review with Diff/Test/Summary tabs and explicit accept/reject/request-changes/apply distinctions;
7. Baseline Draft review after the accepted task result.

Use a typed fixture service and command reducer so UI state transitions can later be replaced by IPC without rewriting components.

## Prohibited scope

- No database, Git, process, network or raw IPC access.
- No full Canvas/React Flow, complete RunEvent catalog, Checkpoint recovery or multi-user collaboration.
- No automatic freeze/accept/complete/activate chain; every formal transition is a separate explicit user action.
- No page-local duplicated state colors or improvised base controls.

## Acceptance criteria

1. **Given** the Dashboard, **when** the active MUSICDB task is opened, **then** its objective, non-goals, targets, criteria, current Snapshot and Runs are distinguishable.
2. **Given** Context Composer, **when** an optional item is added or removed, **then** selected count, order and Token budget update; required items cannot be removed.
3. **Given** a conflict or P0 overflow, **when** Freeze is requested, **then** a specific blocking message appears and the fixture Snapshot stays Draft.
4. **Given** a frozen Snapshot, **then** selected items become read-only and starting a Run is a separate action.
5. **Given** a succeeded Run, **then** the Task remains `WAITING_REVIEW` until acceptance evaluation and completion are explicitly performed.
6. **Given** Task completion, **then** a Baseline remains Draft until a separate activation confirmation.

## Required verification

Run the desktop lint, typecheck, component tests and build. Add interaction tests for criteria 2–6 and capture the five core flow states at 1440×1080.

## Output requirements

Return the standard handoff contract plus a screen-state map showing every explicit formal transition.
