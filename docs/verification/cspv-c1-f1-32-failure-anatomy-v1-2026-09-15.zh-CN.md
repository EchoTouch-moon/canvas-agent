# CSPV C1 F1-32 Failure Anatomy v1

| Field | Value |
|---|---|
| Document | `F1 Failure Anatomy v1` |
| Status | `LOCKED` |
| Kind | Sealed-evidence decision document（非 live 重跑、非 gate 改写） |
| Study ID | `c1-f1-32-20260915-11df369c`（consumed；禁止 retry/resume/reuse） |
| Live package | `research/context-benchmarks/.live-output/c1-f1-32-live/c1-f1-32-20260915-11df369c/`（IMMUTABLE） |
| Audit package | `…/c1-f1-32-20260915-11df369c.audit/`（`POST_RUN_AUDIT_CLOSURE`；IMMUTABLE AFTER CLOSURE） |
| Authoritative live tree digest | `b07ca361c7f4b854b4fc79c5366f5aa3f40db54789bfaee1c8a32f0e3505fb8a` |
| Chat-only retired digest | `ee509c4b…`（非正式 witness） |
| Authorization canonical SHA-256 | `745b6b6245271657f728544d2a349027163566abba02496ba848ce42cd7f40e1` |
| Machine record | `research/context-benchmarks/.live-output/c1-f1-32-live/c1-f1-32-20260915-11df369c.failure-anatomy-v1.json` |

## 1. Locked research state

```text
F0-v2 @24
VALID / NATIVE FEASIBILITY NO_GO

F1-32
VALID_INFEASIBLE

Frontier identification
TERMINATED

Reason
NON_BUDGET BLOCKERS BREAK SINGLE-VARIABLE FRONTIER ASSUMPTION

Observed transition bracket
NONE

Next authorized research
SEALED-EVIDENCE FAILURE ANATOMY ONLY  →  this document closes that step

F1-40
NO_GO

R0 / T0 / E1 live
HOLD
```

科学结果有效性：`UNCHANGED`。本文件不重开 feasibility adjudication，只对已冻结 gate 向量做机制拆解与决策分流。

## 2. What F1-32 must not be collapsed into

F1-32 不是单一“失败”结论。它至少拆成三个性质不同的问题：

```text
R = recovery / linkage construct
M = model / task mechanism
C = contract / measurement construct
```

总体终态 `28 TERMINAL_COMPLETE / 2 TERMINAL_FAILED / 2 BUDGET_EXHAUSTED` 只是描述性汇总，**不能**单独驱动 frontier 或 Runtime 决策。

## 3. Point adjudication (frozen; recomputed join)

| Gate | Result |
|---|---|
| validity | PASS |
| precision | PASS |
| provenance / evidence safety | PASS |
| t1 all feasibility gates | FAIL（仅 strict unrecovered-tool） |
| t2 oracle | FAIL |
| t2 strict recovery | FAIL |
| t2 budget-sensitive composite | FAIL |
| `FRONTIER_DRIVING_GATE` | FAIL |
| `pointLabel` | `VALID_INFEASIBLE` |
| frontier disposition | `FRONTIER_INCONCLUSIVE_NON_BUDGET` |

分任务（各 16/16 adjudicable；unknown=0；one-sided 95% Clopper–Pearson）：

| Task | success L95 | budget U95 | unrecovered U95 | oracle L95 |
|---|---|---|---|---|
| t1 | 16/16 → 0.829 PASS | 0/16 → 0.171 PASS | 2/16 → 0.344 **FAIL** | 16/16 → 0.829 PASS |
| t2 | 12/16 → 0.516 FAIL | 2/16 → 0.344 FAIL | 7/16 → 0.667 FAIL | 13/16 → 0.583 FAIL |

门槛：success/oracle L95 ≥ 0.80；budget/unrecovered U95 ≤ 0.20。

## 4. Priority cohorts

### 4.1 t1 referee samples（最强证据）

| runId | terminal | oracle | trajectory recovery | unrecovered | budget |
|---|---|---|---|---|---|
| `…-run-03-6754f6cb` | COMPLETE | PASS | RECOVERED | true | false |
| `…-run-27-4d94c9ae` | COMPLETE | PASS | RECOVERED | true | false |

共同模式：`COMMAND_FAILED`（bash / package·test 探测类），任务与 oracle 均成功。

这两个样本直接证明：

> `strict unrecovered-tool linkage failure` 至少在部分轨迹上**不是** execution feasibility failure 的同义词。

### 4.2 t2 unrecovered（n=7）— 不得自动等同 semantic failure

| 子集 | n | runs（短号） |
|---|---:|---|
| success + oracle PASS（linkage-only） | 4 | 02, 08, 22, 28 |
| semantic/terminal fail + unrecovered | 3 | 20, 24, 32 |

全 study 口径：unrecovered 9 次中，**6** 次仍为 success+oracle PASS；**3** 次伴随 semantic/terminal 失败。

### 4.3 t2 oracle FAIL（n=3）

全部为 `objectiveOracleStatus=FAIL` 且 `regressionOracleStatus=PASS`。

