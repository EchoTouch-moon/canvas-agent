# C1-F1 Native Feasibility Frontier 设计提案

日期：2026-09-13（Asia/Shanghai）

状态：`DRAFT / DESIGN_ONLY / NO_PROVIDER`

F1 承接已完成的 Failure Anatomy，研究 Native agent 在不同 Provider-call envelope 下的可行性边界。它不是
F0-v2 的补跑，不改变 F0-v2 结果，不启用 Runtime intervention，也不授权任何 Provider execution。

## 研究问题与 estimand

F1 要回答：

> 在固定 task、prompt、fixture、Provider/model、tool semantics、recovery policy 与 oracle 的条件下，Native
> execution feasibility 如何随单个 run 的 Provider-call budget 变化？

主要输出是逐 budget point 的 feasibility curve，而不是单一 `F1_PASS/FAIL`：

```text
Provider-call budget
  → successAmongAdjudicable
  → oraclePassAmongAdjudicable
  → budgetExhaustionRate
  → strict per-tool recovery-linkage failure rate
  → Provider calls / tool executions / provider usage / latency
```

F1 不估计 Context Runtime 效果，不比较 Native 与 Runtime，不测 Dose，不进入 T0 或 E1 adjudication。

## 历史锚点

F0-v2 的 24-call study 已经是合法的历史锚点：

```text
24 Provider calls/run
F0-v2 status = VALID / F0_V2_FEASIBILITY_NO_GO / CONSUMED
```

24-call 点不重跑、不重绑、不加入新的 F1 identity，也不与 F1 points pooled。F1 只执行新的 budget points，
并在报告中把 24-call 结果作为带 binding 的 descriptive historical anchor。

## 单变量控制

以下字段全部继承 F0-v2 freeze，不得在 F1 point 之间改变：

```text
task panel / prompt / fixture / objective oracle / regression oracle
Provider / model / endpoint / providerConfigHash
Native-only arm / Runtime intervention DISABLED
tool semantics / prospective provenance / bounded recovery policy
maxToolRequestsPerRun = 96
maxWallClockMsPerRun = 600000
maxOutputTokensPerRequest = 16384
maxConcurrency = 1
metadata-only evidence / ground-truth firewall / cleanup sequence
```

F1 唯一自变量是：

```text
maxProviderRequestsPerRun
```

候选 budget points：

```text
32
40
48
```

每个 point 是独立 study、独立 fresh identity、独立 execution binding 和独立授权；不复用 F0-v2 identity，不把不同
point 的 run 合并成一个 feasibility estimate。

对每个 point，study-level Provider ceiling 由 per-run ceiling 派生，不是第二个自变量：

```text
maxProviderRequestsPerStudy = totalRuns × maxProviderRequestsPerRun

32-call point  → 32 × 32 = 1024
40-call point  → 32 × 40 = 1280
48-call point  → 32 × 48 = 1536
```

任何 study-level provider-call、network-request 或 global transport limiter 都必须使用同一个派生值。tool ceiling
仍为 `32 × 96 = 3072`，study wall-clock ceiling 仍为 `19,200,000 ms`。这些派生字段只反映 point budget，不能
被实现为额外的可调参数。

## 抽样与顺序

每个 point 暂定沿用 F0-v2 的 2-task panel：

```text
runsPerTask       = 16
totalRuns         = 32
run order         = deterministic balanced alternation
maxConcurrency    = 1
```

任务顺序、task manifest、prompt/fixture/oracle hashes、evidence axes、UNKNOWN 处理和 recovery linkage 规则保持
不变。具体 F1 contract 仍需在设计 review 后冻结；本提案不创建 study identity。

## Historical-anchor equivalence witness

F0-v2 的 24-call anchor 使用：

```text
executionRevision       = 6d0189a998772e8d9e379f8ec56bc7f429546a2a
executionSurfaceHash    = 583f6c974c207eb3e338b89aa345ab1aadd894fb25d83455b06ee59af13fbe0a
```

F1 contract 必须携带 machine-readable `surfaceEquivalenceWitness`，逐项列出 F0-v2 与 F1 effective executable
surface 的 path、hash 和分类。每一项只能是：

```text
EXACT_UNCHANGED
BUDGET_ONLY_PROJECTION
```

