# Context Runtime 正式研究立场与阶段性复盘

日期：2026-09-11（Asia/Shanghai）

## 正式口径

截至目前，我们证明了 Context Runtime 的机制可达性、真实 Provider 边界可达性和证据治理能力，但尚未得到
可识别的 Native-vs-Runtime treatment effect。现有真实 E0 主要测量的是 execution feasibility、natural
triggerability 和 evidence integrity。

因此，当前项目不能声称 Runtime 已经改善任务正确性、稳定性、token 使用、延迟或成本；同样不能从这些实验
得出 Runtime 无效。Effectiveness estimand 尚未形成足够完整的 matched-pair 观测。

## 证据分层

| 证据层                         | 当前判断                                 | 可支持的事实                                                                                  | 不能支持的事实                                      |
| ------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Mechanism correctness          | `PASS / MECHANISM_ONLY`                  | SV2 在真实 Provider 上完成 harness-seeded 的 replay、SUPERSEDED adjudication 和纯 eviction    | 自然模型会触发该机制、任务会受益                    |
| Provider-bound reachability    | `PASS`                                   | authorized adapter 能按冻结 envelope、model、endpoint 和 request hash 发出请求并解析 usage    | Provider 工具语义或 Runtime 效果                    |
| Evidence governance            | `PASS（经多轮修复）`                     | response/checkpoint、partial failure、usage provenance、identity 和禁止复用规则已被测试并加固 | 历史缺口可以被回填                                  |
| Semantic lifecycle opportunity | `OBSERVED / ENRICHED HISTORICAL SAMPLE`  | V4 的 ground-truth-assisted 分析给出 stale-version 现象精确下界 `≥16/19（84.2%）`             | formal policy eligibility、实际 intervention 或效果 |
| Formal natural triggerability  | `INSUFFICIENT / ZERO IN CURRENT LIVE E0` | V4/E0 自然 Runtime 轨迹的 formal `lifecycleEligible=0`、`contextChanged=0`、`REMOVE=0`        | stale-version 现象不存在、策略永远不会触发          |
| Execution feasibility          | `UNRESOLVED`                             | E0 中 Native 有完成轨迹；Runtime 在两个真实尝试中都没有形成可用完整 pair                      | Runtime 本身导致失败                                |
| Treatment exposure             | `INSUFFICIENT`                           | SV2 有人为构造的 dose；真实 E0 没有完成的非零 Runtime dose                                    | dose>0 子集的因果效果                               |
| Causal effectiveness           | `NOT MEASURED`                           | 目前没有可用的完整真实 matched-pair estimator                                                 | Native-vs-Runtime 优劣                              |

## 各轮实验的正确解释

### C1 初次 live attempt

第一次正式 C1 live 只完成了 Provider/usage 前置尝试，1 次请求、0 个完成 leg，因 capability mismatch 终止。
它是 readiness failure，不是 Runtime 结果。

### 机制 Canary V1–V3

三次真实诊断共 5 次 Provider 调用。模型在重复读取门分别表现为 `2→1`、`2→1`、`1→0`，三次都在 Native
门停止，Runtime 没有获得执行机会。

这支持“该模型在这种诊断形态下不能仅靠提示稳定地产生所需重复读取”，不支持“模型不调用工具”或“Runtime
不能移除陈旧上下文”。这类门控实验测量的是模型行为前置条件，不是 treatment effect。

### 生命周期 Canary SV1

SV1 只有一次真实请求。响应在诊断停止前没有进入完整持久化路径，因此 `outcome`、tool 数、assistant 内容和
usage 均未知。早期的 `toolResults=[]`、`changedCalls=[]`、`answerMatched=false` 不能解释为模型行为。

该轮主要产出是 evidence-system incident；修复后没有回填历史原件。

### 生命周期 Canary SV2

SV2 由 harness 预先构造 `read v1 → edit SUCCESS → v2`，随后真实 Provider 请求观察到陈旧 pair 被 Runtime
移除。它证明了真实 Provider 边界上的机制可达性，属于 `MECHANISM_ONLY`，不代表自然模型触发率、任务效果或成本
收益。

### C1 V4

V4 计划 64 leg，实际尝试 19、完成 18，完成 pair 仅 9/32；100 个 Runtime response 没有记录 lifecycle
eligibility 或 context change。由于样本不完整、任务层不平衡、oracle 未完成，V4 只能作为观察性 prevalence/
attrition 证据，不能作为 64-leg effectiveness 结果。

### E0 credential-free runner

4 pairs / 8 legs 的 A–D scripted fake study 验证了 scheduler、budget、Dose、counterpart 和终止状态机。它
没有模型行为或 Provider usage 的效度，因此 `PASS` 只表示 wiring qualification。

### E0 live `b88b0b56`

第一次 E0 live 在 Native leg 使用 24 次请求后未得到 terminal outcome。旧报告把已经 checkpoint 的 24 个 response
和 37 个工具事件投影成零，暴露失败路径的 evidence projection 缺陷。该 identity 已永久消耗，原报告不可回填。

### E0 live `9cb656f5`

修复后的第二次 E0 live 中：

- Native leg 13 个 response 后完成，objective/regression oracle 均通过；
- Runtime leg 使用 24 个 response、45 个 tool request/execution，其中有工具错误，但仍没有 terminal outcome；
- Runtime 没有 lifecycle eligibility、context change 或 Dose；
- 其余 6 个 legs 按实验失效规则被阻断；
- study 结果为 `NO_GO`，不能形成完整 matched pair。

这是一条真实的 execution-feasibility 与 zero-trigger 观测，不是 Runtime treatment failure。Runtime 使用的 token、
工具调用和失败轨迹只能作为未完成轨迹的描述性证据，不能与 Native 做效率或效果比较。

