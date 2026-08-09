# Canvas Agent Product MVP v0.2 — Closeout Execution Baseline

- **Status:** APPROVED FOR TASKING
- **Decision owner:** Lead architect
- **Date:** 2026-08-09
- **Supersedes for next-work ordering:** `docs/PROJECT_EXECUTION_PLAN.md`
- **Verified code baseline:** `main@26ef285`

## 1. Executive decision

Canvas Agent has completed its engineering core loop, but it is not yet a product MVP. The next release will not begin with Checkpoint/Resume, Canvas, multi-worker scheduling or a second Agent provider. It will close the three gaps between a working architecture and a usable product:

1. a packaged application must start reliably;
2. a user must choose a real repository without environment variables;
3. a real local Agent CLI must execute the immutable request inside the existing isolated worktree boundary.

Implementation is DeepSeek-heavy. Luna receives one consolidated visual task only after the runtime and renderer state contracts are merged.

## 2. Current truth

### Complete and retained

- Domain separation among Node, Task, Run, Artifact, AcceptanceEvaluation, RepositoryRevision and Baseline.
- Immutable TaskSpecVersion, ContextSnapshot, ExecutionRequest and Baseline behavior.
- SQLite-backed project state and Git-backed code state.
- Sandboxed Renderer, narrow validated Preload bridge and Main-owned privileged operations.
- Utility Process Worker, immutable request validation, revision checks and isolated worktrees.
- Durable Run evidence, explicit acceptance, explicit completion, recoverable artifact adoption and explicit Baseline activation.
- Real Electron E2E covering the existing fixture-backed live workspace, restart recovery and result adoption.

### Release blockers

| ID | Blocker | Evidence | Severity |
|---|---|---|---|
| B-01 | Unit suite is not deterministic across process clocks | 244/246 tests; two coordinator failures | P0 |
| B-02 | Packaged app cannot locate Drizzle migrations | unpacked app cold start returns migration `ENOENT` | P0 |
| B-03 | Repository bootstrap is environment-only | `CANVAS_AGENT_REPO` required | P0 |
| B-04 | Execution is still fixture-backed | `WorkerService` constructs `FixtureAgentAdapter` | P0 |
| B-05 | Product opens in Fixture mode | `App.tsx` defaults to fixture | P1 |
| B-06 | CI misses packaged and Electron live gates | workflow runs only `pnpm check` | P1 |

## 3. Product MVP definition

Product MVP v0.2 is complete only when a user can perform this sequence from a packaged macOS application:

```text
Cold start
  → choose an existing local Git repository
  → create/open a project and task
  → publish TaskSpec and freeze ContextSnapshot
  → dispatch one real local Agent CLI
  → inspect Run events, patch, checks and summary
  → submit acceptance evaluation
  → explicitly complete Task
  → explicitly adopt the selected patch
  → create a DRAFT candidate Baseline
  → explicitly activate that Baseline
  → restart and observe the durable final state
```

No step may depend on a hidden environment variable, developer-only fixture switch, direct database editing or a command issued from DevTools.

## 4. Scope gate

### Core — enters v0.2

- deterministic clock boundary shared by Main and Worker execution validation;
- packaged migration resources and cold-start smoke;
- Main-owned native repository selection;
- one active workspace at a time, with repository-scoped state/runtime directories;
- robust workspace close/switch lifecycle;
- provider-agnostic local CLI process boundary;
- one production adapter, recommended first target: installed Codex CLI;
- Live-first UI and product-language workspace states;
- resumable first-workspace Project → charter NodeVersion → initial DRAFT Baseline → explicit activation → Task/TaskSpec onboarding;
- automated real-agent, restart, adoption and packaged gates;
- truthful operator and contributor documentation.

### Enhancement — recorded, not a prerequisite

- second Agent adapter (Claude is the likely next candidate after measured gaps);
- large renderer module decomposition beyond the seams needed by UI-003;
- bundle analysis and dependency trimming;
- advanced Agent profile editor;
- diagnostic log viewer and export;
- recent-workspace management beyond last-opened plus “choose another.”

