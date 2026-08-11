# Canvas Agent

Canvas Agent is a local-first project control system for developers who build software with AI coding agents. It keeps project facts, task specifications, frozen execution context, code revisions and execution evidence traceable across repeated agent runs.

The first engineering loop is deliberately narrow:

```text
Project facts → Baseline → Task → ContextSnapshot → Run
→ isolated Worker → Diff/Test/Artifact review → Baseline Draft
```

The design source of truth is [`canvas_agent_design_baseline_v1.1/00_README.md`](canvas_agent_design_baseline_v1.1/00_README.md). Generated UI reference images are visual direction only; they are not product facts.

## Development status

The engineering core loop is implemented end to end: SQLite project state, immutable execution contracts, an isolated Utility Process Worker, durable Run/Artifact evidence, explicit acceptance and Task completion, recoverable Git adoption, candidate Baseline creation and explicit activation.

The current milestone is **Product MVP v0.2 release-candidate review**. Packaged migration reliability, native repository selection, immutable ExecutionRequest v2 context, the production Codex CLI adapter, resumable first-workspace onboarding and the Live-first shell are merged. DS-007 supplies the repeatable RC gates; the lead architect, not automation, makes the final Product MVP decision. See [`docs/PRODUCT_MVP_V0.2_PLAN.md`](docs/PRODUCT_MVP_V0.2_PLAN.md), the [operator guide](docs/operator/product-mvp-v0.2.md) and the [release checklist](docs/operator/product-mvp-v0.2-release-checklist.md).

Normal startup selects or reopens a repository through the Main-owned native picker; it does not require `CANVAS_AGENT_REPO`. Production execution uses the configured Codex CLI and never falls back to Fixture. `CANVAS_AGENT_REPO`, the deterministic fake Codex and picker seams are test/developer boundaries only.

## Prerequisites

- Node.js `24.14.0` (see `.node-version` / `.nvmrc`)
- pnpm `11.9.0` or compatible pnpm 11 release
- Git 2.40+
- macOS for Electron/package RC gates (the source gate remains cross-platform)
- Codex CLI `0.146.x` plus an authenticated local session for the optional real-Agent smoke

## Start

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Run the complete local gate before pushing:

```bash
pnpm check
```

Run the credential-free macOS RC suite (unsigned internal package, workspace lifecycle, complete fake-Codex loop with restart/adoption retry, and packaged cold start):

```bash
pnpm e2e:rc
```

Run the separately reported authenticated smoke only when local account/network/cost assumptions are intentional:

```bash
CANVAS_AGENT_REAL_AGENT_SMOKE=1 pnpm --filter @canvas-agent/desktop e2e:agent
```

The command always writes `apps/desktop/dist/reports/agent-smoke.json`; a disabled smoke is recorded as `skipped`, never as executed. For repository selection, Agent readiness/auth recovery, isolated user data and internal-versus-external distribution details, use the [operator guide](docs/operator/product-mvp-v0.2.md).

## Workspace map

```text
apps/desktop                 Electron main, preload and React renderer
packages/domain              Framework-free domain language and invariants
packages/contracts           Runtime-validated IPC and Worker contracts
packages/persistence         SQLite project-state implementation
packages/worker-runtime      Isolated Worker and Agent adapter boundary
docs/architecture            Accepted implementation decisions
docs/tasks                   Cross-computer execution packets
canvas_agent_design_baseline_v1.1
                             Product and UI design source of truth
```

## Collaboration

Read [`AGENTS.md`](AGENTS.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), and the assigned task packet before editing. Each agent works on its own branch and must not modify another agent's owned files without an explicit architecture review.