`BUDGET_ONLY_PROJECTION` 仅允许出现在把 `maxProviderRequestsPerRun` 注入 runner、并计算上述 study-level 派生 ceiling
的 plumbing 上；task、prompt、tool semantics、recovery、oracle、evidence、firewall、credential、Provider request
结构与 termination 行为的差异必须为零。出现 `OTHER_CHANGE`、缺少 path、或 F1 surface 无法逐项回溯到 anchor 时，
该 point 的 validity gate 必须 fail closed，不能进入 frontier 曲线。

## 预先声明的 sequential stopping rule

在第一条 F1 response 前冻结以下顺序。先定义逐 point 的 frontier-driving gate：

```text
FRONTIER_DRIVING_GATE :=
  validity gate = PASS
  AND precision gate = PASS
  AND provenance / evidence safety = PASS
  AND every t1 gate = PASS
  AND t2 oracle gate = PASS
  AND t2 strict recovery-linkage gate = PASS
  AND t2 budget-sensitive composite gate = FAIL

t2 budget-sensitive composite gate :=
  lower95(t2 successAmongAdjudicable) >= 0.80
  AND upper95(t2 budgetExhaustionRate) <= 0.20
```

它把 t2 的完成率与 budget exhaustion 作为同一 budget-sensitive 组合；t1 recovery-linkage、t2 oracle、t2 strict
recovery 和其他非预算 gate 不能驱动升高 Provider budget。

然后执行：

```text
1. 执行 32-call point；
2. 若完整 feasibility gate 全部通过，停止，标记
   FIRST_TESTED_STABLE_FEASIBLE_POINT=32；
3. 若 32 point 未通过完整 gate 且 `FRONTIER_DRIVING_GATE=PASS`，才执行 40-call point；
4. 若 40 point 未通过完整 gate 且 `FRONTIER_DRIVING_GATE=PASS`，才执行 48-call point；
5. 若某 point validity、precision、provenance/evidence safety 或任一非预算 gate 阻塞，标记
   `FRONTIER_INCONCLUSIVE_NON_BUDGET`，停止并进入离线诊断，不自动增加 budget；
6. 若 48 point 仍由 `FRONTIER_DRIVING_GATE` 驱动且未达到稳定可行，停止，不再无界增加 budget；
7. 任一点 validity 失败，停止 F1 并回到实现/证据诊断；不得把后续 point 当作同一 study 的补救；
8. 任一点 precision 失败，标记该 point INCONCLUSIVE，不因失败自动扩大或降低门槛。
```

“停止”只表示停止预先声明的 frontier search；报告必须说明实际测试了哪些 point，不能把未执行的更高 budget 写成
已知结果。

## Point-level adjudication

每个 point 保留 F0-v2 的事实轴与 one-sided 95% Clopper–Pearson 规则：

```text
successAmongAdjudicable
startedRunSuccessRate                 # descriptive only
unknownRunRate
adjudicableRunRate
budgetExhaustionRate
unrecoveredToolFailureRunRate
oraclePassAmongAdjudicable
Provider calls / tool executions / usage / latency
```

F1 不改变 F0-v2 的数值门槛。每个 point 记录完整 gate vector，并使用以下描述性标签：

```text
INVALID
  validity gate fails

INCONCLUSIVE
  validity passes but precision gate fails

VALID_INFEASIBLE
  validity + precision + safety pass, one or more feasibility gates fail

VALID_STABLE_FEASIBLE
  validity + precision + safety + all feasibility gates pass
```

这些标签只描述单个 budget point，不把 32/40/48 points pooled，也不把 `VALID_STABLE_FEASIBLE` 解释成 Runtime
效果或跨任务总体分布。

若历史 24-call anchor 为 NO_GO，且 F1 的首个稳定可行 point 为 `B`，先定义：

```text
L = highest tested budget below B whose point label is VALID_INFEASIBLE
    and whose continuation was driven by FRONTIER_DRIVING_GATE
```

只有搜索链从 `L` 连续推进到 `B` 时，输出才写成：

```text
FIRST_TESTED_STABLE_FEASIBLE_POINT = B
OBSERVED_TRANSITION_BRACKET         = (L, B]
```

例如：