### Future direction — named trigger required

- Checkpoint/Resume: begin only after real executions produce at least three classified interruption cases and an approved continuation contract.
- Canvas/Graph: begin only after workbench use shows that hierarchy and status views cannot answer a recurring coordination question.
- multi-provider routing: begin after the first adapter is stable and a second provider exposes measured contract differences.
- multiple concurrent Workers: begin after queue latency or isolation throughput is observed as a bottleneck.

### Idea repository

- autonomous multi-Agent organization;
- cloud execution and shared remote state;
- extension marketplace;
- multi-user collaboration and permissions.

## 5. Frozen architecture direction

### 5.1 Workspace runtime

The Main process owns a stable `WorkspaceRuntimeManager`. The command router depends on this manager rather than a startup-time nullable `WorkspaceService` and `ExecutionCoordinator`.

Runtime states:

```text
CLOSED → OPENING → READY → CLOSING → CLOSED
            └────────────→ ERROR
ERROR  → OPENING | CLOSED
```

Rules:

- `READY` contains one coherent tuple: canonical repository path, repository-scoped Persistence, WorkspaceService, WorkerHost and ExecutionCoordinator.
- A path is obtained through Electron's native directory dialog. The renderer does not pass an arbitrary absolute path to the open command.
- Main resolves the real path and validates readability, Git worktree status and a valid `HEAD` before any database is opened.
- A dirty repository may open for inspection, but v0.2 blocks Snapshot-to-Run execution and initial executable Baseline setup until the user independently commits/stashes. Canvas Agent never auto-cleans user changes.
- A switch first blocks new dispatch, cancels or waits for active work according to the accepted close policy, disposes the WorkerHost, closes Persistence and only then opens the new tuple.
- An opening failure does not replace the current ready runtime. If there is no current runtime, it produces a typed `ERROR` status with a retry-safe reason code.
- v0.2 allows one active workspace only.

Repository-scoped storage:

```text
userData/
  settings-v1.json
  workspaces/<sha256(canonical-repository-path)>/
    canvas-agent.db
    runtime/
```

`settings-v1.json` is a versioned, Zod-validated application preference file written through temp-file plus atomic rename. It may remember the last repository path; it must not contain credentials. SQLite remains authoritative for project state.

### 5.2 Workspace public surface

The accepted command intent is:

| Command | Input | Result |
|---|---|---|
| `workspace.status` | `{}` | lifecycle state and sanitized active workspace summary |
| `workspace.chooseRepository` | `{}` | opens native picker; returns cancelled or resulting status |
| `workspace.reopenLast` | `{}` | validates and opens the persisted last repository |
| `workspace.close` | `{}` | closes the active runtime and returns status |

`workspace.chooseRepository` accepts no renderer-supplied path. Any future `openRecent` command must accept a Main-issued opaque identifier, not a free-form path.

Status reason codes are stable and user-mappable, including at least: `NOT_SELECTED`, `PICKER_CANCELLED`, `PATH_UNREADABLE`, `NOT_GIT_WORKTREE`, `MISSING_HEAD`, `RUNTIME_NOT_WRITABLE`, `DATABASE_OPEN_FAILED`, `WORKER_DISPOSE_FAILED`, `ACTIVE_RUN_BLOCKS_SWITCH`, `UNKNOWN`.

### 5.3 Local Agent CLI

The Worker selects an `AgentAdapter` from validated execution configuration; production startup never silently falls back to Fixture.

The current `ExecutionRequest v1` carries only `taskSpecVersionId` and `contextSnapshotId`; that was sufficient for a deterministic Fixture but not for a real Agent. v0.2 therefore introduces an immutable `ExecutionRequest v2` Context Bundle. Main reads the already-frozen Snapshot items in canonical position order and embeds their content, authority metadata and hashes in the request. Worker validates every item hash, the bundle hash, total byte bound and the outer request hash before creating the Agent process. Worker never queries SQLite or re-resolves a mutable source.

The bundle contains the Task instruction and selected frozen context, not live database rows or arbitrary Renderer content. Historical v1 records remain parseable; production real-Agent dispatch requires v2.

