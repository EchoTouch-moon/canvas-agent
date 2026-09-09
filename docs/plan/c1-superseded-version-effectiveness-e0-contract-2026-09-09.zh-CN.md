# C1 SUPERSEDED_VERSION Effectiveness E0 Contract

日期：2026-09-09（Asia/Shanghai）。状态：`DRAFT / DESIGN_REVISION_2 / EXECUTION_NO_GO`。

本稿响应 #111 的 design review：固定四对、拆分 unique lifecycle objects 与 call-exposure、标明
`HISTORICAL_OPPORTUNITY_ENRICHED` enrollment cohort，并规定 task failure 不得造成 outcome-dependent attrition。

本文件承接 SV2 的真实 Provider-bound 机制闭环，定义下一阶段的最小 effectiveness 资格实验：

```text
自然机会采样 → 配对 Native/Runtime → 观察实际 intervention dose
→ 检查 treatment integrity → 记录任务正确性与资源结果
→ 只做方向性安全裁定 → 决定是否有资格进入 E1
```

本文件批准继续设计，不批准 Provider 执行。E0 任何真实运行都必须另有冻结的 task/run binding、fresh
study identity、exact execution revision、owner authorization 和独立 review。原 C1 64-leg 仍为 `NO_GO`。

## 1. 研究问题与阶段边界

SV2 已回答一个受控机制问题：在 harness 预先构造的
`read P@v1 → edit P SUCCESS → P@v2` 场景中，`SUPERSEDED_VERSION` replay evidence、纯 eviction 和
provider-bound composition 可以完整穿过真实 Provider 边界。

E0 不再验证“Runtime 能否干预”。E0 只回答四件事：

1. 在曾出现自然机会的任务中，Runtime 是否实际产生非零 intervention dose；
2. Native 与 Runtime 是否保持足够可比，且 Runtime 的 provider-bound 变化能被 replay 对账；
3. 是否出现立即阻止扩样的任务或回归安全信号；
4. evidence、replay、outcome、usage、latency 和 failure taxonomy 是否能完整归因。

E0 不回答总体效果、统计显著性、成本优势或跨模型泛化。E0 的样本量是资格门，不是 power claim。

## 2. 设计规模与比较单位

### 2.1 配对规模

- 计划规模：固定 `4` 个 matched pairs；每个 pair 恰好包含 1 个 `NATIVE` leg 和 1 个 `RUNTIME` leg。
- 总 leg 数：固定 `8`；串行执行，`maxConcurrency=1`。
- 每个 pair 使用同一冻结任务、同一 fixture snapshot、同一 provider/model/runtime 版本和同一分析绑定。
- 两个 leg 使用独立的新 sandbox；不共享文件系统状态、工作区变更或上一 leg 的 identity。
- arm order 在 E0 run contract 中预注册为 `2 × NATIVE → RUNTIME` 与 `2 × RUNTIME → NATIVE`；随机种子只决定配额内的顺序，不能改变配额。
- live response 之前必须同时冻结 pair count、order quota 和 randomization seed；不得依据前几个 pair 的结果增减 pair 或重排顺序。

### 2.2 三种解读集合

E0 同时保留三种互不替代的集合：

| 集合 | 定义 | 允许解读 |
| --- | --- | --- |
| ITT / opportunity set | 所有计划或已启动的 pair，按 leg status 保留完整、未完成和无效记录；包括 Runtime dose=0 | enriched-cohort recurrence、attrition、总体可执行性 |
| conditional treatment set | Runtime `uniqueEligiblePairs>0` 且 `uniqueRemovedPairs>0`、`prePolicyProviderBoundMessagesHash != postPolicyProviderBoundMessagesHash`、replay `MATCH` 的 leg | 仅在真实暴露到 treatment 后做方向性描述 |
| safety set | 所有出现 task、regression、protocol、evidence 或 infrastructure 信号的 pair | 停止扩样和 failure adjudication |

