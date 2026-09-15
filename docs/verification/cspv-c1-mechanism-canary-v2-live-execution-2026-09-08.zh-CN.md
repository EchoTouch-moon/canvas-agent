# C1 机制 Canary V2 真实执行（LIVE）：CANARY_STOP（第二次）

日期：2026-09-08。执行提交：`dc75f1138e6c3726c4fa22df9e65cd6591bdfeca`（本地分支 `codex/c1-v4-offline-followup`，未推送、无远端 CI）。
Study identity：`c1-mechanism-20260908-2d05cb78`。合同：`C1_MECHANISM_CANARY_V2`，SHA-256 `a8363cf7c882f41dde2ebe7058625ddf51357a1b108bddff5a13b0d870a9a259`。
Provider：Step Plan / `step-3.7-flash`，无 fallback。性质：受控机制诊断，**不是** V4 恢复、64-leg 补跑或任务效用实验。
前序：[V1 执行报告](cspv-c1-mechanism-canary-live-execution-2026-09-08.zh-CN.md)（同为 CANARY_STOP）。

## 授权链

- V2 [冻结计划](../plan/cspv-mechanism-canary-v2-2026-09-08.zh-CN.md) → `authorization.pending.json`（保留不可变）→
  owner 于 2026-09-08 对话中显式批准"再试一次" → `authorization.authorized.json`（绑定上述 studyId / executionRevision / contractSha256）。
- 身份在执行前于 Git common directory 永久登记，本次执行后已消耗，不恢复、不重试、不复用。
- 本授权仅覆盖 V2 本次执行；C1 64-leg 正式实验 V3 授权仍为 NO_GO。

## 执行结果

| 项目 | 值 |
| --- | --- |
| 状态 | FAIL / `CANARY_STOP`（terminal，retired） |
| 真实 Provider 调用 | 2（networkRequests=2，fakeResponses=0） |
| Leg | NATIVE 已执行（FAIL）；RUNTIME 未执行（冻结规则：Native 失败则不执行） |
| 读取 | 1 次成功 `read README.md`（合同要求恰好 2 次） |
| 诊断标记 | COBALT-17 匹配（answerMatched=true） |
| Provider 报告用量 | 输入 1160 / 输出 88 / 合计 1248 tokens（PROVIDER_REPORTED） |
| 缓存观测 | 第 1 次请求 cacheRead=320；第 2 次 cacheRead=512（REPORTED） |

### 失败原因（逐门判定）

与 V1 完全同形：terminal outcome 正常（第 2 次响应 COMPLETE）、标记正确、
但**仍只读取一次**——V2 提示（给第二次读取赋予"文件可能已变化"的具体目的，并明确禁止提前作答）
没有改变该模型的行为。门触发停止，Runtime 未启动。

## 两次真实尝试得出的结论边界

在 step-3.7-flash 上、bootstrap 已含 README 内容的诊断结构下，两种提示策略（V1 直接指令、
V2 目的驱动 + 显式禁止提前作答）**都未能诱导第二次独立读取**。这说明：

1. 该诊断的"重复读取"前置条件**无法仅靠提示工程在该模型上形成**；机制问题
   （真实 Provider 上重复旧来源能否被移除并持续保持移除）**仍未被回答**。
2. 这本身是真实证据：在该 harness/模型组合上，模型倾向于把已见过的文件内容视为已知，
   重复读取触发率可能极低——duplicate-read 策略在此类诊断形态下的自然触发机会存疑。
3. 两次执行各自完成全链路（授权→身份→执行→账本→停止），checkpoint 与 callAccounting
   无缺口对账；不提供任何任务效能或成本结论。

超出上述范围（例如"策略在自然任务中无用"或"换提示一定无效"）均为过度推断。

## 证据与对账

原始证据（ignored）：`research/context-benchmarks/reports/mechanism-canary-v2-live-20260908/c1-mechanism-20260908-2d05cb78/`。
checkpoint 序列：2×OUTBOUND_PERMITTED、2×RESPONSE_RECEIVED、1×TOOL_EXECUTION_RECORDED、2×RESPONSE_RECORDED；
permitsWithoutRecordedResponse=0。凭据仅从进程环境读取，未输出、未持久化。

## 计数口径

全程=已确认 checkpoint：2 许可 / 2 响应 / 1 工具执行。已完成 leg：1（NATIVE，任务失败但 leg 完整关闭）。
未执行 leg：1（RUNTIME）。未完成 leg：0。

## 后续选项（需 owner 决定，不自动执行）

1. **接受并归档**：重复读取条件在该模型上不可诱导，机制问题保持未知；把 duplicate-read 策略的
   真实触发率问题转交观察性研究（在自然任务轨迹中统计重复读取出现频率），而非继续烧真实调用。
2. **重新设计诊断（V3）**：不再依赖模型自发重读，改由 harness 构造重复（例如两个不同路径相同内容、
   或在两次读取之间注入"文件已更新"事件）。这是新合同、新身份、新授权，且需先出冻结设计评审。
3. 无论哪项，C1 64-leg 正式实验授权状态不变（仍 NO_GO），需独立授权流程。