The provider-neutral runner owns:

- executable resolution and version probe;
- argv-only spawn with `shell: false`;
- worktree cwd confinement;
- stdin/prompt handling without shell interpolation;
- AbortSignal, deadline and process-tree termination;
- bounded stdout/stderr and output truncation markers;
- structured event/result parsing at the Worker trust boundary;
- redaction of known secret-bearing environment keys;
- stable error mapping: unavailable, auth required, invalid output, timeout, cancelled, non-zero exit and policy rejection.

Production must also remove the Phase-2 fixture verification command that checks `docs/phase2.md`. v0.2 performs one Worker-owned universal integrity check after staging the isolated patch: `git diff --cached --check`, invoked through the safe Git runner. Agent-reported commands may be retained as bounded diagnostic evidence, but they are not independent proof. Repository-defined arbitrary verification commands are an Enhancement pending a sandbox and explicit authorization design.

The first adapter is Codex CLI because this verified environment contains `codex-cli 0.146.0`, and its local help exposes non-interactive `codex exec`, JSONL events, an output schema, explicit cwd and sandbox selection. This is an environment-backed recommendation, not a permanent product preference.

Main also owns `AgentRuntimeLocator`. It probes a saved launcher, inherited PATH and platform install locations; if discovery fails, `agent.chooseExecutable {}` opens a native file picker. Renderer never sends an executable path. A versioned `agent-settings-v1.json` stores only the chosen launcher path, never credentials. Readiness/version/auth probes must work in a packaged Finder launch where interactive shell PATH is absent.

The first invocation contract must:

- run inside the already-created isolated worktree;
- use a controlled prompt generated from the immutable ExecutionRequest and materialized snapshot;
- request `workspace-write`, never bypass approval/sandbox protections;
- use non-interactive structured output;
- never pass secrets in argv;
- never grant writable directories outside the isolated worktree;
- treat the resulting Git diff and verification evidence—not the Agent's prose—as authoritative execution output;
- verify that the detached worktree's `HEAD` and branch state did not change; an Agent-authored commit or branch mutation is a policy violation, not a successful patch.
- reject any request whose expected `workingTreePatchHash` is non-null before claim/worktree creation; v0.2 cannot faithfully materialize dirty source state.

The initial production resource profile is 15 minutes, 100 observed tool calls and 1 GiB isolated disk. Timeout/cancel remain hard Worker boundaries. A later profile editor is not part of v0.2.

Claude CLI is an Enhancement candidate after Codex produces stable observation data. There is no automatic provider fallback in v0.2.

### 5.4 Live-first renderer

- Production launches directly into a workspace lifecycle view.
- Fixture gallery is reachable only through an explicit development build flag.
- Renderer state is a pure client of the typed bridge; it does not infer workspace readiness from failed project commands.
- Loading, no-workspace, opening, invalid-workspace, ready, switching, close-blocked, execution-unavailable and read-only states are explicit.
- User-facing primary actions use product language. Internal command names, raw IDs and “REAL IPC” labels may appear only in a secondary developer detail surface.
- Formal transitions remain separate: run success ≠ task completion; pass ≠ apply; applied ≠ baseline activation.
- A fresh repository cannot depend on demo seed. Renderer composes the existing explicit commands to create the first Project, user-authored GOAL/charter NodeVersion, initial DRAFT Baseline, separate activation, Task and TaskSpec. Partial setup rehydrates and resumes without compensating deletes or duplicate facts.

## 6. Work decomposition and ownership

### Wave 0 — architecture freeze

Owner: lead architect.

Deliverables:

- `PROPOSAL-027-product-workspace-runtime.md` accepted;
- `PROPOSAL-027A-workspace-command-contract.md` accepted;
- `PROPOSAL-028-local-cli-adapter-v1.md` accepted;
- `PROPOSAL-028A-execution-request-v2-contract.md` accepted;
- `PROPOSAL-028B-local-agent-runtime-discovery.md` accepted;
- `PROPOSAL-028C-agent-readiness-command-contract.md` accepted;
- exact contract diff reviewed before DS-004/DS-005 changes public schemas;
- ExecutionRequest v2 Context Bundle schema, limits and v1 compatibility frozen;
- task packets and temporary file ownership published.

