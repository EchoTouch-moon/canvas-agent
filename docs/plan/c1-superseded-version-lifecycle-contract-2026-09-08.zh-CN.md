# SUPERSEDED_VERSION Lifecycle Contract（设计 v1，冻结候选）

日期：2026-09-08。状态：设计已冻结；§11 验证路径第 1–2 步已完成
（`src/c1-superseded-version-policy.ts` + 20 项定向单测 + 驱动级假源机制验证各就各位，
见提交 `086fd0a` 及后续）。未授权任何真实执行。
承接：[Prevalence Study](../research/c1-superseded-version-prevalence-2026-09-08.zh-CN.md)（自然出现率精确下界 84.2%）、
[duplicate-read 观察报告](../research/c1-duplicate-read-observability-2026-09-08.zh-CN.md)、机制 Canary V1–V3 执行报告。
本文件定义的不是启发式压缩规则，而是 **Context Runtime 的生命周期语义**：
什么情况下一个 Context Element 可以被 Runtime 正式宣告为 SUPERSEDED，以及这个状态赋予 Runtime 什么权限。

## 1. 状态机（Working Set 内）

```text
CURRENT                      元素描述其来源的当前版本
   │
   │ 触发合同（§3）全部满足
   ▼
SUPERSEDED                   元素描述的来源版本已被新版本取代；描述已死版本
   │
   │ admission policy 选择（§5）
   ▼
EVICTED                      从 Working Set 移除；Universe 中不可变保留（§7）
```

EVICTED 是 Working Set 概念，**不是删除**：Universe 永远保留原始元素与其 provenance。
Storage Context ≠ Active Context 的原则不变。

## 2. 被管对象

模型可见历史中的 `read` tool-call / tool-result 对（以下简称"读取对"）。
移除单位是**对**（协议原子性）：toolCall 与其 toolResult 必须同时移除；
assistant 消息含多个 toolCall 时只移除目标对，消息其余部分不动。

## 3. 触发合同（五条，AND；任一不满足 → UNKNOWN → 不动作）

| # | 条件 | 运行时可观测依据 |
| --- | --- | --- |
| 1 | **Exact path identity** | read 参数与 edit/write 参数的 path 逐字节一致 |
| 2 | **Successful mutation execution** | 该 edit/write 的 tool result 为 SUCCESS |
| 3 | **Before-version known** | 读取对的 result 内容可得，fingerprint(v1) = sha256(result text) |
| 4 | **After-version observable** | 组合时可通过版本探针（sandbox/仓库观察）取得 P 当前内容指纹 |
| 5 | **Version fingerprint changed** | fingerprint(v2) ≠ fingerprint(v1)（no-op edit 不触发，保守正确） |

任一条件不可判定 → 该读取对状态为 **UNKNOWN**，保持现状，**不猜、不删**。
这是与 prevalence 离线工具的本质区别：正式 policy 不得使用腿级推断。

## 4. 禁止输入（ground-truth 泄漏清单）

Lifecycle policy 在任何执行模式下**不得读取**：

`expectedWritablePaths`、`changedPaths`（sandbox 差异核定结果）、任务 manifest、
fixture 定义、oracle 及其输出、任务标注（relevant/distractor sources）、评审或报告产物。

允许输入只有：模型可见消息流（tool-call/result 对及其内容）、工具执行结果状态、
版本探针返回的当前内容指纹。探针实现必须对所有臂一致，且不得向模型暴露探针本身。

## 5. SUPERSEDED 授予什么权限

**Eviction eligibility，不是 obligation。**

- SUPERSEDED 只使元素**有资格**被移除；是否移除由 admission policy 决定
  （protected evidence、pin、budget、诊断模式均可保留元素，决定本身被归因）。
- 保护规则沿用现有约定：错误/不透明/混合内容、歧义 ID、受保护证据链不移除。
- 移除沿用既有 carried-removal 机制：绑定原 transition、准确消息指纹、reasonCodes
  （`SUPERSEDED`）与 sourceVersionId；拒绝内容漂移与单边恢复。

## 6. V1 语义：纯 evict（刻意最纯）

下一轮 outbound composition 中：REMOVE 陈旧读取对；**不注入 P@v2 内容，不注入任何变更标记**。

理由（treatment integrity）：Native vs Runtime 的唯一差异必须是"陈旧证据是否在场"。
注入新内容或标记会同时引入 refresh / hint 两个变量，效果归因将不可分。
模型在双臂中都看到了 edit 请求与结果，具备自行维护 v1+Δ 的信息——这与双臂一致。

proactive re-read / refresh 注入如未来需要，属独立合同、独立授权、独立归因。

## 7. REHYDRATE 语义

