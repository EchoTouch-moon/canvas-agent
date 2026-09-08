# C1 机制 Canary 真实执行（LIVE）：CANARY_STOP

日期：2026-09-08。执行提交：`f82f447ab064f563c2ce887b95cd7e8d040c321d`（本地分支 `codex/c1-v4-offline-followup`，未推送、无远端 CI）。
Study identity：`c1-mechanism-20260908-312fad65`。合同：`C1_MECHANISM_CANARY_V1`，SHA-256 `eac271d5b01ebb6b3bfe5d899737acf21cc878b95ab9ea2ad72b56892c2a250d`。
Provider：Step Plan / `step-3.7-flash`，无 fallback。性质：受控机制诊断，**不是** V4 恢复、64-leg 补跑或任务效用实验。

## 授权链

- `authorization.pending.json`（PENDING，保留不可变）→ owner 于 2026-09-08 对话中显式批准 →
  `authorization.authorized.json`（decision=AUTHORIZED，绑定上述 studyId / executionRevision / contractSha256）。
- 该授权仅覆盖本次 Canary；C1 64-leg 正式实验的 V3 授权仍为 NO_GO，互不影响。
- 身份在执行前于 Git common directory 永久登记（`consumed: true, resume: FORBIDDEN`），本次执行后已消耗，不恢复、不重试、不复用。

## 执行结果

| 项目 | 值 |
| --- | --- |
| 状态 | FAIL / `CANARY_STOP`（terminal，retired） |
| 真实 Provider 调用 | 2（networkRequests=2，fakeResponses=0） |
| Leg | NATIVE 已执行（FAIL）；RUNTIME 未执行（冻结规则：Native 失败则不执行） |
| 读取 | 1 次成功 `read README.md`（合同要求恰好 2 次） |
| 诊断标记 | COBALT-17 匹配（answerMatched=true） |
| Provider 报告用量 | 输入 1050 / 输出 197 / 合计 1247 tokens（PROVIDER_REPORTED） |

### 失败原因（逐门判定）

Native leg 三次门中两项通过：terminal outcome 正常（第 2 次响应 COMPLETE）、诊断标记正确。
未通过项：**恰好两次成功读取**——模型在第 1 次请求读取一次后，第 2 次请求直接作答完成，
没有执行第二次独立读取。门触发停止，Runtime 未启动。

这是冻结计划中明确允许的结果：「模型是否按提示产生单独读取不预先假定；未形成合格干预同样是允许的失败结果。」
因此机制问题（真实 Provider 上重复旧来源能否被移除并持续保持移除）**本次未得到回答**：
诊断连前置条件（同一内容的两次独立读取）都未形成。不据此得出任何关于策略、模型或成本的结论。

## 证据与对账

原始证据（ignored）：`research/context-benchmarks/reports/mechanism-canary-live-20260908/c1-mechanism-20260908-312fad65/`
（`report.json`、`checkpoints.jsonl`、`binding.json`、`legs/…/leg-manifest.json`，权限 0600/0700）。

- checkpoint 序列与 callAccounting 完全一致：2×OUTBOUND_PERMITTED、2×RESPONSE_RECEIVED、
  1×TOOL_EXECUTION_RECORDED、2×RESPONSE_RECORDED；permitsWithoutRecordedResponse=0，无静默缺口。
- 失败路径账本按设计工作：FAIL leg 的全程序列完整落盘后才停止；无 UNKNOWN_AFTER_WRITE_FAILURE。
- 每次请求均绑定 executionRevision、providerConfigHash、模型可见语义上下文指纹与系统/工具结构指纹；
  第 2 次请求 `cacheReadTokens` 为 REPORTED=384（该 Provider 报告的前缀缓存命中），第 1 次为 0。
  这是本项目首个真实 Provider 的缓存观测点，仅作记录，不作成本或效果推断。
- 凭据从 `/Users/v/Documents/V/.env` 注入进程环境，仅在本地门与身份登记之后读取；未输出、未持久化、未进入证据文件。

## 计数口径

全程=已确认 checkpoint：2 许可 / 2 响应 / 1 工具执行。已完成 leg：1（NATIVE，任务失败但 leg 完整关闭）。
未执行 leg：1（RUNTIME）。未完成 leg：0。不使用 legacy completed-only 口径冒充全程口径。

## 后续（需新的 owner 决定，不自动执行）

1. **接受本次结论**：诊断条件在真实模型行为下未形成，机制问题保持未知；本次证据链演练本身已验证
   授权→身份→执行→账本→停止全链路在真实 Provider 上成立。
2. **修订合同再试**：若要再试，需要新合同版本（例如强化提示以诱导两次独立读取）、新 studyId、
   新 executionRevision 绑定和**新的显式授权**。当前身份已永久消耗，不能在同一绑定下重跑。
3. 本报告不改变 C1 正式实验的授权状态；任何 64-leg 决策仍需独立授权流程。
