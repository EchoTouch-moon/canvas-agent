# Canvas Agent

Canvas Agent is a local-first project control system for developers who build software with AI coding agents. It keeps project facts, task specifications, frozen execution context, code revisions and execution evidence traceable across repeated agent runs.

The first product loop is deliberately narrow:

```text
Project facts → Baseline → Task → ContextSnapshot → Run
→ isolated Worker → Diff/Test/Artifact review → Baseline Draft
```

The design source of truth is [`canvas_agent_design_baseline_v1.1/00_README.md`](canvas_agent_design_baseline_v1.1/00_README.md). Generated UI reference images are visual direction only; they are not product facts.

## Development status

The repository contains the architectural kernel and collaboration foundation for the MVP:

- Electron + React + TypeScript desktop shell;
- framework-independent domain states and invariant checks;
- versioned runtime contracts for IPC and `ExecutionRequest`;
- Base UI + shadcn/ui Rhea-compatible UI foundation;
- reserved persistence and Worker package boundaries;
- model-specific task packets for two developers working on separate computers.

## Prerequisites

- Node.js `24.14.0` (see `.node-version` / `.nvmrc`)
- pnpm `11.9.0` or compatible pnpm 11 release
- Git 2.40+

## Start

```bash
pnpm install
pnpm dev
```

Run the complete local gate before pushing:

```bash
pnpm check
```

## Workspace map

```text
apps/desktop                 Electron main, preload and React renderer
packages/domain              Framework-free domain language and invariants
packages/contracts           Runtime-validated IPC and Worker contracts
packages/persistence         SQLite adapter boundary (DeepSeek task)
packages/worker-runtime      Isolated worker boundary (DeepSeek task)
docs/architecture            Accepted implementation decisions
docs/tasks                   Cross-computer execution packets
canvas_agent_design_baseline_v1.1
                             Product and UI design source of truth
```

## Collaboration

Read [`AGENTS.md`](AGENTS.md), [`CONTRIBUTING.md`](CONTRIBUTING.md), and the assigned task packet before editing. Each agent works on its own branch and must not modify another agent's owned files without an explicit architecture review.