### Wave 1 — DS-003 Release Reliability

Owner: DeepSeek. No Luna work starts.

Deliverables:

- one authoritative execution clock path, with explicit clocks in tests;
- packaged migrations copied outside asar and resolved from `process.resourcesPath` in packaged mode;
- unsigned local unpack script that never waits for signing credentials;
- packaged cold-start smoke using isolated repository and userData;
- CI split into fast cross-platform checks and a macOS Electron/package gate.

Merge gate: P0 failures B-01 and B-02 closed.

### Wave 2 — DS-004 Workspace Runtime

Owner: DeepSeek under task-scoped architecture delegation.

Deliverables:

- runtime manager and lifecycle tests;
- native picker boundary and accepted command contracts;
- repository-scoped storage;
- last-workspace reopen with safe fallback to no-workspace state;
- active-run switch guard;
- E2E for choose, cancel, invalid repository, reopen and switch.

Merge gate: no environment variable is required for normal startup.

### Wave 3 — DS-005 Real Local Agent

Owner: DeepSeek under task-scoped Worker/Main delegation.

Deliverables:

- provider-neutral local CLI runner and test fixtures;
- Codex CLI adapter and exact version/capability probe;
- immutable, hash-verified ExecutionRequest v2 context materialization from the frozen Snapshot;
- Main-owned executable discovery/native selection and Agent readiness commands;
- production adapter selection with no fixture fallback;
- structured execution evidence and failure taxonomy;
- temp-repository integration test plus one opt-in authenticated live smoke.

Merge gate: a real CLI produces a patch in the isolated worktree and the existing acceptance/adoption chain consumes its evidence without bypasses.

### Wave 4A — DS-006 Renderer Data Integration

Owner: DeepSeek. Scope is non-visual renderer client/state/test files only.

Deliverables:

- workspace client and typed lifecycle model;
- state reducer/hooks for every lifecycle and disabled state;
- removal of production fixture default at the application composition boundary;
- interaction tests using typed API fakes;
- stable component props/slots for Luna.
- functional first-workspace and first-task forms built from existing UI primitives, with resumable partial-failure tests;

Merge gate: UI-003 can be implemented without touching contracts, preload, Main or state-machine logic.

### Wave 4B — UI-003 Product Shell

Owner: GPT-5.6 Luna. Starts only after DS-006 is merged.

Deliverables:

- compact Live-first workspace chooser and status shell;
- ready/error/empty/opening/switching visuals;
- user-language action hierarchy and internal-detail de-emphasis;
- light/dark and 1080×720 / 1440×960 visual QA;
- accessibility and keyboard pass.

Merge gate: no fixture control in production, no fake business data in Live mode, no contract or state logic changes.

### Wave 5 — DS-007 Release Candidate Gate

Owner: DeepSeek, with architect final review.

Deliverables:

- non-authenticated deterministic CI gates;
- documented opt-in authenticated Codex smoke;
- packaged cold-start and workspace selection smoke;
- restart durability and full result-adoption regression;
- release checklist, operator troubleshooting and truthful project status.

Merge gate: the acceptance matrix below is green and reviewed.

## 7. Dependency graph

```text
DS-003 + PROPOSAL-027/027A             → DS-004
DS-003 + PROPOSAL-028/028A/028B/028C   → DS-005A
DS-004 + DS-005A             → DS-005 final
DS-004 + DS-005 final + PROPOSAL-029 → DS-006
DS-006                        → UI-003
UI-003                         → DS-007 → architect RC decision
```

DS-003 merges first. DS-005A Worker-only work may proceed beside DS-004, but DS-005 Main/command integration and final review wait for DS-004 to merge. DS-006 begins only after DS-004 and DS-005 are merged. Luna begins only after DS-006 merges.

## 8. Release acceptance matrix