`Runtime dose=0` 的 pair 不能被伪装成“接受了 treatment”的负效果样本；它仍保留在 ITT/opportunity
统计中，并以 `TREATMENT_INACTIVE` 或 `NO_ELIGIBLE_EVENT` 明确标注。

E0 的任务来自 `HISTORICAL_OPPORTUNITY_ENRICHED` cohort。E0 观测到的 eligibility / treatment activation
rate 只能解释为该 enriched cohort 的 recurrence rate，不能外推为一般 coding workload prevalence；一般
workload prevalence 仍由 V4 prevalence study 承担。

## 3. 任务采样与 ground-truth 分离

### 3.1 Enrollment 可以使用历史机会证据

`enrollmentCohort` 固定为 `HISTORICAL_OPPORTUNITY_ENRICHED`。E0 任务不是一般 workload 的随机样本，
而是依据既有机会证据主动富集的候选队列。

E0 任务可以从历史 observational evidence 中筛选，包括：

- V4 prevalence 记录中出现 `read P@v1 → edit/write P → stale v1 persists` 的任务或同类结构；
- 已冻结 manifest、fixture tree/content hash、任务分层和 oracle 定义；
- 历史 ground-truth-assisted 机会标签及其来源版本。

这些输入只用于 enrollment / sampling。E0 任务清单、筛选规则、证据来源和最终 task IDs 必须在 live 前写入
immutable E0 task manifest；不得在观察 E0 结果后替换任务。

历史证据存在 metadata-only 或 replay capability gap 时，任务仍可作为候选，但该限制必须进入 manifest，
不能把历史标签当作 E0 执行期事实。E0 报告必须分别给出 enrollment 数、Runtime eligibility recurrence、
treatment activation recurrence 和 attrition；不得把其中任何一项写成一般 workload opportunity rate。

### 3.2 Runtime policy 禁止读取 ground truth

在任何 E0 Runtime leg 中，`C1_SUPERSEDED_VERSION_POLICY_V1` 及其调用链不得读取：

```text
changedPaths
expectedWritablePaths
task manifest label / removalGroundTruth
objective oracle / regression oracle
历史 stale 标签或 V4 prevalence 结果
任务答案、reference fixture、评审结果或报告产物
```

Runtime policy 的允许输入只有：

```text
model-visible message stream
read/edit/write tool request 与真实执行结果
版本探针返回的当前内容 fingerprint
Runtime 自己此前提交的 transition / carried-removal evidence
```

编排器和 evaluator 可以在 leg 完成后使用冻结 oracle 判定任务正确性；这不等于 policy 可以用 oracle
决定是否移除。E0 必须在代码审查和定向测试中验证这条边界。

> **Enrollment uses ground truth; treatment uses runtime evidence.**

## 4. 双臂定义与保持不变项

| Arm | 定义 | 唯一允许的差异 |
| --- | --- | --- |
| `NATIVE` | 保持 Pi 的原始 model-facing context；只记录 metadata-only observation，不应用 lifecycle rewrite | 无 `REMOVE`，不伪造 Runtime transition |
| `RUNTIME` | 在每次 outbound composition 前运行冻结的 `C1_SUPERSEDED_VERSION_POLICY_V1` | 只移除已被真实证据裁定为 `SUPERSEDED` 的完整 read call/result 对 |

Runtime 继续采用 SV2 已验证的 pure-evict 语义：不注入 v2 内容、不主动 re-read、不注入“已发生变更”的提示、
不改 system/developer/tool/provider-native envelope。`REHYDRATE` 在本合同中保持默认不允许；任何出现的
rehydrate 都是停止条件，不能被当作正常补救路径。

以下项目必须在 pair 内保持一致：

- task prompt、fixture snapshot、fixture/reference hashes、objective/regression evaluator；
- provider、model、endpoint、参数、Node 版本和工具 schema；
- per-leg hard budgets、timeout、kill-switch、fallback policy 和 evidence schema；
- arm-order quota、随机种子、pair identity、execution revision 和 run contract；
- sandbox materialization、文件权限、环境变量白名单和 artifact retention policy。

