# F0 Execution Feasibility Contract 设计草案

日期：2026-09-11（Asia/Shanghai）

状态：`DRAFT / NOT_EXECUTABLE / NO_PROVIDER`

本文件是 #117 正式研究立场之后的第一个独立研究设计。它不是 E0 补跑授权，也不是 T0/E1 合同；在独立
review、阈值冻结和 fresh owner authorization 之前，不得据此访问 Provider。

## 1. 研究问题

在固定 Provider、model、tool envelope、任务提示和候选调用预算下，独立的 Native agent run 能否稳定完成
任务并通过 objective/regression oracle？

F0 的 estimand 是**预先冻结的 F0 task panel**在固定运行条件下的 Native execution-feasibility distribution，
不自然推广为整个 benchmark 的 feasibility distribution。重点是：

- terminal completion rate；
- budget exhaustion rate；
- tool-error 与 recovery 行为；
- task/oracle completion；
- evidence completeness、unknown rate 和 fixture cleanup truth。

F0 不比较 Native 与 Runtime，不计算 treatment effect，不测 dose，也不判断 SUPERSEDED_VERSION 的自然触发率。

## 2. 与现有证据的关系

E0 的第二次真实运行中，Native leg 13 个 response 后完成，而 Runtime leg 24 个 response 后仍未终止。
这是一条单次、配对未完成的诊断事实，不能作为 F0 的完成率或预算阈值。F0 必须重新使用预先固定的任务、
多个 fresh identity 和独立 run，不把 E0、V4、SV2 或 fake runner 的结果拼入 F0 样本。

V4 的 `≥16/19（84.2%）` 属于 semantic lifecycle opportunity 的 enriched historical prevalence，不是
F0 的执行可行性指标。

## 3. 候选执行面

以下是待冻结的候选配置，不是当前授权：

```yaml
study: F0_EXECUTION_FEASIBILITY_V1
arm: NATIVE_ONLY
runtime_intervention: DISABLED
provider: step-plan
model: step-3.7-flash
fallback: NONE
concurrency: 1
candidate_max_provider_requests_per_run: 24
candidate_max_tool_requests_per_run: 96
candidate_max_wall_clock_ms_per_run: 600000
```

F0 使用与 E0 相同的 provider/model/tool envelope 只是为了测量当前运行条件；任何模型、任务、预算或提示改变
都必须在 F0 freeze review 中重新声明。F0 不读取 Runtime policy，也不写入 lifecycle eligibility、REMOVE
或 Dose 字段作为主要结果。

### Ground-truth firewall

执行路径、model-visible context 和工具执行阶段**不得访问**以下内容：

```text
objective oracle
regression oracle
reference answer / reference fixture
expectedWritablePaths
removalGroundTruth
historical labels or prevalence results
```

冻结的 objective/regression oracle 只能由 post-run adjudicator 在 fixture 已清理、执行已结束之后读取。oracle
结果可以进入 F0 report 和 gate 计算，但不得进入 prompt、provider-bound messages、tool arguments、Runtime policy
或执行时的停止决策。

## 4. 任务与抽样

初始候选任务可从现有 C1 task manifest 中选择，但选择必须在第一条 F0 response 之前冻结，并记录 task、stratum、
fixture、prompt 和 oracle hashes。当前建议至少覆盖两个 distinct task；具体 task set、每个 task 的重复次数和
总样本量待设计评审决定。

每个 task 的重复次数和总样本量必须在第一条 response 前，根据预先声明的决策规则与所需置信区间推导并冻结，
不能在看到结果后调整。每个 F0 study 使用一个 fresh、single-use `studyId`，其下挂载多个独立的 `runId`；
`studyId` 只 claim 一次，所有 `runId` 唯一且永不复用。每个 run 使用：

- 同一 study 下预先登记的唯一 run identity；
- fresh fixture sandbox；
- 完全相同的 Native prompt、provider envelope 和调用边界；
- 独立的 response/evidence 目录；
- 预先登记的运行顺序和停止规则。

任何失败 run 都保留在分母中；不能因为工具错误、预算耗尽或 task difficulty 在事后删除 task 或 run。

## 5. 正交 evidence axes 与 failure taxonomy

F0 不使用一个同时表达终止、任务正确性和证据有效性的 outcome enum。每个 run 必须分别记录四个事实轴，最终
disposition 由这些事实组合得到：

```text
terminationStatus
  TERMINAL_COMPLETE
  TERMINAL_FAILED
  BUDGET_EXHAUSTED
  PROVIDER_BOUNDARY_FAILURE
  TOOL_BOUNDARY_FAILURE
  BLOCKED

oracleStatus
  PASS
  FAIL
  UNKNOWN
  NOT_ADJUDICABLE

evidenceStatus
  COMPLETE
  PARTIAL
  INVALID

diagnostics
  toolErrorCount
  recoveredToolErrorCount
  unrecoveredToolFailure
  providerErrorCount
  responseReceiptCount
  toolRequestCount
  toolExecutionCount
  fixtureCleaned
  changedPathsStatus
```

例如，工具错误后成功恢复、最终 terminal、两个 oracle 都 PASS 的 run 应记录为
`terminationStatus=TERMINAL_COMPLETE`、`oracleStatus=PASS`、`evidenceStatus=COMPLETE`，同时保留
`toolErrorCount>0` 和 `recoveredToolErrorCount>0`；工具错误不是与任务完成互斥的总状态。

最终 `runDisposition` 只能从这些轴派生：

