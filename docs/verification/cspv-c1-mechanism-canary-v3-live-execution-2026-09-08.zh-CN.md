# C1 机制 Canary V3 真实执行（LIVE）：CANARY_STOP（第三次）

日期：2026-09-08。执行提交：`935d8faf5c30c8fa66d69eb4bd711285acbb655a`（本地分支 `codex/c1-v4-offline-followup`，未推送、无远端 CI）。
Study identity：`c1-mechanism-20260908-4fa2ce0e`。合同：`C1_MECHANISM_CANARY_V3`，SHA-256 `54bc812ef2593f450c7938204a642d2686ee448a7936361e4d01c733756d2240`。
Provider：Step Plan / `step-3.7-flash`，无 fallback。性质：受控机制诊断，**不是** V4 恢复、64-leg 补跑或任务效用实验。
前序：[V1](cspv-c1-mechanism-canary-live-execution-2026-09-08.zh-CN.md)、[V2](cspv-c1-mechanism-canary-v2-live-execution-2026-09-08.zh-CN.md)（同为 CANARY_STOP）。

## 授权链

- V3 [冻结计划](../plan/cspv-mechanism-canary-v3-2026-09-08.zh-CN.md) → `authorization.pending.json`（保留不可变）→
  owner 于 2026-09-08 对话中显式批准 → `authorization.authorized.json`。
- 身份已永久登记并消耗，不恢复、不重试、不复用。C1 64-leg 正式实验授权状态不变（仍 NO_GO）。

## 执行结果

| 项目 | 值 |
| --- | --- |
| 状态 | FAIL / `CANARY_STOP`（terminal，retired） |
| 真实 Provider 调用 | 1（networkRequests=1，fakeResponses=0） |
| Leg | NATIVE 已执行（FAIL）；RUNTIME 未执行（冻结规则） |
| 读取 | **0 次**（V3 门要求 1–2 次） |
| 诊断标记 | COBALT-17 匹配（answerMatched=true，标记取自 bootstrap 已有内容） |
| Provider 报告用量 | 输入 479 / 输出 98 / 合计 577 tokens（PROVIDER_REPORTED） |

### 失败原因

模型在第 1 次请求直接 COMPLETE 作答，**没有发起任何读取**。内容在 bootstrap 中已可见，
模型判定读取冗余。三次真实执行呈现一致模式：模型总是比提示要求少读一次
（V1/V2 要求两次→读一次；V3 要求一次→读零次）。Runtime 臂三次均未获得执行机会。

## 三次真实执行的结论边界

1. 在该模型与该诊断形态下，"模型自发产生同路径同内容重复读取"**无法通过提示诱导**；
   重复读取策略的真实触发条件在此形态下不成立。机制问题（真实 Provider 上的移除与持续保持）
   仍未被回答——三次停止全部发生在 Native 门，Runtime 臂从未在真实 Provider 上运行。
2. 这本身是有价值的负结果：设计机制诊断时，"让模型制造重复"不能依赖提示，
   重复条件必须由 harness 构造或从自然轨迹观察。
3. 三次执行全链路（授权→身份→执行→账本→停止）均完整，checkpoint 与 callAccounting 无缺口；
   总真实调用 5 次（2+2+1），远在各次预算内。不提供任何效能或成本结论。

## 证据与对账

原始证据（ignored）：`research/context-benchmarks/reports/mechanism-canary-v3-live-20260908/c1-mechanism-20260908-4fa2ce0e/`。
checkpoint：1×OUTBOUND_PERMITTED、1×RESPONSE_RECEIVED、1×RESPONSE_RECORDED；permitsWithoutRecordedResponse=0。
凭据仅从进程环境读取，未输出、未持久化。

## 计数口径

全程=已确认 checkpoint：1 许可 / 1 响应 / 0 工具执行。已完成 leg：1（NATIVE，任务失败但 leg 完整关闭）。
未执行 leg：1（RUNTIME）。未完成 leg：0。

## 后续选项（需 owner 决定，不自动执行）

1. **接受负结果并转向观察性研究**：在真实/自然 Agent 轨迹中统计同路径同内容重复读取的实际出现率；
   若自然出现率极低，duplicate-read 类策略的优先级应重排。不再消耗真实调用。
2. **V4：harness 构造重复**（新合同、新身份、新授权，需先出冻结设计评审）：不再依赖模型行为，
   例如 bootstrap 直接携带两对同路径同内容读取（模型读 0 次也成立），机制验证点变为
   Runtime 第 1 次真实请求即移除陈旧重复对。这把被测对象从"模型行为"纯化为"Runtime 在真实请求上的
   上下文管理"，但也意味着诊断不再覆盖模型侧触发率问题。
3. 无论哪项，C1 64-leg 正式实验授权状态不变（仍 NO_GO）。