Provider、runtime 或 evidence 层失败不能静默切换到另一臂；必须按 failure taxonomy 记录并停止受影响的 pair。

## 5. Treatment Dose 合同

### 5.1 每次 outbound composition 必须记录

Runtime leg 的每次 provider-bound composition 至少记录以下 metadata；Native leg 对应 lifecycle 字段使用
`NOT_APPLICABLE`，不得伪造 Runtime 事件。计量严格拆成“唯一 lifecycle object”和“call exposure / persistence”两组：

```text
# unique lifecycle state (a read call/result pair is one object)
uniqueEligiblePairs
uniqueSelectedPairs
uniqueRemovedPairs
uniqueRemovedSourceElements

# call exposure / persistence
newRemovalPairCalls
carriedRemovalPairCalls
suppressedStalePairCallExposures
suppressedSourceElementCallExposures

tokensBeforeComposition
tokensAfterComposition
removedBytes
removedTokens
removedTokenRatio
firstInterventionCall
activeStaleElementsPeak
rehydrateCount
lifecycleUnknownCount
runtimeContextChanged
```

`uniqueEligiblePairs`、`uniqueSelectedPairs` 和 `uniqueRemovedPairs` 对一个生命周期 read pair 各计一次；
其两个 source keys（tool-call 与 tool-result）不能被当成两个 lifecycle objects。`uniqueRemovedSourceElements`
则按 source key 计数，通常一个成功移除的 pair 对应两个 source elements。

`newRemovalPairCalls` 只计首次发生 REMOVE 的 outbound call；同一个 pair 在后续 composition 继续被排除时，
只计入 `carriedRemovalPairCalls`。`suppressedStalePairCallExposures` 明确表示“一个 stale pair × 一个本来会进入
composition 的 outbound call”，不等同于 unique removal 次数；source-key 级的对应计量单独放在
`suppressedSourceElementCallExposures`。`removedTokens` 只有在 provider usage/token estimator 合同允许时才填写；
无法可靠估计时写 `UNAVAILABLE`，不填零。

### 5.2 Leg 级汇总

对每个 Runtime leg 汇总：

```text
uniqueEligiblePairs_leg                 = |union(unique eligible pair IDs)|
uniqueSelectedPairs_leg                 = |union(unique selected pair IDs)|
uniqueRemovedPairs_leg                  = |union(unique removed pair IDs)|
uniqueRemovedSourceElements_leg        = |union(removed source keys)|
newRemovalPairCalls                     = count(first REMOVE call per pair)
carriedRemovalPairCalls                 = count(later calls carrying a prior removal)
suppressedStalePairCallExposures        = count(pair, outbound) where stale pair is suppressed
suppressedSourceElementCallExposures    = count(source-key, outbound) where source key is suppressed
removedTokens_total                     = Σ removedTokens（可用时）
removedTokenRatio_leg                   = removedTokens_total / tokensBeforeComposition_total（可估计时）
firstInterventionCall                   = 第一个包含 newRemovalPairCalls 的 outbound call ordinal
activeStaleElementsPeak                 = 每次 composition 的 active stale elements 最大值
rehydrateCount                          = E0 中必须为 0，否则触发停止
lifecycleUnknownCount                  = 按 reason code 分桶
```

`uniqueRemovedPairs_leg` 描述生命周期状态；`newRemovalPairCalls`、`carriedRemovalPairCalls` 和
`suppressedStalePairCallExposures` 描述持续暴露抑制。三者必须分开报告，不能互相替代。

分母为零、字段缺失或证据不完整时使用 `NOT_ESTIMABLE`，不能默认为零。

### 5.3 Treatment Exposure Ratio

E0 新增 leg-level `treatmentExposureRatio`：

```text
treatmentExposureRatio
  = runtimeContextChanged_calls / runtime_outbound_calls
```

