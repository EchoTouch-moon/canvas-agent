# F0-v2 Tool Recovery 与 Side-effect Provenance 设计提案

日期：2026-09-13（Asia/Shanghai）

状态：DRAFT / DESIGN_ONLY / NO_PROVIDER

本文件提出一个新的 F0-v2 研究设计，承接已合并的 F0-RCA hardening。它不是已消费 F0-v1 的补跑、修正或重绑定，也不授权任何 Provider 访问。F0-v2 在独立 review、合同冻结、执行版本绑定和 fresh owner authorization 之前不得运行。

## 1. 研究问题与 estimand

F0-v2 要回答：

> 在保持 F0-v1 task panel、提示、Provider、工具预算和 oracle 不变的条件下，启用 prospective side-effect provenance 与 bounded tool-error recovery 后，Native agent 是否能够稳定完成任务并通过冻结的 feasibility gate？

主要 estimand 是更新后的 F0-v2 execution surface 上，原 F0-v1 task panel 的 Native execution-feasibility distribution。它不是整个 benchmark 的总体分布，也不是 recovery 策略的因果效果估计。

F0-v2 另行记录两个诊断问题：

1. 每个工具事件是否留下不泄漏原文的 provenance，以及越界副作用发生时能否归因到工具来源；
2. 工具失败后，模型是否改变请求并恢复推进，还是重复相同失败并在有界次数后被安全阻断。

由于执行面相对于 F0-v1 发生变化，v1 与 v2 的成功率、错误率和预算率只能作预先声明的描述性比较，不能汇总，也不能称为 recovery hardening 的随机化因果效果。

F0-v2 不比较 Native 与 Runtime，不启用 Runtime intervention，不测 Dose，不研究生命周期 triggerability，不进入 T0 或 E1 adjudication。

## 2. 与 F0-v1 和 RCA 的关系

F0-v1 study c1-f0-20260912-41753674 已 consumed，裁决为 F0_FEASIBILITY_NO_GO。其原始 artifact、contract、identity 和报告不可修改、回填、resume、retry、reuse 或 rebind。

F0-RCA 将失败拆为两类：

- t1 的任务诊断、终止和 oracle 通路稳定，但两个 run 出现 package-lock.json 越界变化；原始 command 未留存，无法确定是 bash 副作用还是其他路径；
- t2 的多文件迁移在早期 read/edit/bash error 后出现重复请求、恢复失稳和预算耗尽，不能简化为只增加 call budget。

因此 v2 只改变已经合并且明确标为 prospective opt-in 的工具执行 hardening：

~~~text
F0-v1 task / prompt / fixture / oracle      保持不变
F0-v1 Provider / model / endpoint           保持不变
F0-v1 provider request budget               保持不变
F0-v1 feasibility thresholds                提案保持不变
tool execution surface                      启用 C1_F0_TOOL_HARDENING_V1
study identity / execution revision         全部新建
~~~

v2 是一个新的、可独立解释的 feasibility study。若之后要重写 t2 任务、修改提示、放宽 scope 或增加预算，必须另建 F0-v3 contract，不能在 v2 中临时调整。

## 3. 候选执行配置（待 freeze）

以下配置是设计候选，不是授权值：

~~~yaml
study: C1_F0_EXECUTION_FEASIBILITY_V2
arm: NATIVE_ONLY
runtime_intervention: DISABLED
provider: step-plan
model: step-3.7-flash
endpoint: https://api.stepfun.com/step_plan/v1/chat/completions
providerConfigHash: bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a
fallback: NONE
concurrency: 1
toolHardening: C1_F0_TOOL_HARDENING_V1
hardeningMode: PROSPECTIVE_OPT_IN_ONLY
maxIdenticalFailureAttempts: 2
maxProviderRequestsPerRun: 24
maxToolRequestsPerRun: 96
maxWallClockMsPerRun: 600000
maxOutputTokensPerRequest: 16384
retry: FORBIDDEN
resume: FORBIDDEN
identityReuse: FORBIDDEN
~~~