## 已发现的偏差与控制状态

### 1. Study-control / attrition 偏差

当前控制流把 Runtime leg 的 `maxCalls=24` 终止提升为 study invalidator，并阻断 counterpart 和后续 legs。这会
放大单腿失败对样本量的影响。下一版合同必须明确区分：

```text
LEG_BUDGET_EXHAUSTED
  = leg-level feasibility failure

EXPERIMENT_INVALIDATOR
  = shared identity / budget / evidence / infrastructure integrity failure
```

只有后者才应终止整个 study；前者是否继续 counterpart，需要另行冻结规则。

### 2. Enrichment 与选择偏差

E0 使用 `HISTORICAL_OPPORTUNITY_ENRICHED` cohort，只选两个任务并复制成四个 pair。它适合检验机制，但不代表
普通任务分布。V1–V3、SV1 和 E0 的早停还会让最终可见样本偏向能通过前置门的轨迹。

### 3. 构念偏差

重复读取、harness-seeded eviction、fake state-machine PASS 和真实 task completion 分别属于不同构念。把它们
写成同一个“Runtime 效果”会产生构念混淆；后续报告必须显式标注 mechanism、feasibility、triggerability 和
effectiveness。

### 4. 测量偏差

SV1、第一次 E0 和 #116 暴露了响应、工具事件、失败 leg、cleanup 和 unknown 值的投影风险。现在的治理规则已
改为：完整 row 与 partial checkpoint 分层、未知不填零、历史原件不回填、失败 identity 不复用。后续每次 run
仍需以 checkpoint 与最终 manifest 双向对账。

### 5. Confounding

当前真实证据只有一个 Provider、一个模型、少量 enriched tasks 和固定 24-call budget。Runtime 额外引入的
上下文规划、工具错误恢复和 lifecycle policy 与任务复杂度、模型工具策略、预算上限纠缠在一起，不能单独归因。

### 6. Adaptive research degrees of freedom

实验从 V1–V3、SV1、SV2、V4 再到 E0，是根据前一轮结果逐步调整的探索性序列。它适合发现问题，不适合把所有轮次
汇总成一个确认性效果估计。每一次合同、identity、execution revision 和授权都必须作为独立研究记录。

## 研究诚信判断

目前看不到 cherry-picking 或用失败结果伪造正向效果的证据。相反，多数真实运行都在前置门或证据门处停止，且：

- 终止 identity 没有恢复、重试或复用；
- fake、harness-seeded 和真实 Provider 证据没有混合；
- 不完整 response 没有被解释成模型拒绝工具；
- unknown、未执行和不完整 pair 被保留；
- CI、代码 review 和真实执行授权被分开记录。

因此，当前主要问题是**外部效度和 estimand 尚未成熟**，不是已经得到一个被夸大的正向结论。

## 下一阶段的三项研究

以下是候选研究包，均需各自冻结设计、独立 review 和 fresh authorization，不能直接沿用 E0 identity。

### F0 — Execution Feasibility

先只研究模型能否稳定完成冻结任务，建议先使用 Native-only、相同 Provider/model/tool envelope 和多个 fresh
independent runs。主要指标是 completion rate、calls、tool-error rate、budget exhaustion、objective/regression
oracle 和 unknown rate。F0 的目的不是比较 Runtime，而是确认 benchmark 本身在预算内可执行。

### T0 — Natural Triggerability

T0 不是重新证明旧版本现象是否存在，而是研究 Runtime 能否在不读取 ground truth 的情况下，从自然 Agent
trajectory 中稳定识别并形成 formal treatment opportunity。在不把 dose>0 子集当作因果样本的前提下，观察自然
轨迹中的：

```text
READ → mutation → version change → SUPERSEDED eligibility
```

主要指标是 eligible Runtime legs、non-zero dose rate、first-trigger position、unique stale pairs、removed
source elements、carry persistence 和 UNKNOWN/contract-conflict rate。T0 要区分以下链条：

```text
Semantic lifecycle opportunity
        ⊇
Formal policy eligibility
        ⊇
Actual intervention / dose
```

因此，V4 的 `≥16/19（84.2%）` 是 enriched historical sample 中语义机会的下界，不等于 Runtime 已经
trigger；当前 E0 的 `lifecycleEligible=0` 也不等于语义机会不存在。

### E1 — Treatment Effect

只有 F0 表明任务完成率和预算可接受，且 T0 在多个 distinct tasks 上反复观察到非零自然 dose 后，才进入真正的
Native-vs-Runtime matched-pair effectiveness。E1 的 primary 应是预先分配的 ITT-like pair analysis；dose-conditioned
结果只能作为 secondary descriptive analysis。必须同时报告 correctness、regression、usage、calls、latency、
failure taxonomy、attrition 和 unknown，不用 dose>0 事后筛选替代主分析。

## 当前阶段裁定

```text
Formal research stance       ACCEPTED AS WORKING POSITION
Mechanism reachability       PASS / MECHANISM_ONLY
Natural triggerability       PARTIALLY OBSERVED
Execution feasibility        UNRESOLVED
Treatment exposure           INSUFFICIENT
Causal effectiveness         NOT MEASURED
Current E0 live attempt      TERMINAL / NO_GO
E1                           HOLD
C1 original 64-leg           NO_GO
```

后续任何“Runtime 有效”或“Runtime 无效”的表述，都必须等到新的、完整的 matched-pair evidence；在此之前，项目
应优先研究 agent trajectory 和 study-control，而不是继续堆叠未经触发的 Runtime policy。
