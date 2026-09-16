# C1 Feasibility Construct Repair v1 — 设计合同

日期：2026-09-15（Asia/Shanghai）

| Field | Value |
|---|---|
| Contract ID | `C1_FEASIBILITY_CONSTRUCT_REPAIR_V1` |
| Status | `DESIGN_ONLY → superseded by READY_FOR_SYNTHETIC_VALIDATION`（见 synthetic validation 文档；promotion head `cbc7538`） |
| Freeze candidate | `docs/plan/c1-feasibility-construct-repair-v1-synthetic-validation-freeze-2026-09-15.zh-CN.md` |
| Predecessor | F1-32 Failure Anatomy v1（LOCKED） |
| Anatomy doc | `docs/verification/cspv-c1-f1-32-failure-anatomy-v1-2026-09-15.zh-CN.md` |
| Consumed study (immutable) | `c1-f1-32-20260915-11df369c` |
| Scope | Prospective construct definition + zero-Provider validation design |
| Not in scope | F1-40、R0/T0/E1 live、历史 F0/F1 重判、阈值改写 |

## 0. 路线锁定

```text
Failure Anatomy v1          COMPLETE
Contract Repair Design      GO   ← 本文
Native Mechanism Design     HOLD / SECONDARY
F1-40 live                  NO_GO
R0 live                     HOLD
T0 / E1                     HOLD
```

本设计**不是** F1 的补丁，也不是对 `unrecoveredToolFailure` 的事后放宽。它单独定义更准确的
**agent execution feasibility construct**，供后续 prospective validation 使用。

## 1. 为什么先做 Construct Repair，而不是 Native Mechanism Study

Failure Anatomy v1 已给出：

```text
R = NOT_ALIGNED_AS_FEASIBILITY_PROXY
M = PARTIAL_MECHANISM_CANDIDATES_IDENTIFIED
C = CONTRACT_REPAIR_CANDIDATE
```

- **R/C 证据强**：t1 裁判样本在 task success、oracle PASS、trajectory RECOVERED、无 budget exhaustion
  时仍因 strict per-tool linkage 使 feasibility / frontier driving 失败。
- **M 仍 partial**：t2 有机制候选与 run-14 纯任务失败对照，但尚未完成可授权的机制研究规格。

因此下一跳优先把“feasibility 由什么构成”定清楚；再决定是否、以及如何做 Native mechanism study。

## 2. 不可违背的历史不变式

```text
Historical F0 / F1 outcomes
  = IMMUTABLE UNDER ORIGINAL CONTRACT

Repair contract
  = prospective only

Forbidden:
  retrospective reclassification of consumed studies
  threshold rewriting on sealed evidence
  reinterpretation that changes pointLabel / gate vectors of F0-v2 or F1-32
  reuse of consumed identities
```

F1-32 的 `VALID_INFEASIBLE` + `FRONTIER_INCONCLUSIVE_NON_BUDGET` 保持为原合同下的终局事实。

## 3. 四个设计问题与回答草案

### Q1. Feasibility construct 的正式定义是什么？

**Execution feasibility（本 repair 的 primary estimand）** 定义为：在冻结的 task / tool /
oracle / evidence 规则下，一条 run 是否同时满足：

```text
semantic feasibility PASS
AND trajectory recovery acceptable under Layer-2 rule
AND evidence + provenance completeness PASS
```

它**不**要求 Layer-3 linkage completeness 作为充分否决条件。

### Q2. Strict linkage 应是 feasibility gate、safety gate，还是 diagnostic axis？

**默认定位：`SAFETY_OR_OBSERVABILITY_GATE` + 强制 diagnostic axis。**

- 可以单独形成 safety / observability 失败或 HOLD。
- **禁止**在无 semantic consequence 时单独定义 `execution infeasibility`。
- 报告中必须同时输出 Layer-1 / Layer-2 / Layer-3，不得只报合成布尔。

### Q3. Trajectory recovery 与 per-tool linkage 如何同时保留？

采用**强制双层（实为三层）并行记录**，禁止互相覆盖：

```text
Layer 1 — Semantic feasibility
  terminal / task completion disposition
  objective oracle
  regression oracle
  evidence completeness
  provenance completeness

Layer 2 — Recovery trajectory
  trajectoryRecoveryOutcome
  semantic recovery after tool failure
  （是否在工具失败后仍收敛到可判定的任务终态）

Layer 3 — Observability / linkage quality
  strictPerToolRecoveryLinkageCompleteness
  missing recoveryOfToolCallId（若适用）
  recoveryAttemptOrdinal integrity
```

### Q4. 什么证据足够支持进入下一轮 prospective validation？

进入 **zero-Provider / synthetic construct validation** 的前置：