maxIdenticalFailureAttempts=2 表示同一工具请求签名最多保留两次尝试；第三次相同失败请求必须标记为 REPEATED_FAILURE_BLOCKED，且阻断本身不得产生文件副作用。它不是 study-level retry，也不允许自动重跑已结束的 run。

v2 不改变 providerConfigHash。启用 hardening 会产生新的 executionSurfaceHash 和 executionRevision；二者必须在实现、测试和 clean head 冻结后重新计算。若 provider request 结构变化，则应视为合同变化并重新计算 provider hash。

## 4. Task panel 与抽样

为避免在一次研究中同时改变 task difficulty、提示和 recovery，v2 暂保留 F0-v1 的完整两个 stratum：

| taskId | stratum | v2 处理 | 选择理由 |
| --- | --- | --- | --- |
| c1-t1-localized-distractor-v1 | localized_investigation_distractors | fixture、prompt、oracle、expected writable scope 全部保持 v1 hash | 保留 side-effect fidelity 连续性，验证越界变化能被 prospective provenance 归因 |
| c1-t2-multi-file-migration-v1 | multi_file_multi_source | fixture、prompt、oracle、expected writable scope 全部保持 v1 hash | 保留已观察到的多文件 recovery 压力，避免通过换成简单任务掩盖问题 |

两项 task 的 fixture content SHA、fixture tree SHA、prompt SHA、objective oracle 和 regression oracle 必须在第一条 response 前从当前 manifest 重算并写入 v2 contract。它们与 v1 相同是设计意图，不代表可以引用 v1 artifact 作为 v2 结果。

候选 study shape：

~~~yaml
runsPerTask: 16
totalRuns: 32
runOrder: deterministic_balanced_alternation
alternationSeed: PENDING_FREEZE
~~~

每个 v2 study 使用一个 fresh、single-use studyId，登记 32 个新的唯一 runId。固定 run order、task panel、重复次数和预算必须在第一条 response 前完成。所有 run（包括 tool failure、budget exhaustion 和 ordinary task failure）都保留在分母中；只有共享合同、identity、evidence 或基础设施 invalidator 才能阻断剩余 study。

## 5. Ground-truth firewall

下列内容只能在 run 完成、fixture 清理之后由 post-run adjudicator 读取：

~~~text
objective oracle
regression oracle
reference answer / reference fixture
expectedWritablePaths
removalGroundTruth
F0-v1 outcomes and labels
historical prevalence or success statistics
~~~

执行路径和 model-visible context 不得读取上述内容。工具执行器可以在内部生成 before/after snapshot 和安全的 changed-path metadata，但不得把 expected writable scope、oracle 判断或 v1 统计写入模型可见结果。

Provenance 允许进入 metadata-only artifact 的字段：

~~~text
toolRequestId / ordinal
toolName
commandClass (bash only)
commandHash (bash only)
failureClass
errorDigest
beforeSnapshotHash / afterSnapshotHash
changedPaths
changedPathsStatus
sideEffectSource
recoveryAction
repeatedFailureCount
~~~

禁止持久化 assistant content、原始 tool arguments、原始 bash command、provider payload、tool-result content、credential 或 recovery 中的敏感文本。缺失或无法观察的字段保持 UNKNOWN / UNAVAILABLE，不得填零。

## 6. Tool-error recovery 语义

每个工具请求都经过同一个 prospective executor：

1. 请求前记录安全 snapshot 摘要；
2. 执行 read/edit/bash，并记录成功或固定 failure class；
3. 请求后再次记录 snapshot，计算 changed paths 和 side-effect source；
4. 对可恢复失败向下一次 model observation 提供结构化 recovery hint；
5. 对同一失败签名计数，达到第三次相同失败时阻断并记录 BLOCKED_REPEATED_FAILURE。

恢复语义必须满足：

