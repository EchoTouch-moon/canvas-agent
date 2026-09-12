# F0 Execution Feasibility 数值冻结提案

日期：2026-09-12（Asia/Shanghai）

状态：`DRAFT / NUMERICAL_FREEZE_PROPOSAL / NOT_EXECUTABLE`

本文件承接已合并的 F0 contract structure（#118）。它提出任务 panel、重复次数、预算和 gate 数值，供独立
review 与 freeze 决策使用；在正式冻结前不创建 executable contract、不生成 study identity、不读取 credential、不
访问 Provider。

## 1. 研究问题与 estimand

F0 估计的是**冻结 F0 task panel**上的 Native execution-feasibility，而不是整个 benchmark 的总体分布：

> 在固定 Provider、model、tool envelope、任务提示和调用边界下，一个独立 Native run 能否完成任务并通过
> objective/regression oracle？

F0 不启用 Runtime intervention，不计算 treatment effect，不测 Dose，不研究 SUPERSEDED_VERSION triggerability。
F0 `GO` 只允许进入 T0 设计评审。

## 2. 冻结 task panel 提案

第一轮 F0 采用两个已经存在且性质不同的 task，形成一个明确的 panel estimand：

| taskId                          | stratum                               | fixture content SHA                                                | fixture tree                               | prompt SHA                                                         | objective oracle                        | regression oracle                     |
| ------------------------------- | ------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------ | --------------------------------------- | ------------------------------------- |
| `c1-t1-localized-distractor-v1` | `localized_investigation_distractors` | `09d921c46e6a7c524d8992f7ec87753efbcc69e5bd1470d5873f53f72927d8d5` | `860da37c32e15ba749b106a0187dde5a36a161a9` | `7ede05ac9f2f5d77771ad72ca2b83d652bf26b8dcc61dbba03aa4f6978068615` | `node --test test/pagination.test.js`   | `node --test test/regression.test.js` |
| `c1-t2-multi-file-migration-v1` | `multi_file_multi_source`             | `1a9ecd5bc168568ce9285c405257d7c2875090411fd8f594dc5849d1f868ede3` | `d0ac86afcc7bb76b19e0f6d6e052ce642d25e784` | `1c09fb86ab5e4cfde9a9cf1ba05282b5007081b5c468df2fe3c9b44eff084a03` | `node --test test/format-price.test.js` | `node --test test/regression.test.js` |

该 panel 覆盖 localized 与 multi-file 两个 stratum，但不声称代表四个 C1 strata 或普通 benchmark workload。
task set、fixture、prompt 和 oracle hashes 必须在第一条 response 前再次从 manifest 重算并绑定。

## 3. Study shape、identity 与 run order

建议一个 F0 study 使用一个 fresh、single-use `studyId`，其下挂 32 个唯一 `runId`：

```yaml
studyId: c1-f0-<YYYYMMDD>-<8-hex>
runs_per_task: 16
total_runs: 32
arm: NATIVE_ONLY
run_order: deterministic_balanced_alternation
```

运行顺序为两个 task 的确定性交替序列，task set 和 run count 在第一条 response 前冻结。每个 run 使用 fresh
fixture sandbox、独立 evidence 目录和唯一 run identity；任何 terminal、budget exhaustion、tool failure 或
Provider failure 都不能复用该 runId。studyId 本身只 claim 一次。

## 4. Provider、工具与预算提案

F0 为测量当前 benchmark 条件，暂提沿用已验证的 Step Plan 配置；最终 execution revision、provider config hash
和 contract hash 在 F0 freeze 时重新绑定：

```yaml
provider: step-plan
model: step-3.7-flash
endpoint: https://api.stepfun.com/step_plan/v1/chat/completions
fallback: NONE
credential: STEP_PLAN_API_KEY / MEMORY_ONLY
runtime_intervention: DISABLED
concurrency: 1
max_provider_requests_per_run: 24
max_tool_requests_per_run: 96
max_wall_clock_ms_per_run: 600000
max_output_tokens_per_request: 16384
max_provider_requests_per_study: 768
max_tool_requests_per_study: 3072
max_wall_clock_ms_per_study: 19200000
retry: FORBIDDEN
resume: FORBIDDEN
identity_reuse: FORBIDDEN
```

`24` 是待评估的执行边界，不是被证明合理的预算。32 runs 的最大 Provider 请求为 768，最大工具请求为 3072，
最大 wall-clock 为 5 小时 20 分钟；实际使用量按 outbound/response/tool checkpoint 计数。

## 5. Ground-truth firewall

执行路径、prompt、provider-bound messages 和工具阶段不得读取：

```text
objective oracle
regression oracle
reference answer / reference fixture
expectedWritablePaths
removalGroundTruth
historical labels / V4 prevalence results
```