当 Runtime outbound calls 为零或 call-level join 不完整时，结果为 `NOT_ESTIMABLE`。该指标描述实际暴露，
不把 Runtime 标签本身当作 treatment 暴露。

同时记录 `suppressedStalePairCallExposures`：

```text
suppressedStalePairCallExposures
  = Σ 每个 outbound 中，已通过 SUPERSEDED + policy 选择、
    且在 provider-bound source/message 中缺席的 stale pair
```

它是观察到的 stale-pair call-exposure suppression 计数，不是未经观测的 counterfactual 发送量，也不能直接
等同于 token savings。`suppressedSourceElementCallExposures` 另行按 source key 计数。每个计数必须能回指
transition、replay record 和 provider-bound source membership。

## 6. 三层 outcome

### 6.1 Layer 1：Treatment integrity（硬门）

对进入 conditional treatment set 的 Runtime leg，以下条件必须全部成立：

```text
uniqueEligiblePairs > 0
uniqueRemovedPairs > 0
prePolicyProviderBoundMessagesHash != postPolicyProviderBoundMessagesHash
system/developer/tool/provider-native envelope preserved
replay/policy reconciliation = MATCH
tool-call/result atomicity preserved
protected evidence removed = 0
no fallback / no silent Native substitution
checkpoint and call-accounting join complete
```

这里的 provider-bound changed 是同一 Runtime outbound composition 在 policy 前后的
`prePolicyProviderBoundMessagesHash != postPolicyProviderBoundMessagesHash`；不是要求 Runtime 与 Native
在相同 ordinal 上拥有相同 trajectory，也不是把两条已经分叉的 agent trajectory 直接做 hash 比较。

任何条件无法判定都不能升级为 PASS；按 `TREATMENT_INACTIVE`、`UNKNOWN` 或 infrastructure/evidence failure
保留真实边界。

### 6.2 Layer 2：Task correctness

每个 leg 使用 live 前冻结的 evaluator 记录：

- objective oracle；
- regression oracle；
- final patch / expected writable scope；
- task outcome（`COMPLETE`、`FAILED` 或合同定义的任务失败类）；
- task failure 与 harness/infrastructure/evidence failure 的分类。

Oracle 只能用于结果判定，不能参与 Runtime policy 的 eligibility 或 removal decision。普通 objective failure、
regression failure 或 model task failure 必须先记录，再执行冻结的 matched counterpart；它们不能自动阻止另一臂。
若 failure 能由证据明确归因到误删、协议破坏或冷上下文恢复失败，pair 完成后触发 E0 safety stop；若归因不清，
保留 `INCONCLUSIVE` 而不强行解释为策略效果。

### 6.3 Layer 3：Efficiency

每个已确认 provider response 记录：

```text
provider input/output/cache-read/cache-write/total tokens
provider calls
tool calls and tool executions
per-turn latency
leg wall-clock
response and evidence completeness
```

Provider usage 缺失保持 `UNAVAILABLE`；不以配置价格、token estimator 或单次 token 下降推断成本或收益。
E0 的 latency、cache-read/cache-write、input/output/total token 和 paired efficiency delta 全部属于
exploratory observations；固定 4 对不足以分离 Provider cache、arm order 或后端调度波动。

## 7. Pair-level 归因与描述性分析

E0 只输出描述性、分层、可对账的结果：

```text
pair task / stratum / arm order
Native outcome vs Runtime outcome
Runtime unique lifecycle dose and call-exposure fields
unique objects vs new/carried/suppressed pair-call exposures
provider usage and latency deltas
failure taxonomy and attrition
replay / evidence / protocol verdicts
```

必须同时报告：

- ITT/opportunity：enrollment-enriched cohort 中的 eligibility/treatment recurrence、dose=0 比例和 attrition；
- conditional treatment：仅对满足 Layer 1 硬门的 Runtime leg 做方向性描述；
- safety：任何 hard-stop、任务失败、回归失败、证据缺口和运行时异常。