- 任何纠正后重试都由模型发出新请求，request signature 必须不同；执行器不得隐式重放原请求；
- PATH_NOT_FOUND、EDIT_MATCH_COUNT、COMMAND_FAILED、COMMAND_TIMEOUT 等类别必须有稳定映射；未知失败归入 UNKNOWN，不能静默转成成功；
- recovery hint 只说明错误类别和安全的下一步，不暴露 oracle、expected scope 或原始错误内容；
- blocked repeated failure 不产生新的 edit/bash side effect，也不改变 task fixture；
- 普通单 run 失败仍留在分母，不能被 study-level 当作自动 retry；
- study identity、run identity 和 raw evidence 永不 resume、retry、reuse 或 rebind。

## 7. Evidence axes 与新增诊断轴

v2 沿用 v1 的三个正交事实轴：

~~~text
terminationStatus
  TERMINAL_COMPLETE | TERMINAL_FAILED | BUDGET_EXHAUSTED
  PROVIDER_BOUNDARY_FAILURE | TOOL_BOUNDARY_FAILURE | BLOCKED

oracleStatus
  PASS | FAIL | UNKNOWN | NOT_ADJUDICABLE

evidenceStatus
  COMPLETE | PARTIAL | INVALID
~~~

并增加仅用于 v2 诊断与 safety gate 的轴：

~~~text
provenanceStatus
  COMPLETE | PARTIAL | INVALID

recoveryStatus
  NONE | RECOVERED | UNRECOVERED | BLOCKED

sideEffectAttributionStatus
  NOT_APPLICABLE | ATTRIBUTED | UNKNOWN | CONFLICT
~~~

runDisposition 仍由 termination、oracle、evidence 和 fixture cleanup 派生，不能因为 recovery 成功就绕过 oracle 或 scope gate：

~~~text
FEASIBILITY_SUCCESS
  := TERMINAL_COMPLETE
     AND oracleStatus=PASS
     AND evidenceStatus=COMPLETE
     AND provenanceStatus=COMPLETE
     AND fixtureCleaned=true
~~~

如果共享证据或 provenance schema 不可信，使用 STUDY_INVALID；如果只是单 run 的工具错误、普通失败或预算耗尽，使用 FEASIBILITY_FAILURE 并继续既定 run。

## 8. 预先声明的指标与 gates

### 8.1 Primary feasibility metrics

为保持和 F0-v1 的可解释性，v2 提案沿用相同的 per-task gate（最终仍需 freeze review 明确确认）：

~~~text
endToEndSuccessRate
budgetExhaustionRate
unrecoveredToolFailureRunRate
oraclePassAmongAdjudicable
~~~

每个 task 单独计算 one-sided 95% Clopper–Pearson exact interval，候选门槛为：

~~~text
lower95(endToEndSuccessRate) >= 0.80
upper95(budgetExhaustionRate) <= 0.20
upper95(unrecoveredToolFailureRunRate) <= 0.20
lower95(oraclePassAmongAdjudicable) >= 0.80
~~~

若保留 16 runs/task，这组规则与 v1 相同：它要求在零失败边界附近才可通过，不能在看到 v2 结果后降低门槛或合并两个 task 来获得 GO。

### 8.2 Provenance safety gate

~~~text
PROVENANCE_GATE:
  every observed tool execution has exactly one provenance record
  AND provenance schema validates
  AND no raw command / argument / payload / credential leakage
  AND blocked repeated failure produces no side effect
~~~

所有工具事件都必须进入事件覆盖率分母。changedPathsStatus=UNKNOWN 可以作为可观察性限制保留，但如果事件缺少 provenance row、出现 schema conflict 或发现原文泄漏，则整个 study NO_GO，不能只删除该 run。

### 8.3 Recovery safety gate

~~~text
RECOVERY_SAFETY_GATE:
  maxIdenticalFailureAttempts = 2
  AND no implicit identical-request replay
  AND corrected retry has a different request signature
  AND third identical failure is blocked
  AND blocked request has zero side-effect paths
~~~

该 gate 关注执行安全，不把发生过工具错误本身判为失败；工具错误事件率继续作为诊断指标。

### 8.4 Study-level adjudication