- v1 在 Universe 中不可变保留，永不物理删除。
- 默认 **rehydrate-ineligible**：v1 描述已死版本，回到 Working Set 只会重新引入版本不一致。
- 例外：模型或任务显式表现出回退意图（如 revert 类操作）时，允许以显式决策 rehydrate，
  必须携带 reasonCode、原 eviction transition 引用与指纹，且本身进入决策证据。
  第一版不实现该例外路径，只保留语义位置；无例外路径时 rehydrate 请求一律 UNKNOWN 处理。

## 8. UNKNOWN 语义

UNKNOWN 是显式状态而非缺席：当 §3 任一条件不可判定，记录 `LIFECYCLE_UNKNOWN` 诊断
（不含内容，仅计数与原因码），元素保持 CURRENT-in-effect。**宁可保留陈旧，不可误删当前。**

## 9. Actual Intervention Dose（组合时测量，替代 source-byte proxy）

每次 outbound composition 记录：

```text
eligibleElements / selectedElements / removedElements
tokensBeforeComposition / tokensAfterComposition
removedBytes / removedTokens / removedTokenRatio
carriedRemovalCount / rehydrateCount
activeStaleElements（当前并发陈旧数）
lifecycleUnknownCount（按原因码分桶）
```

汇聚成 leg 级 Intervention Dose：移除元素数、移除 token、压缩比、持续长度、并发峰值。
这为 dose → cost → quality 研究提供自变量，而非"Runtime 开/关"二值。

## 10. 不变量（任一违反即停止下一请求/下一臂）

- 协议连续性：tool-call/result 成对原子移除；provider-bound source keys 与消息指纹逐调用可核验。
- 无泄漏：§4 禁止输入不得出现在 policy 依赖中（定向测试扫描）。
- 保护链：受保护证据零移除。
- 账本完整：RESPONSE_RECEIVED / TOOL_EXECUTION_RECORDED / callAccounting 全程可对账。
- 身份：单次身份，terminal 不恢复、不重试、不复用。
- Native 失败不执行 Runtime；任何失败即停。

## 11. 验证路径（顺序固定，live 需新授权）

1. ✅ 定向单测：五条触发合同逐条正/反例；no-op edit；UNKNOWN 桶；协议连续性；保护规则（20 项，`086fd0a`）。
2. ✅ 假源机制验证：真实驱动 + 真实沙箱 edit 的脚本化"read→edit→后续请求"轨迹，
   Runtime 首个编辑后请求 REMOVE SUPERSEDED ×2 并持续保持（`a860304`）。
3. **历史 replay 能力（已拆分，3a 完成）**：
   - 3a ✅ Historical compatibility adjudication：判定历史 V4 durable evidence 是否具备正式 replay 输入。
     结论 `NOT_EXECUTABLE_FROM_DURABLE_EVIDENCE / EVIDENCE_CAPABILITY_GAP`——metadata-only 合同主动
     禁止持久化消息流与原始参数；禁止以 manifest/changedPaths/oracle 补齐。84.2% 保留为
     ground-truth-assisted observational baseline。详见
     [裁定报告](../verification/cspv-c1-superseded-version-replay-capability-2026-09-08.zh-CN.md)。
   - 3b ✅ Fingerprint-only replay evidence 合同落地：`C1_LIFECYCLE_REPLAY_RECORD`（存输入不存判定），
     判定可重算并与执行期移除对账；唯一失败模式 CONTRACT_CONFLICT，UNKNOWN 不计为错误
     （8 项定向测试）。今后 replay 验收采用逐腿 reconciliation：

     | 正式 replay | 观察基线 | 结论 |
     | --- | --- | --- |
     | SUPERSEDED | stale | MATCH |
     | NOT_SUPERSEDED / NOT_CANDIDATE | no stale | MATCH |
     | UNKNOWN | 任意 | EXPLAINED_GAP（保守正确性，非错误） |
     | SUPERSEDED | no stale | **CONTRACT_CONFLICT** |
     | NOT_SUPERSEDED | stale 且五条件可观测 | **CONTRACT_CONFLICT** |
4. 机制 canary live（新合同、新身份、**新 owner 授权**）：真实 Provider 上验证纯 evict，
   并在执行期持久化 fingerprint-only replay evidence，使首次真实干预全链条可 replay。
5. Effectiveness A/B 设计评审：只在预选存在机会的 task 上配对，Dose 为自变量。
   在此之前 **64-leg 维持 NO_GO**。

## 12. 明确不做（本合同范围外）

proactive re-read / refresh 注入；STALE_OBSERVATION 与 RESOLVED_EVIDENCE（后续独立合同）；
BUDGET_PRESSURE stress 实验；duplicate-read（保留为 correctness 资产）；
任何任务效能、质量或成本结论。
