# Canvas Agent

[![CI](https://github.com/EchoTouch-moon/canvas-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/EchoTouch-moon/canvas-agent/actions/workflows/ci.yml)

Canvas Agent is a local-first project control system for developers who build software with AI coding agents. It keeps project facts, task specifications, frozen execution context, code revisions and execution evidence traceable across repeated agent runs.

The first engineering loop is deliberately narrow:

```text
Project facts → Baseline → Task → ContextSnapshot → Run
→ isolated Worker → Diff/Test/Artifact review → Baseline Draft
```

The design source of truth is [`canvas_agent_design_baseline_v1.1/00_README.md`](canvas_agent_design_baseline_v1.1/00_README.md). Generated UI reference images are visual direction only; they are not product facts.

## Open-source status

Canvas Agent is publicly available for community development. It is an experimental local-first desktop application: the current MVP targets local, unsigned use, and signed/notarized external distribution is intentionally a separate release decision.

The repository is public. Maintainers should use the [open-source readiness checklist](docs/open-source-readiness.md) for ongoing contributor hygiene, sensitive-data review and future release decisions.

## Development status

The engineering core loop is implemented end to end: SQLite project state, immutable execution contracts, an isolated Utility Process Worker, durable Run/Artifact evidence, explicit acceptance and Task completion, recoverable Git adoption, candidate Baseline creation and explicit activation.

**Product MVP v0.2 is complete for local/internal unsigned use.** Packaged migration reliability, native repository and Agent selection, immutable ExecutionRequest v2 context, the production Codex CLI adapter, resumable first-workspace onboarding, the Live-first shell and repeatable RC gates are merged. External signed/notarized distribution remains a separate release decision. See the [operator guide](docs/operator/product-mvp-v0.2.md) and the [release checklist](docs/operator/product-mvp-v0.2-release-checklist.md).

The post-v0.2 research line [Context Runtime v0.3](docs/architecture/context-runtime-v0.3-direction.md) verified its provider-neutral observation and selection infrastructure credential-free, then on 2026-08-27 executed the bounded Shadow lifecycle canary live (four scenarios PASS under strict Step Plan binding, 51 provider-call records) and adjudicated Gate D `PASS`, allowing CR-004 offline Stage 0 preparation. No Active rewrite is authorized, the value hypothesis (dynamic working-set selection improves task reliability or context efficiency) remains not established, and the Working Set Runtime stays out of the product path. See the [final synthesis](docs/verification/context-runtime-v0.3-final-synthesis-2026-08-27.md) and the [Gate D record](docs/verification/context-runtime-cr004-gate-d-adjudication-2026-08-27.md); the research packages remain research-only and are not part of the default product path.

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

The repository CI keeps the full source gate on the standard `ubuntu-latest` runner and the credential-free Electron RC gate on the standard `macos-latest` runner. No larger runner is configured.

## Workspace map

```text
apps/desktop                 Electron main, preload and React renderer
packages/domain              Framework-free domain language and invariants
packages/contracts           Runtime-validated IPC and Worker contracts
packages/persistence         SQLite project-state implementation
packages/worker-runtime      Isolated Worker and Agent adapter boundary
packages/context-runtime     Provider-neutral context selection research runtime
packages/repository-observer Authoritative repository content observer
packages/pi-context-integration
                             Pi agent shadow-observation integration
docs/architecture            Accepted implementation decisions
docs/operator                Local operator and release guidance
docs/verification             Reproducible engineering evidence
docs/product                 Product scope register and decisions
docs/plan                    Execution plans for scoped work items
docs/research                Context runtime research overlays and analysis
research/context-benchmarks  Native + Shadow benchmark fixtures and harness
canvas_agent_design_baseline_v1.1
                             Product and UI design source of truth
```

## Collaboration

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before editing. Keep changes focused, work on a branch, and do not modify another contributor's owned files without an explicit review.

For public contributions, also read the [Code of Conduct](CODE_OF_CONDUCT.md) and [Security Policy](SECURITY.md). Please keep credentials, personal data and machine-specific paths out of commits, logs and issue reports.

## License

Canvas Agent is licensed under the [Apache License 2.0](LICENSE). Copyright 2026 The Canvas Agent contributors.