1. 本文分层定义冻结为 `READY_FOR_SYNTHETIC_VALIDATION`（非 live）。
2. 假 Provider / 合成轨迹能稳定区分 §5 四类。
3. 明确写出：旧 F0/F1 结果不被回写；新定义只用于新 identity。
4. Owner 授权仅覆盖 synthetic / zero-Provider 包（若实现需要），**不含** Provider live。

通过 synthetic validation 后，才分别评估：

```text
Native Mechanism Design     （回应 M）
可选的新 Native feasibility point contract
R0 design-only              （仅当 blocker 映射到 Runtime 可作用面）
```

## 4. 写死的关键原则

> **Layer 3 可以形成 safety / observability gate 或诊断，但不能在没有 semantic consequence
> 的情况下单独定义 execution infeasibility。**

推论（设计约束）：

```text
semantic success + linkage incomplete
  → Layer-1 feasibility may PASS
  → Layer-3 observability may FAIL / HOLD
  → MUST NOT auto-label EXECUTION_INFEASIBLE solely from Layer-3

semantic failure + linkage complete
  → Layer-1 feasibility FAIL
  → Layer-3 may PASS
  → failure attributed to M (or other Layer-1 causes), not “recovered”

Frontier / budget continuation rules in future contracts
  MUST be driven by Layer-1 (+ declared Layer-2 policy)
  MUST NOT be solely driven by Layer-3
```

这直接回应 F1-32 的 t1 裁判样本与 `FRONTIER_DRIVING_GATE` 被 non-budget linkage 打断的问题。

## 5. Prospective synthetic validation（零 Provider）

在任何新 Native live 之前，先做 **construct validation corpus**，覆盖：

```text
A  semantic success + linkage complete
B  semantic success + linkage incomplete
C  semantic failure + linkage complete
D  semantic failure + linkage incomplete
```

每类至少保留：固定 fixture、可脚本注入的工具失败与（可选）缺失 linkage 元数据、oracle 判定、证据完整性检查。

**通过标准（设计目标，待实现规格细化）：**

| Case | Layer-1 feasibility | Layer-3 observability | 允许的合成标签 |
|---|---|---|---|
| A | PASS | PASS | feasible + observable |
| B | PASS | FAIL/HOLD | feasible + observability deficit（≠ infeasible） |
| C | FAIL | PASS | infeasible（任务/oracle） |
| D | FAIL | FAIL/HOLD | infeasible + observability deficit（分列报告） |

若实现无法稳定区分 A/B，则 construct repair **未**就绪，不得进入新 Native live point。

## 6. 与旧度量的映射（仅说明，不回写）

| 旧 F0/F1 字段 | Repair 中的位置 |
|---|---|
| `runDisposition` / oracle / evidence / provenance | Layer 1 |
| `recoveryStatus`（trajectory） | Layer 2 |
| `diagnostics.unrecoveredToolFailure` / strict linkage rate | Layer 3 |
| 旧 `feasibilityGate.unrecoveredToolFailure` 作为 feasibility 否决 | **退役于 prospective contracts**；保留为 Layer-3 / safety |

历史 study 仍按其原合同解释；本表只约束**未来**合同。

## 7. 明确不做

- 不授权 F1-40 / F1-48 Provider live
- 不启动 R0 / T0 / E1 live
- 不修改 `c1-f1-32-20260915-11df369c` live-output 或 `.audit/` 闭合包
- 不把 F1-32 的 unrecovered 成功轨迹改判为“原本就该 PASS frontier”
- 不在本设计阶段实现 Runtime intervention 或声称 rescue 效果

## 8. 交付物与完成定义（Design 阶段）

本设计阶段完成当且仅当：

1. 本文（或后继 revision）冻结 §3–§5 的分层与原则，状态升为
   `READY_FOR_SYNTHETIC_VALIDATION`。
2. 另立 **synthetic corpus + zero-Provider harness 规格**（可同目录后续文档），映射四类轨迹。
3. 写明假 Provider 回归如何断言：B 类不得被标成 execution infeasible。

**不**要求本阶段合并代码或创建 study identity。

## 9. 完成后的分流

```text
Synthetic construct validation PASS
  → 可开：Native Mechanism Design（M）
  → 可开：prospective Native feasibility contract（新 identity；显式采用 Layer-1/2/3）
  → 仍 HOLD：R0 live，除非机制研究证明 Runtime-actionable surface

Synthetic construct validation FAIL
  → 留在 construct repair；不得用 live budget frontier“绕过”定义问题
```

## 10. 一句话

F1 已证明：在当前合同下，**calls 不是唯一自变量，linkage 也不是 feasibility 的同义词**。  
`C1_FEASIBILITY_CONSTRUCT_REPAIR_V1` 的任务是把该认识写成可验证的分层 construct，而不是继续加预算碰运气。
