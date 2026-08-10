# Cross-computer task board

The remote repository is the coordination point. Implementers exchange reviewed commits, never uncommitted folders. The lead architect owns merge ordering and boundary review.

## Active milestone — Product MVP v0.2 closeout

DeepSeek is the primary implementer. Luna receives one consolidated visual task after backend and state contracts are stable.

| Order | Owner             | Packet                                                                      | Branch                                      | Status             | Merge dependency                  |
| ----: | ----------------- | --------------------------------------------------------------------------- | ------------------------------------------- | ------------------ | --------------------------------- |
|     0 | Lead architect    | PROPOSAL-027 Workspace Runtime                                              | —                                           | ✅ approved        | —                                 |
|     0 | Lead architect    | PROPOSAL-027A Workspace Command Contract                                    | —                                           | ✅ approved        | —                                 |
|     0 | Lead architect    | PROPOSAL-028 Local CLI Adapter v1                                           | —                                           | ✅ approved        | —                                 |
|     0 | Lead architect    | PROPOSAL-028A ExecutionRequest v2 Context Bundle                            | —                                           | ✅ approved        | —                                 |
|     0 | Lead architect    | PROPOSAL-028B Local Agent Runtime Discovery                                 | —                                           | ✅ approved        | —                                 |
|     0 | Lead architect    | PROPOSAL-028C Agent Readiness Command Contract                              | —                                           | ✅ approved        | —                                 |
|     0 | Lead architect    | PROPOSAL-029 First Workspace Bootstrap Flow                                 | —                                           | ✅ approved        | —                                 |
|     1 | DeepSeek V4 Flash | [DS-003 release reliability](deepseek/DS-003-release-reliability.md)        | `agent/deepseek-ds-003-release-reliability` | ✅ MERGED — PR #7  | `main@7adc20a`                    |
|     2 | DeepSeek V4 Flash | [DS-004 workspace runtime](deepseek/DS-004-workspace-runtime.md)            | `agent/deepseek-ds-004-workspace-runtime`   | ✅ MERGED — PR #8  | `main@7cbaf18`                    |
|     3 | DeepSeek V4 Flash | [DS-005 local CLI adapter](deepseek/DS-005-local-cli-adapter.md)            | `agent/deepseek-ds-005-local-cli-adapter`   | ✅ MERGED — PR #9  | `main@3459d6d`                    |
|     4 | DeepSeek V4 Flash | [DS-006 Live client state/onboarding](deepseek/DS-006-live-client-state.md) | `agent/deepseek-ds-006-live-client-state`   | ✅ MERGED — PR #10 | `main@19c0690`                    |
|     5 | GPT-5.6 Luna      | [UI-003 Live-first product shell](luna/UI-003-live-first-product-shell.md)  | `agent/luna-ui-003-live-first-shell`        | ✅ MERGED — PR #11 | `main@97b9c78`                    |
|     6 | DeepSeek V4 Flash | [DS-007 RC gates](deepseek/DS-007-release-candidate-gates.md)               | `agent/deepseek-ds-007-product-mvp-rc`      | READY              | UI-003 ✅ merged                  |

UI-003 is merged through PR #11 at `main@97b9c787`. DS-007 is now the only Product MVP v0.2 implementation packet remaining before the lead architect's RC decision.

## Current release gates

```text
DS-003 ✅ + DS-004 ✅ + DS-005 ✅ + DS-006 ✅ + UI-003 ✅
        |
        v
DS-007 (READY)
        |
        v
lead architect Product MVP v0.2 RC decision
```

No Checkpoint/Resume, Canvas or second Agent adapter implementation packet may start during this milestone without a new scope decision.

## Next milestone — Context Runtime v0.3 research

The next milestone is architecture/research driven. Its purpose is to validate Context Runtime with real model-call data before freezing new persistence or public contracts.

| Order | Owner             | Packet                                                                                 | Branch                                    | Status                     | Start gate                                      |
| ----: | ----------------- | -------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------- | ----------------------------------------------- |
|     0 | Lead architect    | PROPOSAL-030 Context Source / Source State / Context Universe                           | —                                         | PROPOSED in PR #12         | architecture review                             |
|     0 | Lead architect    | PROPOSAL-031 Context Working Set / Planner / Decision                                   | —                                         | PROPOSED in PR #12         | architecture review                             |
|     1 | DeepSeek V4 Flash | [DS-008 Pi Context Shadow Observation](deepseek/DS-008-pi-context-shadow-observation.md) | `agent/deepseek-ds-008-pi-context-shadow` | ASSIGNED / BLOCKED BY GATE | PR #12 merged + lead v0.2 RC research go-ahead |

Research gate:

```text
PR #12 Context Runtime architecture reviewed/merged
                 +
lead architect closes v0.2 RC gate and authorizes v0.3 research
                 |
                 v
DS-008 — CR-001 Pi model-call Shadow Observation
                 |
                 v
architect reviews real Pi evidence
                 |
                 +--> refine CR-002 observation / Universe model
                 |
                 +--> only then authorize CR-003 Shadow Planner
```

DS-008 is deliberately observation-only. It may scaffold a provider-neutral experimental `context-runtime` package and a Pi-specific integration package, but it may not rewrite active model context, change production persistence, modify v0.2 Snapshot/ExecutionRequest contracts, or start OpenCode/Codex integration.

The implementation branch for DS-008 must be created from reviewed `main` only after both start-gate conditions are satisfied. Do not branch implementation work from PR #12 itself.

## Completed foundation

| Owner             | Task                           | Branch                                 | Integrated   |
| ----------------- | ------------------------------ | -------------------------------------- | ------------ |
| DeepSeek V4 Flash | DS-001 persistence foundation  | `agent/deepseek-ds-001-persistence`    | ✅ `50d4c1f` |
| DeepSeek V4 Flash | DS-002 isolated Worker runtime | `agent/deepseek-ds-002-worker-runtime` | ✅ `2bf86e8` |
| GPT-5.6 Luna      | UI-001 UI foundation           | `agent/luna-ui-001-foundation`         | ✅ `c54e15c` |
| GPT-5.6 Luna      | UI-002 core flow prototype     | `agent/luna-ui-002-core-flow`          | ✅ `79ad0a5` |

Phase 1–4 integration work is already in `main`; `docs/PROGRESS.md` records the engineering-loop baseline.

## Start protocol

1. Pull reviewed `main`; confirm a clean tree.
2. Read `AGENTS.md`, the master plan, required proposals and the assigned packet.
3. Create the packet's exact branch.
4. Before a public contract/security/database deviation, stop and submit a short proposal.
5. Run packet-specific checks and `pnpm check` before handoff.
6. Push the branch and request architecture review; do not merge another computer's branch locally.

## Handoff contract

Every implementer returns:

1. commit SHA and branch name;
2. modified file list;
3. short implementation explanation;
4. exact commands run and results;
5. acceptance-criterion evidence;
6. unresolved questions and risks;
7. explicit disclosure of any scope deviation;
8. confirmation that files outside the task whitelist were not modified.

The lead architect, not the implementer, changes task status to merged or declares the milestone complete.