~~~text
VALIDITY_GATE:
  sharedInvalidatorCount = 0
  AND bindings valid
  AND one fresh studyId / unique runIds
  AND checkpoint ↔ report join complete
  AND provenance schema valid
  AND no raw sensitive-content leakage

PRECISION_GATE:
  16 started runs per task
  AND both task strata represented
  AND predeclared confidence rule satisfied
  AND no post-hoc task/run removal

FEASIBILITY_GATE:
  both task strata pass all numerical rules above

F0-v2_GO:
  VALIDITY_GATE
  AND PRECISION_GATE
  AND PROVENANCE_GATE
  AND RECOVERY_SAFETY_GATE
  AND FEASIBILITY_GATE
~~~

最终裁定保持分层：

~~~text
VALIDITY / provenance / recovery safety fail
  → F0_V2_NO_GO

VALIDITY pass + PRECISION fail
  → F0_V2_HOLD / INCONCLUSIVE

VALIDITY + PRECISION + safety pass + FEASIBILITY pass
  → GO_TO_T0_DESIGN

VALIDITY + PRECISION + safety pass + FEASIBILITY fail
  → F0_V2_FEASIBILITY_NO_GO
~~~

GO_TO_T0_DESIGN 只允许开始 T0 设计评审，不授权 T0 Provider execution，也不证明 Context Runtime 的 causal effectiveness。

## 9. v1 与 v2 的比较边界

可报告的比较仅限：

- 同一两个 task、同一 prompt/fixture/oracle、同一 provider 和同一预算下的描述性 rate 差异；
- t1 越界变化的 sideEffectSource 与 changedPaths 归因覆盖情况；
- t2 error class、重复失败、恢复动作和预算耗尽的轨迹分布。

禁止：

- 把 v1 与 v2 pooled 成一个 feasibility estimate；
- 只报告成功 subset，删除 budget exhaustion 或 tool failure；
- 把 v2 相对 v1 的变化称为 recovery hardening 的 causal effect；
- 看到 t2 仍失败就临时增加 budget、改 task、改 prompt 或放宽 scope；
- 把 provenance 的能归因解释成任务完成或 Runtime 干预有效。

若 v2 仍未通过，下一步必须在新 F0-v3 设计中单独决定是 task design、tool envelope、prompt、model capability、budget 还是多因素问题；不得在 v2 报告中事后选择其中一个解释。

## 10. 实现与授权顺序

在任何真实执行前，必须按以下顺序完成：

1. 独立 review 本设计，确认保持 v1 workload、预算和 per-task gate 的理由；
2. 将 C1_F0_TOOL_HARDENING_V1 接入独立的 F0-v2 Native runner，不能改写历史 runner 的默认行为；
3. 完成零 Provider credential-free 端到端测试，覆盖 side effect attribution、failure class、纠正请求、repeated-failure block、oracle firewall 和 metadata-only retention；
4. 从 manifest 重算 task/prompt/fixture/oracle hashes，生成新的 machine-readable v2 contract；
5. 在 clean head、Node 24 和远端 CI 通过后冻结新的 executionRevision、executionSurfaceHash 和 runContractSha256；
6. 创建 fresh、never-claimed studyId，形成绑定上述字段、provider hash、预算和 safety policy 的一次性授权；
7. 只有 owner authorization 明确允许后，才可执行 F0-v2 live Provider study。

任何步骤中的合同字段、task、prompt、fixture、工具 envelope、budget 或 recovery policy 变化，都必须回到 freeze review，不能直接在同一 identity 上修补。

## 当前状态

~~~text
F0-v1 study                  VALID / F0_FEASIBILITY_NO_GO / CONSUMED
F0-RCA hardening             MERGED / PROSPECTIVE / ZERO_PROVIDER
F0-v2 contract design        DRAFT / NOT_EXECUTABLE
F0-v2 implementation        NOT_STARTED
F0-v2 authorization          NO_GO
T0                           HOLD
E1                           HOLD
~~~

本提案的下一道门是独立 review 和 contract freeze review；在此之前不访问 Provider，不创建 study identity，不修改 F0-v1 artifact，也不把 T0 从 HOLD 推进为可执行状态。
