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
  - 支持 representation materialization（测试中将 B 从 FULL 变成 SUMMARY）；
  - 在 Admission 层执行 token budget；
  - 记录 `ADMITTED / REJECTED / DEFERRED`、实际 representation、rendered hash 与 adapter identity。
- `packages/context-runtime/src/working-set/committed-working-set.ts`
  - 只从 `ADMITTED` outcome 建立 committed state；
  - rejected/deferred 内容不会进入 Committed；
  - 支持从 proposal + receipt 重建。
- `packages/context-runtime/src/transition/transition.ts`
  - 第一版只实现 `ADD / KEEP / REMOVE / REPLACE`；
  - action 携带前后 entry 与目标 metadata；
  - `applyWorkingSetTransition(previous, transition)` 校验前置状态和目标 logical hash。
- `packages/context-runtime/corpus/`
  - 固定 C1-C8 零 provider-call manifest；
  - 可执行断言位于 `packages/context-runtime/tests/context-runtime-core.test.ts`。

## 需求分类与本轮边界

| 分类 | 项目 | 本轮决定 |
|---|---|---|
| 核心功能 | CR-003 contract freeze | 已实现 |
| 核心功能 | CR-004 Universe reconcile/version semantics | 已实现 |
| 核心功能 | CR-006 Admission + Committed | 已实现 |
| 核心功能 | CR-007 Transition/replay | 已实现 |
| 核心功能 | CR-009 C1-C8 golden corpus | 已实现，provider calls = 0 |
| 增强功能 | 把既有旧 `planWorkingSet` 全量迁移到新 Proposal pipeline | 暂缓；会扩大既有 shadow benchmark 的回归面，当前两套 schema 并存更容易审计 |
| 未来方向 | DeepSeek/Pi active adapter、request reconstruction gate、Pi parity | 暂缓；计划本身将 Harness 适配置于核心状态机之后，且本轮尚无必要的 provider 执行授权 |
| 灵感仓库 | embedding、复杂 relevance/graph、LLM Planner、长期记忆、Canvas UI、多 Harness 全面适配 | 不实现；它们不能证明当前四边界闭环正确 |

## 验证

已通过：

```text
pnpm --filter @canvas-agent/context-runtime typecheck
pnpm --filter @canvas-agent/context-runtime test
```

结果：`5 test files passed, 95 tests passed`。同时保留了原有 context-runtime 86 个测试；新增核心测试覆盖 Universe 长链、providerVersion 快路径、stale admission、summary materialization、budget rejection、committed rebuild、representation replacement、ADD/KEEP/REMOVE/REPLACE replay 和序列化。

`pnpm` 提示当前环境 Node `v23.11.0`，而仓库声明范围为 `>=24.0.0 <25`；本轮测试仍通过，但完整发布门禁应在 Node 24 环境重跑。

全仓 `pnpm check` 的 format、lint、typecheck 均通过；随后在既有 `packages/persistence` 测试中因 Node v23 下 Drizzle node-sqlite 报 `stmt.setReturnArrays is not a function` 失败。该失败不在本轮 Context Runtime 代码路径内，因此没有扩大修改到 persistence。

## 下一步建议

先审阅并冻结本报告所述四边界 API，再单独开一个 P1 adapter 任务，把 `CommittedWorkingSet` 翻译到 Pi/DeepSeek 的 pre-step seam，并增加 request reconstruction evidence。该任务不应反向修改 Planner 或 Universe 的核心语义。
