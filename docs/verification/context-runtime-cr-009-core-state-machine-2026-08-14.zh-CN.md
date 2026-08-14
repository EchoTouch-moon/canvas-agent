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
| stale Receipt cross-revision round-trip | pass；Proposal=V1、admission Universe=V2 可序列化重建 |
| PRESENT admission evidence | pass；记录 `FRESH / OBSERVED_CURRENT` |
| UNAVAILABLE + last-good admission evidence | pass；记录 `LAST_GOOD / LAST_GOOD_FALLBACK` |
| AdmissionReceipt proposal/representation version binding | pass；篡改序列化会被拒绝 |
| materialization FULL → SUMMARY | pass |
| admission budget rejection | pass；返回 `BUDGET` |
| rejected source 进入 Committed | pass；不会进入 |
| same-version representation change | pass；Transition=`REPLACE` |
| ADD/KEEP/REMOVE/REPLACE replay | pass |
| Universe/Proposal/Receipt/Committed/Transition serialization | pass |
| content-addressed ID integrity | pass；Universe/Proposal/Receipt/Committed/Transition 五类 forged-ID regression 均拒绝 |
| provider calls | `0` |

## Commands

```bash
env PATH="/opt/homebrew/opt/node@24/bin:$PATH" pnpm --filter @canvas-agent/context-runtime typecheck
env PATH="/opt/homebrew/opt/node@24/bin:$PATH" pnpm --filter @canvas-agent/context-runtime test
env PATH="/opt/homebrew/opt/node@24/bin:$PATH" pnpm --filter @canvas-agent/pi-context-integration typecheck
env PATH="/opt/homebrew/opt/node@24/bin:$PATH" pnpm --filter @canvas-agent/pi-context-integration test
env PATH="/opt/homebrew/opt/node@24/bin:$PATH" pnpm check
```

Node `v24.15.0` clean evidence：Context Runtime 5 个 test files、98 个 tests；Pi context integration 3 个 test files、62 个 tests；root `pnpm check` 的 format/lint/typecheck、全仓 tests 和 build 全部通过。此前 Node 23 下的 persistence/Drizzle 错误未在 Node 24 重现。远端 CI / review checks 仍待 push 后由 GitHub 执行。

## Deferred boundary

严格 C1-C8 golden input/expected fixtures、DeepSeek/Pi adapter、实际 model-visible request reconstruction、旧 shadow planner 全量迁移列为后续任务。它们属于增强/未来方向，不是本轮核心闭环的必要条件；在核心 contract 未经审阅前，不应让 Harness 反向决定 Runtime schema。
