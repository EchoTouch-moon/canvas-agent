# F0 Execution Feasibility Contract 设计草案

日期：2026-09-11（Asia/Shanghai）

状态：`DRAFT / NOT_EXECUTABLE / NO_PROVIDER`

本文件是 #117 正式研究立场之后的第一个独立研究设计。它不是 E0 补跑授权，也不是 T0/E1 合同；在独立
review、阈值冻结和 fresh owner authorization 之前，不得据此访问 Provider。

## 1. 研究问题

在固定 Provider、model、tool envelope、任务提示和候选调用预算下，独立的 Native agent run 能否稳定完成
任务并通过 objective/regression oracle？

F0 的 estimand 是当前 benchmark 条件下的 Native execution-feasibility distribution，重点是：

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

## 4. 任务与抽样

初始候选任务可从现有 C1 task manifest 中选择，但选择必须在第一条 F0 response 之前冻结，并记录 task、stratum、
fixture、prompt 和 oracle hashes。当前建议至少覆盖两个 distinct task；具体 task set、每个 task 的重复次数和
总样本量待设计评审决定。

候选 pilot 范围是每个 task 3–5 个 fresh independent runs，实际数字不能在看到结果后调整。每个 run 使用：

- fresh study/run identity；
- fresh fixture sandbox；
- 完全相同的 Native prompt、provider envelope 和调用边界；
- 独立的 response/evidence 目录；
- 预先登记的运行顺序和停止规则。

任何失败 run 都保留在分母中；不能因为工具错误、预算耗尽或 task difficulty 在事后删除 task 或 run。

## 5. Outcome 与 failure taxonomy

F0 需要把“响应终止”“任务完成”和“研究有效”分开记录：

```text
terminal response
    ≠ task oracle pass
    ≠ evidence-complete run
    ≠ study qualification
```

候选 leg-level outcomes：

| outcome                        | 含义                                                                        | 对后续独立 run 的影响                  |
| ------------------------------ | --------------------------------------------------------------------------- | -------------------------------------- |
| `TASK_COMPLETE`                | response terminal，fixture cleanup 完成，objective/regression oracle 可判定 | 计入完成分布                           |
| `TASK_FAILURE`                 | response terminal 但 task/oracle 失败                                       | 保留在分母，继续预定的其他独立 run     |
| `LEG_BUDGET_EXHAUSTED`         | 达到候选 call budget 仍无 terminal outcome                                  | 保留在分母，不自动 invalidates study   |
| `TOOL_ERROR`                   | 工具返回或恢复失败，但共享证据仍可信                                        | 记录错误率，继续其他独立 run           |
| `PROVIDER_FAILURE`             | Provider/response boundary 失败                                             | 记录并按预先规则判断是否影响共享有效性 |
| `EVIDENCE_FAILURE`             | checkpoint、身份或报告不可对账                                              | 触发 study-level invalidator / `NO_GO` |
| `CONTRACT_OR_IDENTITY_FAILURE` | 绑定、credential、fallback、resume/reuse 或 cross-run 污染违规              | 触发 study-level invalidator / `NO_GO` |

`LEG_BUDGET_EXHAUSTED`、普通 task failure 和可信的单 run tool failure 不应默认阻断后续独立 runs。只有共享
identity、预算、证据、合同或基础设施完整性不再可信时，才允许 study-level stop。

## 6. 指标与口径

### Primary feasibility metrics

- `runCompletionRate`：达到预先定义的 `TASK_COMPLETE` 的 run 数 / 已启动 run 数；
- `terminalResponseRate`：收到 terminal response 的 run 数 / 已启动 run 数；
- `budgetExhaustionRate`：`LEG_BUDGET_EXHAUSTED` run 数 / 已启动 run 数；
- `oraclePassRate`：oracle 可判定且通过的 run 数 / 已完成 fixture adjudication 的 run 数。

### Secondary diagnostics

- 每 run 的 provider calls、tool requests、actual tool executions、tool-error rate；
- input/output/cache usage、wall-clock 和 response receipt availability；
- objective/regression failure taxonomy；
- unknown、evidence completeness、fixture cleanup 和 cross-run contamination；
- task/stratum 分层的完成率与预算耗尽率。

缺失值保持 `UNKNOWN` 或 `UNAVAILABLE`，不填零。所有指标必须同时给出 planned、started、completed、failed、
blocked 的分母说明；不能把未执行的 run 当作失败，也不能把被 study invalidator 阻断的 run 当作已观察完成。

## 7. Study-level gates（待冻结）

F0 设计阶段只定义 gate 结构，不预先拍定数值：

```text
F0_GO :=
  completionRate >= X
  AND budgetExhaustionRate <= Y
  AND oraclePassRate >= Z
  AND toolErrorRate <= W
  AND distinctTasks >= N
  AND evidenceUnknownRate <= U
  AND sharedInvalidatorCount = 0
```

`X/Y/Z/W/N/U` 必须在 F0 freeze review 前根据任务规模、预期置信区间和研究目标冻结。若样本量不足以估计这些
指标，状态应为 `HOLD / INCONCLUSIVE`，而不是自动 `NO_GO`。若出现共享合同、身份、证据或基础设施破坏，则为
`NO_GO`，不因完成率较低而混淆两种状态。

F0 `GO` 只表示可以进入 T0 设计评审，不自动授权 T0 或 E1，也不证明 Context Runtime 有效。

## 8. 偏差控制

- task set、重复次数、预算、提示、provider envelope 和停止规则在第一条 response 前冻结；
- 所有 fresh runs 都进入分析分母，失败不被事后删除；
- F0 只使用 Native-only，避免把 Runtime policy、Dose 和 completion 混为同一处理；
- 不按 dose、成功与否或模型行为选择子集；
- 每个 run 使用一次性 identity，terminal 后不得 retry/resume/reuse；
- F0、T0、E1 与 E0/V4/SV2 的 contracts、identities 和 estimands 分开；
- 运行后才产生的变量（tool error、completion、dose 等）不能决定 primary sample selection；
- 结果按 task/stratum 分层，避免少数简单任务掩盖复杂任务的不可执行性。

## 9. 必须冻结的字段

正式 F0 contract 还必须冻结：

1. task IDs、strata、fixture/prompt/oracle hashes；
2. 每 task 的重复次数、run order 和 fresh identity 规则；
3. provider/model/endpoint、工具 envelope、参数和 credential policy；
4. per-run 与 study budget、timeout、call/tool accounting；
5. `TASK_COMPLETE`、`TASK_FAILURE`、`LEG_BUDGET_EXHAUSTED` 和 study invalidator 的判定；
6. objective/regression oracle 的纳入条件与 unknown 处理；
7. primary/secondary metrics、置信区间和最小解释样本量；
8. artifact schema、checkpoint 对账、retention 和 no-raw-content policy；
9. F0_GO、F0_HOLD、F0_NO_GO 的具体阈值。

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