| runId | unrecovered | terminal | 备注 |
|---|---|---|---|
| `…-run-14-79482bd8` | **false** | TERMINAL_FAILED | 纯 `M_TASK_ORACLE_FAILURE` 对照 |
| `…-run-20-36ec94e9` | true | TERMINAL_FAILED | M + R |
| `…-run-24-80252630` | true | BUDGET_EXHAUSTED | M + R + budget candidate |

### 4.4 t2 budget exhausted（n=2）— 仅 candidate

| runId | oracle | 标签 |
|---|---|---|
| `…-run-24-80252630` | FAIL | `BUDGET_SENSITIVE_CANDIDATE` |
| `…-run-32-d1c63eb6` | PASS | `BUDGET_SENSITIVE_CANDIDATE`（ceiling ≠ semantic failure） |

禁止写成 “more budget would fix it” 或外推 F1-40 会成功。

## 5. Three independent verdicts

### R verdict — recovery / linkage construct

**问题：** strict per-tool linkage 是否与 intended feasibility construct 对齐？

**证据：** trajectory `RECOVERED` 与 strict unrecovered 可并存；6/9 unrecovered 轨迹语义成功。

**Verdict：** `NOT_ALIGNED_AS_FEASIBILITY_PROXY`（至少在观测到的成功轨迹上）。  
strict linkage 仍可能是有价值的 **safety / observability** 度量，但**不能**再被默认当作 feasibility 否决条件的充分同义词。

### M verdict — model / task mechanism

**问题：** t2 semantic/task failure 实际由什么造成？

**证据：**

- run-14：oracle FAIL 且 **无** unrecovered → 至少一部分 t2 失败是纯粹任务/目标失败。
- 失败轨迹中反复出现 `EDIT_MATCH_COUNT`、错误探测类 `COMMAND_FAILED`；budget exhausted 轨迹伴有 edit thrash（尤其 run-32）。

**Verdict：** `PARTIAL — MECHANISM CANDIDATES IDENTIFIED`。  
候选机制（需后续 Native mechanism study，而非加 calls）：edit thrash、incorrect file targeting、insufficient convergence、premature completion、objective 未满足。  
**尚不足以**把 blocker 归因到 Runtime 可作用面。

### C verdict — contract / measurement construct

**问题：** 冻结 feasibility gate 是否在测我们意图中的 construct？

**证据：** t1 裁判样本在 success/oracle/budget 全过时仍因 strict linkage 使 `allT1Gates` 与 `FRONTIER_DRIVING_GATE` 失败，从而阻断单变量 budget frontier。

**Verdict：** `CONTRACT_REPAIR_CANDIDATE`。  
这是 **候选**，不是已授权的 gate 修改。禁止对已消费 F1-32 做 post-hoc relaxation。

## 6. Candidate dual-layer metrics（design only; not applied)

若进入 contract repair 设计，**不**建议简单删除 strict linkage。候选双层结构：

```text
old metric (as used in F1-32 feasibility gate):
  strict per-tool recovery linkage  →  unrecoveredToolFailureRunRate

candidate companion split:
  Safety / observability metric:
    strictPerToolLinkageCompleteness

  Feasibility metric:
    trajectoryRecoveryOutcome + semantic/oracle outcome
```

任何替换都需要：**新合同、新 binding、新 identity、新授权**；不得回写本 study。

## 7. Decision table

| Question | Current evidence | Decision |
|---|---|---|
| strict linkage == semantic failure? | 明确否定：6/9 unrecovered 仍 success+oracle PASS | **NO** |
| t1 blocker budget-related? | 0/16 budget exhaustion | **NO** |
| t2 blocker purely linkage-related? | run-14 反例 | **NO** |
| t2 blocker purely budget-related? | 仅 2/16 exhausted，且 oracle mixed | **NO** |
| current feasibility construct needs review? | t1 裁判样本强支持 | **YES — CANDIDATE** |
| safe to continue 40-call frontier? | `FRONTIER_DRIVING_GATE` FAIL | **NO** |
| safe to launch Runtime rescue live? | blocker 未归因到 Runtime 可作用面 | **NO** |

## 8. What is authorized next / what is not

**Authorized after this document：**

1. Contract/measurement repair **design**（双层指标草案、不变式、假 Provider 回归规格）——仍非 live Provider。
2. Native execution mechanism study **design**（聚焦 t2 M 线；与 linkage 分列）。
3. 可选：R0 **design-only** 笔记（仅当机制研究把 blocker 映射到 Runtime 可作用面之后才考虑 live）。

**Not authorized：**

- F1-40 / F1-48 live
- 复用 `c1-f1-32-20260915-11df369c`
- 修改本 study 的 live-output 或 `.audit/` 闭合包
- 将 `BUDGET_SENSITIVE_CANDIDATE` 写成预算因果结论
- R0 / T0 / E1 live

## 9. Closing statement

F1 Native Feasibility Frontier 已正式终止于 non-budget inconclusive。  
下一步研究价值不在“多少 calls 才够”，而在定义：

> **agent execution feasibility 到底应由哪些可观测构成。**

本 v1 将 R/M/C 分流锁定；后续任一新实验线必须携带独立合同与授权，并显式声明它回应的是 R、M 还是 C，而不是无名的“F1-32 失败重试”。
