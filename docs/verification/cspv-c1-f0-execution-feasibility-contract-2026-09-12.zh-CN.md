# F0 Execution Feasibility Contract 冻结准备记录

日期：2026-09-12（Asia/Shanghai）

状态：`NUMERICAL_FREEZE_ACCEPTED / PREPARED_FOR_IMPLEMENTATION / NOT_EXECUTABLE`

本记录对应机器可读合同
[`c1-f0-execution-feasibility-v1.json`](../../research/context-benchmarks/c1/f0/contracts/c1-f0-execution-feasibility-v1.json)。
数值设计承接 #119；本阶段只固化 panel、sample、budget、gate 和 evidence boundary，不创建 executable runner、
study identity 或 owner authorization。

## 固定数值

```text
contractId                = C1_F0_EXECUTION_FEASIBILITY_V1
runContractSha256         = 103166c294aff24724586252b62fe0979456f1d0e3eec43a3225161435f83f5a
taskPanel                 = c1-t1-localized-distractor-v1 + c1-t2-multi-file-migration-v1
runsPerTask               = 16
totalRuns                 = 32
arm                       = NATIVE_ONLY
runtimeIntervention       = DISABLED
confidence                = one-sided 95% Clopper–Pearson exact
perRunBudget              = 24 provider / 96 tool / 600000 ms
studyBudget               = 768 provider / 3072 tool / 19200000 ms
fallback                  = NONE
retry / resume / reuse   = FORBIDDEN
```

F0 的 estimand 是 frozen task panel 上的 Native execution-feasibility distribution，不代表整个 benchmark 的
总体分布。两个 task 的 panel 覆盖 localized 与 multi-file 两个 stratum，但不自动扩展到其余 strata。

## 三层 gate

```text
VALIDITY_GATE
  sharedInvalidatorCount = 0
  bindings valid
  one studyId / unique runIds
  checkpoint ↔ report join complete
  no credential/raw payload leakage

PRECISION_GATE
  16 started runs per frozen task
  both task strata represented
  one-sided 95% confidence rule satisfied
  no post-hoc task/run removal

FEASIBILITY_GATE per task
  lower95(endToEndSuccessRate) >= 0.80
  upper95(budgetExhaustionRate) <= 0.20
  upper95(unrecoveredToolFailureRunRate) <= 0.20
  lower95(oraclePassAmongAdjudicable) >= 0.80
```

其中 `endToEndSuccessRate` 同时要求 terminal complete、objective/regression PASS、evidence complete 和
fixture cleanup；tool error event rate 只作诊断，未恢复工具失败率才进入 gate。

最终裁定：

```text
VALIDITY fail
  → F0_NO_GO

VALIDITY pass + PRECISION fail
  → F0_HOLD / INCONCLUSIVE

VALIDITY + PRECISION pass + FEASIBILITY pass
  → GO_TO_T0_DESIGN

VALIDITY + PRECISION pass + FEASIBILITY fail
  → F0_FEASIBILITY_NO_GO
```

普通 task failure、budget exhaustion 和可恢复的单 run tool failure 保留在分母，不自动阻断其他预定 run；
共享合同、身份、证据或基础设施失效才触发 study invalidator。

## 身份与证据边界

一个 F0 study 只 claim 一个 fresh `studyId`，其下登记 32 个唯一 `runId`。terminal run 不得 retry、resume 或
reuse。执行路径和 model-visible context 不得读取 objective/regression oracle、reference fixture、
expectedWritablePaths、removal ground truth 或历史 prevalence 标签；oracle 只允许在 run 结束且 fixture 清理后
由 post-run adjudicator 读取。

机器可读合同当前保留：

```text
executionBinding.codeRevision       = PENDING_F0_IMPLEMENTATION
executionBinding.executionSurfaceHash = PENDING_F0_IMPLEMENTATION
```

这两个字段必须在 F0 runner implementation 完成后以 clean head 重新绑定并重新计算合同 hash。没有该绑定、独立
review 和新的 owner authorization，F0 仍为 `NO_GO`。

## 下一步

1. 独立 review 本冻结准备记录和机器可读合同；
2. 实现 Native-only F0 runner，保持普通 leg failure 不阻断 study；
3. 重新计算 exact execution revision、surface hash 和 contract hash；
4. 完成 implementation review 后，再形成 fresh owner authorization；
5. F0 `GO_TO_T0_DESIGN` 只解锁 T0 设计，不自动运行 T0/E1。
