# Cross-computer task board

The remote repository is the coordination point. Implementers exchange reviewed commits, never uncommitted folders. The lead architect owns merge ordering and boundary review.

## Completed milestone — Product MVP v0.2

DeepSeek was the primary implementer. Luna completed one consolidated visual task after backend and state contracts were stable.

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
|     6 | DeepSeek V4 Flash | [DS-007 RC gates](deepseek/DS-007-release-candidate-gates.md)               | `agent/deepseek-ds-007-product-mvp-rc`      | ✅ MERGED — PR #13 | `main@38820ec`                    |

DS-007 is LEAD APPROVED and merged through PR #13 at `main@38820ec`. Node 24 source checks, the credential-free macOS RC suite, packaged repository and Agent selection, authenticated Codex proof, restart/adoption evidence and the production dependency audit all passed. Product MVP v0.2 is complete for local/internal unsigned use.

## Current release gates

```text
DS-003 ✅ + DS-004 ✅ + DS-005 ✅ + DS-006 ✅ + UI-003 ✅ + DS-007 ✅
DS-007 merged → architect RC decision ✅
Product MVP v0.2 → COMPLETE (local/internal unsigned distribution)
```

No Checkpoint/Resume, Canvas, second Agent adapter or external signed-distribution packet starts automatically. The user's revised post-v0.2 direction must pass a new scope decision first.

## Current milestone — Context Runtime v0.3 research

Context Runtime v0.3 is now the active research milestone. PR #12 established the bounded research architecture. CR-001 / DS-008 merged (PR #14), CR-002 / DS-009 merged (PR #16), and CR-003A / DS-010 merged (PR #18). DS-011 / Repository Observer evidence is ready for architecture review (branch `agent/deepseek-ds-011-repository-observer`, 618 tests green, real temporary-Git smoke EXECUTED).

| Order | Owner             | Packet                                                                                         | Branch                                               | Status                         | Start gate                                  |
| ----: | ----------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------ | ------------------------------------------- |
|     0 | Lead architect    | PROPOSAL-030 Context Source / Source State / Context Universe                                   | —                                                    | PROPOSED — CR-002 evidence pending | CR-002/CR-003 evidence before contract freeze |
|     0 | Lead architect    | PROPOSAL-031 Context Working Set / Planner / Decision                                           | —                                                    | PROPOSED — CR-003 evidence pending | CR-002 acceptance before CR-003            |
|     1 | DeepSeek V4 Flash | [DS-008 Pi Context Shadow Observation](deepseek/DS-008-pi-context-shadow-observation.md)         | `agent/deepseek-ds-008-pi-context-shadow`            | ✅ ACCEPTED / MERGED — PR #14 | —                                           |
|     2 | DeepSeek V4 Flash | [DS-009 Context Source Attribution + Shadow Universe](deepseek/DS-009-context-source-universe-shadow.md) | `agent/deepseek-ds-009-context-source-universe-shadow` | ✅ ACCEPTED / MERGED — PR #16 | CR-001 accepted + packet merged + user authorized |
|     3 | DeepSeek V4 Flash | [DS-010 Shadow Working Set Planner](deepseek/DS-010-shadow-working-set-planner.md)               | `agent/deepseek-ds-010-shadow-working-set-planner`   | ✅ ACCEPTED / MERGED — PR #18 | CR-002 accepted + packet merged + user authorized |
|     4 | DeepSeek V4 Flash | [DS-011 Repository Observer](deepseek/DS-011-repository-observer.md)                             | `agent/deepseek-ds-011-repository-observer`          | EVIDENCE READY — awaiting architecture review | CR-003A accepted + packet merged + user authorized |

CR-001 accepted evidence: `docs/verification/context-runtime-cr-001-pi-shadow.md`. The final accepted implementation observes Pi at the semantic pre-LLM `context` boundary, returns messages unchanged, keeps `context-runtime` Agent/model neutral, records metadata-only semantic fingerprints, scopes estimates to `agent-messages-pre-provider`, and passed the full GitHub CI suite before PR #14 merged.

Research gate:

```text
Product MVP v0.2 closeout ✅
                 +
PR #12 Context Runtime research baseline merged ✅
                 +
DS-008 / CR-001 Pi model-call Shadow Observation ✅ ACCEPTED / MERGED
                 |
                 v
DS-009 / CR-002 Source Attribution + Shadow Universe
   observation + modeling only  ✅ ACCEPTED / MERGED
                 |
                 v
DS-010 / CR-003A Shadow Working Set Planner kernel
   deterministic Shadow planning only (no rewrite)  ✅ ACCEPTED / MERGED
                 |
                 v
DS-011 / Repository Observer
   authoritative world-state observation (no policy)  EVIDENCE READY
                 |
                 v
architect reviews repository truth / revision binding / AVAILABLE-ABSENT-UNAVAILABLE evidence
                 |
                 +--> file-aware CR-003B requires DS-011 acceptance
                 |
                 +--> CR-004 Active Rewrite is NOT authorized
```

DS-009 must preserve the distinction `AgentMessage[] observation != ContextSource[]`. It may introduce experimental observed-element, attribution, source-reconciliation and Shadow Universe structures, but it may not rewrite Pi context, implement Working Set decisions, change production persistence, modify v0.2 Snapshot/ExecutionRequest contracts, or start OpenCode/Codex integration.

The DS-009 implementation branch must be created from reviewed `main` after this task packet lands. Do not branch implementation work from this task-packet branch or the old DS-008 branch.

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
