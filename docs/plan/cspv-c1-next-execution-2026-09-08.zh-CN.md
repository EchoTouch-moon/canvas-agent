# C1 V4 之后的执行计划

日期：2026-09-08。基线：`cf4b7ea61be784a92bcefec895b2d36888b91172`（PR #104）。
工作分支：`codex/c1-v4-offline-followup`。本轮为本地零 Provider 工作；不是新 Live 授权。

## 研究判断

当前主线是让失败实验可完整解释，并证明正式入口能够产生研究所需的干预。
V4 计划 64 leg、尝试 19、完成 18、终止未完成 1、未执行 45；完成 9/32 pair，
T1 8、T2 1、T3/T4 0。部分证据不足以支持效果结论。
历史的 progressive gate、usage amendment、entrypoint 已存在，不重复实现。

## 本轮执行包 A：离线收口（已完成）

- [x] fetch 核对远端 main 与开放 PR；当前无开放 PR。原工作区停在 PR #53，保留其未提交材料，另建最新基线工作区。
- [x] 对 V4 的 26 个原始文件按 9 月 6 日独立裁定的 SHA-256 清单核验，并复制到持久本地 ignored reports 目录。
- [x] 实现独立、只读、无第三方依赖的 checkpoint 对账工具。输出必须在原件目录之外且不可覆盖既有文件。
- [x] 校验 checkpoint 顺序、请求许可与响应 join、完成 leg、六类明细覆盖与重叠事实；输出全程/完成/未完成三种计数。
- [x] 用合成元数据验证篡改、重复、缺失、跨 study、无许可响应、工具错配及未响应许可；13 项通过。
- [x] 对真实 V4 原件及归档重算，结果一致；更新当前状态索引与验证报告。
- [x] 绑定执行版本定位正式 observation → planning → composition 路径与异常汇总缺口。

交付和复核入口：[本轮验证报告](../verification/cspv-c1-v4-offline-followup-2026-09-08.zh-CN.md)。
该工具是历史快照对账器，不替代 frozen analyzer、实时账单、禁止字段扫描器或 Runtime replay。

## 下一实施包 B：异常结束仍有完整账本（核心修复，已实现并验证）

范围：`c1-live-binding.ts`、`c1-live-study.ts` 及相应 fake Provider 测试。
先设计失败路径的追加式 response/tool 事件与派生汇总，保留已冻结旧证据和 completed leg 语义。

验收必须覆盖：

1. 正常终止和第 24 次恰好终止：完整 response/tool 明细，完成 leg 可计入。
2. 第 24 次仍 CONTINUE：24 次响应均可对账，最终 oracle 为 UNOBSERVED；第 25 次请求和下一 leg 调用均为 0。
3. 请求前、已许可未响应、已响应但工具执行失败、证据持久化失败：各自保留真实可知边界，不把许可计为响应。
4. 旧 manifest 的 completed-only 数字不静默改口径；全程数字另有明确字段与来源。
5. 使用假 transport、假工具或受控 fixture；测试前审查依赖链，不读取 Provider 凭据。

执行结果：增加 RESPONSE_RECEIVED 与逐工具 TOOL_EXECUTION_RECORDED，在失败之前独立落盘；
旧完成子集数字不变，manifest 增加带明确口径的 callAccounting。未收到有效响应、
未确认工具结束与写入失败后的尾部都保留未知。24 次 CONTINUE 的完整账本和禁止下一 leg 已验证。
这不声称写盘失败后仍可知道未确认的物理副作用。

## 后续包 C：正式干预可达性（核心研究设计，受控验证已完成）

现有正式工具 observation 将所有 observed sources 作为 current targets，excluded 为空，
没有自然 lifecycle 信号；planner 使用 1,000,000 的 metadata 估计预算。
先以相同观察轨迹的 Native/Runtime 离线配对确认当前保留行为，再选择一个有明确输入依据的生命周期触发规则。
已执行相同消息输入的受控实验，基线无 REMOVE；重复读取候选在第 2、3 次请求产生移除。
过程中发现并修复 C1 未携带历史移除的问题，复用既有 applyCarriedRemovals，新增指纹核验与恢复边界检查。
候选复用既有 scanDuplicateReads，不读取任务 ground truth；仅曾被纳入或已证明移除的来源可成为排除对象。
受控实验只能证明机制路径；自然轨迹是否有合适机会仍需另外验证。

验收：来源与版本可追溯；不读任务 ground truth；明确区分无机会、未选择、未物化、绑定未改变；
每次移除有原因，恢复维持同源身份，保护项和协议连续性通过。
策略/预算/任务任何变化均作为新设计，不能追改 V4 或复用其 identity。

## 新 Live 的进入条件

B 的失败路径检查和 C 的正式干预验收完成后，再判断新实验要回答可运行性还是自然策略效果。
已将下一项收敛为独立只读 Canary，最多 6 个 Provider 请求，使用纯合成 README；
执行器与假 Provider 流程已准备。详见[机制 Canary 计划](./cspv-mechanism-canary-2026-09-08.zh-CN.md)。
它验证真实请求可用性，不替代新的完整任务效用设计。精确提交绑定完成后，仍须 owner 明确授权。
当前保持暂停新 Live；V4 terminal/retired 不恢复。

UI、更多模型、更大样本与更多策略进入未来候选；它们没有解决本次计数和干预缺口。

本轮实施与验证的汇总见[后续执行报告](../verification/cspv-c1-followup-execution-2026-09-08.zh-CN.md)。