E0 不计算 confirmatory p-value，不声称 effect size 已稳定，不把一个 pair 的 token 下降写成“更有效”，
也不汇总成 Native-vs-Runtime 的总体因果结论。所有 paired delta、缺失值、排除理由和 `NOT_ESTIMABLE` 必须保留。
效率和 paired delta 仅作 exploratory directional observations，不触发 E0 PASS 或 `BETTER`。

## 8. E0 停止条件

以下任一实验失效事件发生，立即停止当前 pair，并禁止启动尚未执行的 counterpart；涉及扩样的事件还要把 E0 判为
`NO_GO` 或等待独立 adjudication：

```text
CONTRACT_CONFLICT > 0
protected evidence 被误删
tool protocol broken 或 call/result 不成对
Native/Runtime provider envelope 漂移
silent fallback 或臂切换
unreplayable intervention
unexpected REHYDRATE
ground-truth leakage into policy
evidence write gap / missing response receipt
usage or provider-binding mismatch
identity、budget、kill-switch 或 clean-revision gate 失败
shared fixture/environment corruption
```

### 8.1 Task failure 与 counterpart 规则

普通任务结果不是实验失效。以下信号必须先记录，并继续执行已经在 manifest 中冻结的 matched counterpart：

```text
objective oracle failure
regression oracle failure
model task failure / task outcome=FAILED
Runtime-only harness failure（sandbox、fixture、evidence 仍可独立可信时）
```

这类信号不能因为发生在 `NATIVE` 或 `RUNTIME` 就改变 arm order、删除 counterpart 或提前结束 pair。若 Runtime-only
harness failure 已造成 shared fixture/environment corruption、evidence corruption、identity/budget violation 或
其他第 8 节实验失效事件，则按实验失效处理并禁止 counterpart。独立 sandbox 中的普通 task failure 本身不能造成
outcome-dependent attrition。

| 首发信号 | counterpart | pair 记录 |
| --- | --- | --- |
| task/objective/regression/model failure | 必须执行 | `TASK_OUTCOME`，pair 完成后再 adjudicate |
| isolated Runtime harness failure | 必须执行 | `HARNESS_FAILURE`，conditional endpoint 失效但不丢弃 ITT |
| experiment invalidator（第 8 节） | 禁止执行 | `EXPERIMENT_INVALIDATED`，保留已发生证据与 attrition |

E0 不沿用“Native 失败则不执行 Runtime”的旧 canary 规则；只有实验失效事件可以阻止 counterpart。

### 8.2 效果层安全门

E0 不是安全性试验，但不能忽略小样本中的灾难性退化。以下定义在 live 前冻结：

- `SAFETY_STOP`：在 counterpart 已执行后，Runtime leg 出现可明确归因于 intervention 的 objective/regression failure、
  误删保护来源、禁止路径变更或协议破坏，即使只有一个 pair 也停止扩样；
- `SAFETY_REVIEW`：Runtime task/regression failure 多于 Native，或出现一例无法区分“任务失败”和“干预退化”的
  对内不一致结果；E0 保持 `INCONCLUSIVE`，未经 review 不进入 E1；
- Runtime 仅有 dose=0 或 evidence 不足时，不输出“无效”结论，只输出 opportunity / treatment inactive。

Token reduction、较低 input usage 或较少 provider calls 不能抵销 correctness failure 或 safety stop。

## 9. E0 通过与否

### 9.1 E0 PASS（窄定义）

只有同时满足以下条件才可记为 `E0 PASS / ELIGIBLE_FOR_E1_REVIEW`：

1. 固定的 4 个 matched pairs 均有 leg-level 状态记录，且至少 `2` 个 pair 的 Runtime leg 产生
   `uniqueEligiblePairs>0` 且 `uniqueRemovedPairs>0`（`nonZeroTreatmentPairs>=2`）；
