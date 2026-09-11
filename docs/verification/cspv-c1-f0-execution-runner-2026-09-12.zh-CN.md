# F0 Native-only Execution Runner 验证记录

日期：2026-09-12（Asia/Shanghai）

状态：`IMPLEMENTED / CREDENTIAL_FREE_STATE_MACHINE_PASS / READY_FOR_INDEPENDENT_REVIEW`

本记录对应已冻结的 `C1_F0_EXECUTION_FEASIBILITY_V1` 合同。它验证执行编排与证据边界，不授权新的
Provider 访问，也不把 credential-free 替身当作 F0 可行性结果。

## 最终绑定

```text
contractId              = C1_F0_EXECUTION_FEASIBILITY_V1
runContractSha256       = a96c8856859b52d2a5d286a5f7f2c7f21702e3bd0b9b0d372fd7a50b044fdc59
codeRevision            = e70653cf4beaaf269ba8ce11c0ca5a2f99668e10
executionSurfaceHash    = 4b4a09031190b64e9f2a0ad2d5838cd12715b958b33b6817937ad9890ef1696f
providerConfigHash      = bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a
```

`executionSurfaceHash` 只覆盖 F0 runner 及其 headless Runtime、Provider preparation、fixture/tool 与核心
workspace 依赖；Electron、文档和 UI 不在 F0 executable surface 内。`codeRevision` 是最后一个修改该 surface
的提交，因此合同绑定更新不会反向改变 executable revision。

## 实现边界

- 固定两个 task、每个 16 个 run、总计 32 个 Native-only run，顺序为预声明的确定性交替序列。
- 一个 study 只 claim 一个 fresh `studyId`；每个 `runId` 原子 claim，失败 run 不 retry、resume 或 reuse。
- 普通 task failure、单 run budget exhaustion 和 tool error 保留在分母；共享合同、身份、证据或基础设施错误才
  终止 study。
- model-visible observation 只来自 prompt、fixture 中性 `README.md` 和真实 tool loop；expected writable paths、
  objective/regression oracle、reference fixture、removal ground truth 与历史 prevalence 不进入执行上下文。
- 执行 sandbox 清理后，post-run adjudicator 在临时副本中运行 objective/regression oracle；durable artifact 只保存
  状态、计数、hash 和结构化诊断，不保存 assistant 内容、原始 tool arguments、provider payload 或 credential。
- 默认 credential-free source 只验证 transport/tool/checkpoint 编排，不声称模型完成任务；真实 F0 仍需新的
  independent review、fresh owner authorization 与独立的 Provider execution。

## 已验证回归

Node 24 下 `c1-f0-execution-runner.test.ts` 的 5 项回归通过，覆盖：

1. 合同读取、32-run 计划、task 分层与唯一 identity；
2. 单侧 95% Clopper–Pearson 边界；
3. precision / feasibility 分层裁决；
4. 完整 32-run credential-free 编排、7 项 artifact、oracle firewall 和 raw-payload 检查；
5. 单次普通失败仍保留在分母并继续后续 run。

此外，已有 E0 final live binding 回归在同一工作树保持全绿；F0 runner 未改变 E0 execution surface 或历史绑定。

## 当前裁定

```text
F0 implementation        PASS / STATE_MACHINE_ONLY
F0 live Provider          NO_GO
F0 owner authorization   NO_GO
F0 feasibility result    NOT MEASURED
Independent review       REQUIRED
```