fixture 内只提供任务本身可见的工作树。objective/regression oracle 只能在 run 已结束、fixture 已清理之后由
post-run adjudicator 读取。oracle 结果可进入报告和 gate，但不能进入模型上下文、工具参数或执行时停止决策。

## 6. 正交 evidence axes

每个 run 必须分别记录：

```text
terminationStatus
  TERMINAL_COMPLETE | TERMINAL_FAILED | BUDGET_EXHAUSTED
  PROVIDER_BOUNDARY_FAILURE | TOOL_BOUNDARY_FAILURE | BLOCKED

oracleStatus
  PASS | FAIL | UNKNOWN | NOT_ADJUDICABLE

evidenceStatus
  COMPLETE | PARTIAL | INVALID

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

`runDisposition` 由这些轴派生：

```text
FEASIBILITY_SUCCESS
  := TERMINAL_COMPLETE
     AND oracleStatus=PASS
     AND evidenceStatus=COMPLETE
     AND fixtureCleaned=true

FEASIBILITY_FAILURE
  := otherwise, when study validity remains intact

STUDY_INVALID
  := shared contract / identity / evidence / infrastructure validity failure
```

工具错误可以在最终成功的 run 中出现；`toolErrorEventRate` 只作诊断，gate 使用
`unrecoveredToolFailureRunRate`。

## 7. 数值决策规则提案

建议使用单侧 95% Clopper–Pearson exact interval，避免用少量 pilot 结果拼接“稳定”结论。每个 task 的 16 个
run 是分层最小样本；不把两个 task 混成一个 benchmark-level rate。

在零失败的边界情形下：

| 每 task run 数 | 两 task 总 run 数 | 最大 Provider calls | success rate 单侧 95% 下界 | failure rate 单侧 95% 上界 |
| -------------: | ----------------: | ------------------: | -------------------------: | -------------------------: |
|             14 |                28 |                 672 |                      0.807 |                      0.193 |
| **16（建议）** |            **32** |             **768** |                  **0.829** |                  **0.171** |
|             20 |                40 |                 960 |                      0.861 |                      0.139 |

选择 16/task 的理由是：在零失败边界下，它同时超过候选的 `success≥0.80` 与 `failure≤0.20` 判定线，并为
分层统计留出小幅余量。若 16 个 run 中出现 1 个失败，success 下界约为 0.736、failure 上界约为 0.264，
该 task 不应通过这组严格 gate。

建议的 F0 gate 数值（仍待 freeze review）：

```text
FEASIBILITY_GATE per task:
  one-sided 95% lower bound(endToEndSuccessRate) >= 0.80
  one-sided 95% upper bound(budgetExhaustionRate) <= 0.20
  one-sided 95% upper bound(unrecoveredToolFailureRunRate) <= 0.20
  one-sided 95% lower bound(oraclePassAmongAdjudicable) >= 0.80
```

这些 gate 以每 task 分层结果为准；pooled rate 只作为描述性补充。`terminalResponseRate`、
`oracleAdjudicableRate`、tool-error event rate、calls、usage 和 wall-clock 是拆解指标，不可替代
`endToEndSuccessRate`。

## 8. 三层 adjudication

```text
VALIDITY_GATE:
  sharedInvalidatorCount = 0
  bindings valid
  one studyId / unique runIds
  checkpoint ↔ report join complete
  no credential/raw payload leakage

PRECISION_GATE:
  16 started runs per frozen task
  both task strata represented
  predeclared confidence rule satisfied
  no post-hoc task/run removal

FEASIBILITY_GATE:
  per-task numerical rules in §7 all pass
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

普通 `TASK_FAILURE`、`BUDGET_EXHAUSTED` 或可恢复的单 run tool failure 保留在分母，并不自动阻断其他预定
run；共享证据、身份、合同或基础设施失效才触发 study invalidator。

## 9. 仍需在 freeze 前决定的事项

1. 是否接受当前两个 task 作为第一轮 F0 panel，或增加第三个 stratum；
2. 16/task 是否满足成本与精度要求；
3. `0.80 / 0.20` feasibility lines 是否与“进入 T0 设计”的风险容忍度一致；
4. `oraclePassAmongAdjudicable` 的纳入分母与最小 adjudicable rate；
5. task alternation seed、studyId/runId schema 和 artifact retention；
6. F0 executable runner 如何保证 oracle firewall 和普通 leg failure 不阻断 study。

上述事项冻结后，才生成 machine-readable F0 contract、实现 Native-only runner、完成独立 review 和新的 owner
authorization。该提案不授权任何 Provider execution，也不改变 #117 research stance。

## 当前状态

```text
F0 contract structure       MERGED / ACCEPTED
F0 numerical freeze         DRAFT / READY_FOR_FREEZE_REVIEW
F0 implementation           NOT_STARTED
F0 authorization            NO_GO
T0 contract                 NOT_STARTED
E1 design                   HOLD
```