2. 每个 conditional treatment leg 的 `prePolicyProviderBoundMessagesHash != postPolicyProviderBoundMessagesHash`、
   replay `MATCH`、协议不变量和 evidence join 均通过；
3. Native/Runtime envelope 与 pair binding 没有漂移，无 silent fallback；
4. task correctness、usage、latency、failure taxonomy 能按 leg/pair 完整归因；
5. 没有触发 `SAFETY_STOP`，也没有未经 adjudication 的 `SAFETY_REVIEW`；
6. 所有 dose=0、UNKNOWN、未完成 leg 和 attrition 均保留在 ITT 口径中。

E0 PASS 只表示：在 `HISTORICAL_OPPORTUNITY_ENRICHED` cohort 中，至少两对独立 pair 重现了可审计的 non-zero
treatment dose，且完整归因、质量/安全边界暂未阻止扩样。它是 enriched-cohort recurrence qualification，
不是一般 workload prevalence，也不等于策略有效。

### 9.2 E0 INCONCLUSIVE

以下任一情况记为 `E0 INCONCLUSIVE / HOLD`：

- 固定的 4 pairs 未全部形成可审计的 pair-level 状态，或 `nonZeroTreatmentPairs<2`；
- treatment integrity、replay、usage 或 outcome coverage 不足以归因；
- 只剩 task/harness failure，无法区分策略与基础设施；
- 出现 `SAFETY_REVIEW` 但尚未完成独立裁定；
- pair 数因合法 attrition 低于最小可解释范围。

### 9.3 E0 NO_GO

出现 hard invariant violation、ground-truth leakage、误删保护证据、silent fallback、unreplayable intervention
或明确的 treatment-attributable catastrophic regression 时，记为 `E0 NO_GO`。不得继续扩大样本或直接恢复原
64-leg。

## 10. Evidence schema 与审计字段

### 10.1 Enrollment manifest

live 前冻结的 E0 task manifest 至少包含：

```text
manifestId / schemaVersion / status
enrollmentCohort = HISTORICAL_OPPORTUNITY_ENRICHED
sourceObservationalStudy / enrollmentRuleHash
taskId / stratum / fixtureTreeObjectId / fixtureContentSha256
promptSha256 / objectiveOracleHash / regressionOracleHash
historicalOpportunityEvidenceRef / historicalEvidenceLimit
pairOrderQuota / randomizationSeed
```

`historicalOpportunityEvidenceRef` 只表示 enrollment 依据；它不能出现在 Runtime policy 的输入集合中。

### 10.2 Leg evidence

每个 leg 必须能通过稳定 IDs join：

```text
studyId / pairId / taskId / arm / runId / turnId / modelCallId
executionRevision / provider / model / endpoint / providerConfigHash
workingSetId / transitionId / providerBoundMessagesHash
prePolicyProviderBoundMessagesHash / postPolicyProviderBoundMessagesHash
providerBoundSourceKeys（metadata only）
uniqueEligiblePairs / uniqueSelectedPairs / uniqueRemovedPairs
uniqueRemovedSourceElements
newRemovalPairCalls / carriedRemovalPairCalls
suppressedStalePairCallExposures / suppressedSourceElementCallExposures
treatmentExposureRatio
replayVerdict / lifecycleUnknownCount / rehydrateCount
response outcome / usage / tool counts / latency
task outcome / oracle status / failure taxonomy
checkpoint completeness / call accounting
```

禁止保存 prompts、assistant 原文、raw provider payload、authorization header、凭据或未裁剪的 tool result 内容。

### 10.3 Pair adjudication

每个 pair 必须有一条只含 metadata 的 adjudication row：

```text
pairStatus = COMPLETE | INCOMPLETE | INVALID_FOR_ENDPOINT
nativeOutcome / runtimeOutcome
nativeDose = NOT_APPLICABLE
runtimeDoseSummary
conditionalTreatmentEligible
taskCorrectnessCoverage
efficiencyCoverage
safetyVerdict
exclusionReason（如有）
```