```text
FEASIBILITY_SUCCESS
  := TERMINAL_COMPLETE
     AND oracleStatus=PASS
     AND evidenceStatus=COMPLETE
     AND fixtureCleaned=true

FEASIBILITY_FAILURE
  := otherwise, when shared study validity remains intact

STUDY_INVALID
  := shared contract / identity / evidence / infrastructure validity failure
```

`LEG_BUDGET_EXHAUSTED`、普通 task failure 和可信的单 run tool failure 不应默认阻断后续独立 runs。只有共享
identity、预算、证据、合同或基础设施完整性不再可信时，才允许 study-level stop。

## 6. 指标与口径

### Primary feasibility metrics

- `endToEndSuccessRate`：同时满足 `TERMINAL_COMPLETE`、objective/regression `PASS`、
  `evidenceStatus=COMPLETE`、`fixtureCleaned=true` 的 run 数 / 已启动 run 数；
- `terminalResponseRate`：`terminationStatus` 为 `TERMINAL_COMPLETE` 或 `TERMINAL_FAILED` 的 run 数 /
  已启动 run 数；
- `oracleAdjudicableRate`：`oracleStatus` 为 `PASS` 或 `FAIL` 的 run 数 / 已启动 run 数；
- `oraclePassAmongAdjudicable`：`oracleStatus=PASS` 的 run 数 / oracle 可判定 run 数；
- `budgetExhaustionRate`：`terminationStatus=BUDGET_EXHAUSTED` 的 run 数 / 已启动 run 数。

### Secondary diagnostics

- 每 run 的 provider calls、tool requests、actual tool executions、tool-error event rate；
- `unrecoveredToolFailureRunRate`：含有未恢复工具失败的 run 数 / 已启动 run 数；
- input/output/cache usage、wall-clock 和 response receipt availability；
- objective/regression failure taxonomy；
- unknown、evidence completeness、fixture cleanup 和 cross-run contamination；
- task/stratum 分层的完成率与预算耗尽率。

缺失值保持 `UNKNOWN` 或 `UNAVAILABLE`，不填零。所有指标必须同时给出 planned、started、completed、failed、
blocked 的分母说明；不能把未执行的 run 当作失败，也不能把被 study invalidator 阻断的 run 当作已观察完成。

## 7. Study-level gates（待冻结）

F0 设计阶段先冻结 gate 层次，不预先拍定数值：

```text
VALIDITY_GATE :=
  sharedInvalidatorCount = 0
  AND bindings valid
  AND studyId / runIds unique
  AND evidence integrity valid

PRECISION_GATE :=
  planned sample is complete enough
  AND required task-panel coverage is satisfied
  AND predeclared confidence / minimum-interpretable-sample rule is satisfied

FEASIBILITY_GATE :=
  endToEndSuccessRate >= X
  AND budgetExhaustionRate <= Y
  AND unrecoveredToolFailureRunRate <= W
  AND oraclePassAmongAdjudicable >= Z
```

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

`toolErrorEventRate` 只作为诊断指标；是否作为 gate 的是 `unrecoveredToolFailureRunRate`，因为可恢复工具错误
本身属于 agent execution 能力的一部分。`X/Y/W/Z` 与 precision/sample rule 必须在第一条 response 前冻结。
F0 `GO_TO_T0_DESIGN` 只允许进入 T0 设计评审，不自动授权 T0 或 E1，也不证明 Context Runtime 有效。

## 8. 偏差控制

- task set、重复次数、预算、提示、provider envelope 和停止规则在第一条 response 前冻结；
- 所有 fresh runs 都进入分析分母，失败不被事后删除；
- F0 只使用 Native-only，避免把 Runtime policy、Dose 和 completion 混为同一处理；
- 不按 dose、成功与否或模型行为选择子集；
- 一个 F0 study 只使用一个一次性 `studyId`，其下的 `runId` 全部唯一；任何 terminal run 或 study 都不得
  retry/resume/reuse；
- F0、T0、E1 与 E0/V4/SV2 的 contracts、identities 和 estimands 分开；
- 运行后才产生的变量（tool error、completion、dose 等）不能决定 primary sample selection；
- 结果按 task/stratum 分层，避免少数简单任务掩盖复杂任务的不可执行性。

## 9. 必须冻结的字段

正式 F0 contract 还必须冻结：

1. task IDs、strata、fixture/prompt/oracle hashes，以及 estimand 明确为 frozen F0 task panel；
2. 一个 fresh single-use `studyId` 下的唯一 `runId` 集合、每 task 的重复次数和固定 run order；
3. provider/model/endpoint、工具 envelope、参数和 credential policy；
4. per-run 与 study budget、timeout、call/tool accounting；
5. `terminationStatus`、`oracleStatus`、`evidenceStatus` 三个轴及其组合得到的 run disposition；
6. objective/regression oracle 的 post-run firewall、纳入条件与 unknown 处理；
7. `endToEndSuccessRate`、拆解指标、置信区间和最小解释样本量；
8. artifact schema、checkpoint 对账、retention 和 no-raw-content policy；
9. `VALIDITY_GATE`、`PRECISION_GATE`、`FEASIBILITY_GATE` 及 F0_GO、F0_HOLD、F0_NO_GO 的具体阈值。

## 当前状态

```text
F0 contract design       DRAFT / NOT_EXECUTABLE
F0 implementation        NOT_STARTED
F0 authorization         NO_GO
T0 contract              NOT_STARTED
E1 design                HOLD
```

本设计确认的下一步是先完成 F0 contract review 和阈值设计；在此之前不运行新的 Provider，不修改 #117 研究立场，
也不把 E0 失败解释为 Runtime treatment failure。
