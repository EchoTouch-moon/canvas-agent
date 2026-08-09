# Cross-computer task board

The remote repository is the coordination point. Implementers exchange reviewed commits, never uncommitted folders. The lead architect owns merge ordering and boundary review.

## Active milestone — Product MVP v0.2 closeout

DeepSeek is the primary implementer. Luna receives one consolidated visual task after backend and state contracts are stable.

| Order | Owner | Packet | Branch | Status | Merge dependency |
|---:|---|---|---|---|---|
| 0 | Lead architect | PROPOSAL-027 Workspace Runtime | — | ✅ approved | — |
| 0 | Lead architect | PROPOSAL-027A Workspace Command Contract | — | ✅ approved | — |
| 0 | Lead architect | PROPOSAL-028 Local CLI Adapter v1 | — | ✅ approved | — |
| 0 | Lead architect | PROPOSAL-028A ExecutionRequest v2 Context Bundle | — | ✅ approved | — |
| 0 | Lead architect | PROPOSAL-028B Local Agent Runtime Discovery | — | ✅ approved | — |
| 0 | Lead architect | PROPOSAL-028C Agent Readiness Command Contract | — | ✅ approved | — |
| 0 | Lead architect | PROPOSAL-029 First Workspace Bootstrap Flow | — | ✅ approved | — |
| 1 | DeepSeek V4 Flash | [DS-003 release reliability](deepseek/DS-003-release-reliability.md) | `agent/deepseek-ds-003-release-reliability` | ✅ MERGED — PR #7 | `main@7adc20a` |
| 2 | DeepSeek V4 Flash | [DS-004 workspace runtime](deepseek/DS-004-workspace-runtime.md) | `agent/deepseek-ds-004-workspace-runtime` | READY | DS-003 merged; PROPOSAL-027/027A approved |
| 3 | DeepSeek V4 Flash | [DS-005 local CLI adapter](deepseek/DS-005-local-cli-adapter.md) | `agent/deepseek-ds-005-local-cli-adapter` | DS-005A READY; DS-005B BLOCKED | DS-005B awaits exact argv/schema fixture review + DS-004 integration |
| 4 | DeepSeek V4 Flash | [DS-006 Live client state/onboarding](deepseek/DS-006-live-client-state.md) | `agent/deepseek-ds-006-live-client-state` | BLOCKED | DS-004 + DS-005 merged |
| 5 | GPT-5.6 Luna | [UI-003 Live-first product shell](luna/UI-003-live-first-product-shell.md) | `agent/luna-ui-003-live-first-shell` | BLOCKED | DS-006 merged |
| 6 | DeepSeek V4 Flash | [DS-007 RC gates](deepseek/DS-007-release-candidate-gates.md) | `agent/deepseek-ds-007-product-mvp-rc` | BLOCKED | all implementation packets merged |

DS-004 and DS-005A Worker work may now begin from reviewed `main@7adc20a`. DS-005B concrete Codex binding still waits for exact argv/schema fixture review; DS-005's Main/command integration and final merge wait for DS-004. DS-006 begins only after DS-004 and DS-005 are merged. DS-006 and UI-003 remain strictly sequential because they divide functional state/forms from final visual ownership.

## Current release gates

```text
DS-003 → DS-004
DS-003 → DS-005A
DS-004 + DS-005A → DS-005 final
DS-004 + DS-005 final → DS-006 → UI-003 → DS-007 → architect RC decision
```

No Checkpoint/Resume, Canvas or second Agent adapter packet may start during this milestone without a new scope decision.

## Completed foundation

| Owner | Task | Branch | Integrated |
|---|---|---|---|
| DeepSeek V4 Flash | DS-001 persistence foundation | `agent/deepseek-ds-001-persistence` | ✅ `50d4c1f` |
| DeepSeek V4 Flash | DS-002 isolated Worker runtime | `agent/deepseek-ds-002-worker-runtime` | ✅ `2bf86e8` |
| GPT-5.6 Luna | UI-001 UI foundation | `agent/luna-ui-001-foundation` | ✅ `c54e15c` |
| GPT-5.6 Luna | UI-002 core flow prototype | `agent/luna-ui-002-core-flow` | ✅ `79ad0a5` |

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