| Gate | Required evidence | Blocking |
|---|---|---|
| Source quality | format, lint, strict typecheck, all unit/integration tests, build | yes |
| Time determinism | expiry/revision tests pass under a frozen shared clock and real clock | yes |
| Package resources | unpacked app locates migrations from packaged resources | yes |
| Cold start | fresh userData + selected temp Git repo reaches READY | yes |
| Workspace safety | cancel/invalid path/open/switch/restart cases are typed and recoverable | yes |
| Dirty repository | opens visibly blocked; no execution/run record/worktree until source is clean | yes |
| Worker isolation | original repo unchanged before explicit `artifact.apply` | yes |
| Real Agent | Codex adapter produces structured result and Git patch in worktree | yes |
| Packaged Agent discovery | Finder-launched app can discover or natively select and validate the Codex launcher | yes |
| Context fidelity | real Agent receives the exact ordered frozen Snapshot bundle; tampering/oversize fails before spawn | yes |
| Patch integrity | detached `HEAD` unchanged and `git diff --cached --check` passes in the isolated worktree | yes |
| Failure behavior | unavailable/auth/timeout/cancel/bad output/non-zero exit are distinguishable | yes |
| Adoption | explicit apply is idempotent and advances RepositoryRevision once | yes |
| Baseline | candidate remains DRAFT until separate activation | yes |
| Persistence | restart preserves run, evidence, evaluation, application and active baseline | yes |
| UI | Live-first, no user-visible fixture switch, all lifecycle states, keyboard usable | yes |
| Security | no `shell: true`, arbitrary renderer paths, secret persistence or widened preload | yes |
| Dependency audit | no known high/critical production vulnerability | yes |
| Signing/notarization | required only for an external-distribution RC, not internal unsigned smoke | decision gate |

## 9. Branch and review protocol

- Branches start from reviewed current `main` and use the task packet's exact name.
- One task, one branch, one owner, one acceptance report.
- DeepSeek may edit cross-owner files only where the task packet explicitly lists them.
- Any new entity, state, public command, IPC shape or database schema not already frozen in the proposals stops implementation and becomes a short proposal.
- Luna never edits contracts, Main, Preload, persistence, Worker or non-visual state logic.
- Every handoff includes SHA, changed files, commands/results, criterion evidence, risks and deviations.
- The lead architect reviews boundary changes before UI polish or release merge.

## 10. Risk controls

| Risk | Control |
|---|---|
| Real CLI changes its output format | version probe, structured parser fixtures, unsupported-version failure |
| Auth state differs across computers | unauthenticated capability test in CI; authenticated smoke opt-in and never a generic PR secret requirement |
| Workspace switch corrupts state | stable runtime manager, explicit lifecycle, dispose tests, no half-open replacement |
| Existing prototype DB is misplaced | no destructive migration; retain legacy DB and document pre-release compatibility decision |
| Package build waits for keychain | unsigned smoke target with signing identity explicitly disabled in that script |
| Renderer refactor expands uncontrollably | DS-006 owns state seams; Luna gets frozen props and visual-only whitelist |
| DeepSeek crosses architecture authority | task-scoped whitelist plus mandatory proposal for any contract deviation |
| “MVP” expands again | scope register classification and named validation triggers |

## 11. Stop conditions

An implementer stops and requests architecture review if any of these becomes necessary:

- a new core entity or database table not named in an accepted proposal;
- renderer access to a filesystem path picker or process API;
- `shell: true`, arbitrary command strings or sandbox bypass flags;
- secret material in ExecutionRequest, SQLite, logs or argv;
- mutating the source repository before `artifact.apply`;
- automatic Task completion, Artifact application or Baseline activation;
- changing another active task's file ownership;
- using Fixture as a production fallback when the real adapter fails.

## 12. Post-v0.2 decision gates

After RC evidence is collected, the lead architect reviews:

1. real run interruption taxonomy → decide whether Checkpoint/Resume becomes Core;
2. adapter-specific gaps → decide whether Claude adapter becomes Enhancement work;
3. user navigation friction → decide whether Canvas/Graph solves a measured problem;
4. bundle/startup metrics → decide whether module split and bundle reduction deserve a dedicated release.