```text
32 PASS                         → (24, 32]
32 FAIL → 40 PASS               → (32, 40]
32 FAIL → 40 FAIL → 48 PASS     → (40, 48]
```

这表示观测到 transition bracket，不表示真实临界值精确等于 `B`。如果中间出现 `INVALID`、`INCONCLUSIVE` 或
`FRONTIER_INCONCLUSIVE_NON_BUDGET`，搜索链已经断开，不能形成 bracket。若 32/40/48 均未达到稳定可行，则报告
`NO_STABLE_POINT_IN_TESTED_SET`，不外推更高 budget 的结果。

## 重点分析

Failure Anatomy 已提出两个必须保持分离的问题：

```text
t1
  task/trajectory recovery outcome = RECOVERED
  strict per-tool recovery linkage = INCOMPLETE on 4/16

t2
  multi-file task is the current Native bottleneck
  8/16 budget exhaustion at the 24-call historical point
  1 additional non-budget terminal/oracle failure
```

F1 不在看到 t1 结果后改变 recovery metric，也不把 t1 的 transient/tool-linkage 问题当作 budget frontier 的证据。
每个 point 都继续同时报告 task outcome、oracle、budget 和 strict linkage。

F1 的第一轮比较重点是：

- t2 在 32、40、48 calls 是否从 budget-limited 区域进入稳定可行区域；
- budget exhaustion 是否下降而 oracle pass 与 strict recovery safety 保持可解释；
- 成功 point 的 Provider calls、tool executions、usage 和 latency 是否仍处在可接受范围；
- 若 48 仍不稳定，是否说明瓶颈主要来自 task/tool interaction 或 recovery，而非 Provider-call ceiling。

## 研究边界

允许报告：

- F0-v2 24-call historical anchor 与 F1 新 points 的绑定后描述性差异；
- 每个 point 的完整 success/oracle/budget/recovery/usage 曲线；
- 首个 tested stable-feasible point（若出现）及其精确 contract/identity；
- `OBSERVED_TRANSITION_BRACKET`，不把首个通过点称为精确 frontier threshold；
- stress regime 与 transition regime 的任务轨迹诊断。

禁止：

- 重跑 F0-v2 24-call identity；
- 把不同 budget points pooled 成一个 Native feasibility estimate；
- 只选择成功 point 报告；
- 看到 32/40/48 的变化就宣称 Provider budget 的因果效应；
- 在 F1 中启用 Runtime intervention 或推导 R0 rescue effect；
- 因 point 失败临时增加预算、修改 prompt、task、tool envelope、recovery policy 或 oracle。

## F1 → R0 的关系

F1 的结果只用于定位 Native feasibility frontier：

```text
F1 frontier regime
  Native approximately feasible or first tested stable-feasible
  → future R0 efficiency/quality comparison candidate

F0-v2 stress-24 regime
  Native demonstrated NO_GO
  → future R0 feasibility-rescue candidate
```

R0 需要独立 estimand、task/regime 选择、Runtime assignment、contract、binding、identity 和 owner authorization。
F1 不自动授权 R0，当前 R0 仍为 `DESIGN_ONLY / NO_PROVIDER`。

## 实施与授权顺序

```text
F1 independent design review
  → freeze the 32-call machine-readable point contract first
  → credential-free runner check for the 32-call point
  → exact execution binding and CI
  → fresh identity + owner authorization for 32 only
  → sequential live execution under the stopping rule
  → if FRONTIER_DRIVING_GATE requires it, separately freeze/bind/authorize 40, then 48
  → offline frontier report
```

任何 point contract 的 task、prompt、fixture、Provider、tool semantics、recovery policy、oracle 或 evidence 改动，都
必须退回新的 design/freeze review；不能借 F1 名义修改 F0-v2 contract。

## 当前状态

```text
F0-v2                         VALID / F0_V2_FEASIBILITY_NO_GO / CONSUMED
Failure Anatomy               CLOSED / DESCRIPTIVE / ZERO_PROVIDER
F1 Native Feasibility Frontier DRAFT / DESIGN_ONLY / NO_PROVIDER
R0 Runtime Rescue              DESIGN_ONLY / NO_PROVIDER
T0 / E1                       HOLD
```