缺少一侧的 provider response、evidence write failure 或无法重建的 transition 不得补零；按 scope 保留 UNKNOWN。

## 11. Live 前置门与授权边界

E0 执行前必须按以下顺序完成：

```text
E0 contract review
        ↓
immutable enrollment manifest（历史机会仅用于采样）
        ↓
immutable E0 run contract（task IDs、seed、budgets、provider/model）
        ↓
credential-free Native/Runtime treatment readiness
        ↓
ground-truth leakage audit + replay/evidence audit
        ↓
independent review
        ↓
fresh owner authorization
        ↓
4 paired live runs
        ↓
sanitized E0 adjudication
```

每次 E0 live run 必须：

- 使用 Node `>=24.0.0 <25.0.0` 和干净 checkout；
- 绑定 exact `executionRevision`、task manifest hash、run contract hash、provider/model 和 randomization seed；
- 使用 fresh single-use study identity；terminal、crash、timeout、evidence failure 后均不得 resume/retry/reuse；
- fallback 固定为 `NONE`；Provider、model、工具、参数或 envelope 不得动态切换；
- 将 owner authorization、预算、数据范围和 `claims=directional qualification only` 写入不可变 binding；
- 先完整落盘 response/evidence，再做 task adjudication；任何静默缺口都触发停止。

本文件不创建 live authorization，不复用 SV2 identity `c1-lifecycle-sv2-20260909-ef4d90a2`，不恢复 C1 64-leg。

## 12. E1 与 64-leg 的闸门

只有 E0 `PASS / ELIGIBLE_FOR_E1_REVIEW`，并完成新的独立 review 与 owner authorization 后，才可设计 E1：

- E1 规模：`8–16` matched pairs；
- 主要观察：success delta、provider usage delta、calls/latency delta、failure taxonomy、dose-response；
- E1 仍需预注册 correctness non-inferiority 和 efficiency endpoint hierarchy；
- E1 结果与 attrition、dose=0、UNKNOWN 分层报告，不把 Runtime 标签当作暴露。

原 C1 64-leg 必须等待 E1 和后续 gate。E0 PASS 或 E1 方向性结果都不能自动恢复 64-leg；恢复需要新的正式
effectiveness run contract、独立 review 和单独 owner authorization。

## 13. 待后续 run contract 冻结的项目

本设计批准前置研究，不替代执行绑定。以下项目必须在 live 前另行冻结：

1. 固定的 4 个 pair 与 task IDs；
2. enrollment rule 的 hash、历史证据限制和每个 task 的 fixture/oracle hash；
3. arm-order quota 与随机化 seed；
4. provider/model、参数、每-leg/study budgets、timeout、output limit；
5. correctness failure、catastrophic regression 和 attrition 的具体 adjudication owner；
6. E0 输出目录、artifact hash、retention 和审计共享方式；
7. dose / exposure / replay 字段的 schema version、实现支持和 credential-free regression tests；
8. 覆盖上述全部字段的 fresh owner authorization。

直到这些字段冻结并通过 review，E0 execution 保持 `NO_GO`。

## 14. 当前裁定

```text
SV2 real Provider-bound pure eviction       PASS / CLOSED / MECHANISM_ONLY
Mechanism Canary SV3/SV4                    STOP / DO NOT EXTEND
E0 contract design                          DESIGN_REVISION_2 / DESIGN_GO
E0 live execution                           NO_GO / PENDING RUN CONTRACT + AUTHORIZATION
E1                                          HOLD FOR E0
C1 original 64-leg                          NO_GO
```

最强可用叙述是：Context Runtime 已在一次受控真实请求中证明可执行 provider-bound pure eviction；下一步
必须先证明这种干预在 `HISTORICAL_OPPORTUNITY_ENRICHED` cohort 中能以完整归因、至少两对 non-zero dose 和可接受
安全边界运行，才值得扩大到 E1。
