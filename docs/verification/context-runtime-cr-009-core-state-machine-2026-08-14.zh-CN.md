# CR-009 — Context Runtime 核心状态机验证（2026-08-14）

## Status

`CORE_STATE_MACHINE_VERIFIED / ADAPTER_DEFERRED`

## Scope

本记录只验证 provider-neutral 核心闭环：

```text
UniverseRevision → ProposedWorkingSet → AdmissionReceipt
→ CommittedWorkingSet → WorkingSetTransition → replay
```

不启动 DeepSeek/Pi provider，不改 Agent loop，不改默认产品运行路径。

## Evidence

| Evidence | Result |
|---|---|
| PRESENT → NO_CHANGE → UPDATE → UNAVAILABLE → RECOVER → ABSENT | pass |
| providerVersion 变化、contentHash 不变 | pass；SourceVersionId 保持不变 |
| out-of-order observation | pass；显式拒绝 |
| P0/P1/P2/P3 deterministic selection | pass |
| Proposal 绑定 UniverseRevision | pass |
| newer Universe 对旧 proposal 的 Admission | pass；返回 `STALE` |
| materialization FULL → SUMMARY | pass |
| admission budget rejection | pass；返回 `BUDGET` |
| rejected source 进入 Committed | pass；不会进入 |
| same-version representation change | pass；Transition=`REPLACE` |
| ADD/KEEP/REMOVE/REPLACE replay | pass |
| Universe/Proposal/Receipt/Committed/Transition serialization | pass |
| provider calls | `0` |

## Commands

```bash
pnpm --filter @canvas-agent/context-runtime typecheck
pnpm --filter @canvas-agent/context-runtime test
```

当前结果：5 个 test files、95 个 tests 全部通过。环境 Node `v23.11.0` 低于仓库声明的 Node 24 要求；这不是本轮失败，但 Node 24 是后续 release gate 的重跑条件。

全仓 `pnpm check` 的 format/lint/typecheck 也通过；全仓测试随后在既有 persistence 包失败，错误为 Node v23 下 Drizzle node-sqlite 的 `stmt.setReturnArrays is not a function`。该失败未进入 Context Runtime 核心路径，本轮不修改 persistence。

## Deferred boundary

DeepSeek/Pi adapter、实际 model-visible request reconstruction、旧 shadow planner 全量迁移列为后续任务。它们属于增强/未来方向，不是本轮核心闭环的必要条件；在核心 contract 未经审阅前，不应让 Harness 反向决定 Runtime schema。
