# Context Runtime v0.3 实施报告（2026-08-14）

## 结论

本轮已把当前版本最小核心闭环落成：

```text
UniverseRevision
  → ProposedWorkingSet
  → AdmissionReceipt
  → CommittedWorkingSet
  → WorkingSetTransition / replay
```

旧的 shadow `ContextUniverseRevision` / `ContextWorkingSet` API 保持兼容，新的四边界契约以 provider-neutral 模块独立加入，避免破坏已有 benchmark 和 Pi smoke。

## 本轮实现

- `packages/context-runtime/src/universe/revision.ts`
  - `PRESENT / ABSENT / UNAVAILABLE` 状态机；
  - `observedVersionId / admittedVersionId / lastGoodVersionId` 分离；
  - `providerVersion` 与 `contentHash` 分离；
  - providerVersion 变化但 contentHash 不变时复用 SourceVersionId；
  - out-of-order observation 拒绝；不可变 map、logical hash 与序列化 round-trip。
- `packages/context-runtime/src/planning/proposed-working-set.ts`、`planner.ts`
  - P0-P3 确定性选择；
  - reason 可解释；
  - Proposal 绑定创建时 UniverseRevision；
  - Planner 预算只负责候选选择，仍不代表模型已收到上下文。
- `packages/context-runtime/src/admission/`
  - 在后继 Universe 上检查版本新鲜度；
  - `PRESENT + matching` 记录 `FRESH / OBSERVED_CURRENT`，`UNAVAILABLE + last-good` 记录 `LAST_GOOD / LAST_GOOD_FALLBACK`，`ABSENT` 不可 admission；
  - 支持 representation materialization（测试中将 B 从 FULL 变成 SUMMARY）；
  - 在 Admission 层执行 token budget；
  - 记录 `ADMITTED / REJECTED / DEFERRED`、实际 representation、rendered hash 与 adapter identity。
  - Receipt 构造时校验 proposal version 与 representation source-version binding；
  - Receipt 反序列化显式接收 admission-time UniverseRevision，支持旧 Proposal 在新 Universe 上 admission 后的跨 revision round-trip；
- `packages/context-runtime/src/working-set/committed-working-set.ts`
  - 只从 `ADMITTED` outcome 建立 committed state；
  - rejected/deferred 内容不会进入 Committed；
  - 支持从 proposal + receipt 重建。
- `packages/context-runtime/src/transition/transition.ts`
  - 第一版只实现 `ADD / KEEP / REMOVE / REPLACE`；
  - action 携带前后 entry 与目标 metadata；
  - `applyWorkingSetTransition(previous, transition)` 校验前置状态和目标 logical hash。
- `packages/context-runtime/corpus/`
  - 固定 C1-C8 零 provider-call executable core corpus v0 manifest；当前仍是 metadata registry + executable assertions，不宣称已具备完整 golden input/expected fixtures；
  - 可执行断言位于 `packages/context-runtime/tests/context-runtime-core.test.ts`。

本轮 hardening 还为 UniverseRevision、ProposedWorkingSet、AdmissionReceipt、
CommittedWorkingSet 和 WorkingSetTransition 收紧了 content-addressed ID：
反序列化时伪造 ID 会被拒绝，并由 table-driven regression 覆盖五类 artifact。

## 需求分类与本轮边界

| 分类 | 项目 | 本轮决定 |
|---|---|---|
| 核心功能 | CR-003 contract freeze | 已实现 |
| 核心功能 | CR-004 Universe reconcile/version semantics | 已实现 |
| 核心功能 | CR-006 Admission + Committed | 已实现 |
| 核心功能 | CR-007 Transition/replay | 已实现 |
| 核心功能 | CR-009 C1-C8 executable core corpus v0 | 已实现，provider calls = 0；严格 golden fixtures 列为 P1 |
| 增强功能 | 把既有旧 `planWorkingSet` 全量迁移到新 Proposal pipeline | 暂缓；会扩大既有 shadow benchmark 的回归面，当前两套 schema 并存更容易审计 |
| 增强功能 | 旧 shadow API 迁移 | 当前标记为 `COMPATIBILITY_ONLY / NO_NEW_FEATURES`；待 adapter parity 与 request reconstruction evidence 完成后再设迁移退出点 |
| 未来方向 | DeepSeek/Pi active adapter、request reconstruction gate、Pi parity | 暂缓；计划本身将 Harness 适配置于核心状态机之后，且本轮尚无必要的 provider 执行授权 |
| 灵感仓库 | embedding、复杂 relevance/graph、LLM Planner、长期记忆、Canvas UI、多 Harness 全面适配 | 不实现；它们不能证明当前四边界闭环正确 |

## 验证

已通过：

```text
env PATH="/opt/homebrew/opt/node@24/bin:$PATH" pnpm --filter @canvas-agent/context-runtime typecheck
env PATH="/opt/homebrew/opt/node@24/bin:$PATH" pnpm --filter @canvas-agent/context-runtime test
env PATH="/opt/homebrew/opt/node@24/bin:$PATH" pnpm --filter @canvas-agent/pi-context-integration typecheck
env PATH="/opt/homebrew/opt/node@24/bin:$PATH" pnpm --filter @canvas-agent/pi-context-integration test
env PATH="/opt/homebrew/opt/node@24/bin:$PATH" pnpm check
```

Node 24 clean evidence（`v24.15.0`）已通过：

- Context Runtime typecheck；5 个 test files、98 个 tests；
- Pi context integration typecheck；3 个 test files、62 个 tests；
- root `pnpm check`：format、lint、typecheck、全仓 tests、build 全部通过；其中 persistence 68 tests 通过。

之前 Node 23 下出现的 `stmt.setReturnArrays is not a function` 未在 Node 24 重现；本轮没有扩大修改到 persistence。远端 CI / review checks 仍需在本分支推送后由 GitHub 执行。

## 下一步建议

跨 revision Receipt round-trip 已补齐；本地验证满足 Core Contract freeze 条件，待远端 review checks 完成后进入下一阶段。下一阶段唯一主线是开一个 P1 adapter 任务，把 `CommittedWorkingSet` 翻译到 Pi/DeepSeek 的 pre-step seam，并增加 request reconstruction evidence；该任务不应反向修改 Planner 或 Universe 的核心语义。
