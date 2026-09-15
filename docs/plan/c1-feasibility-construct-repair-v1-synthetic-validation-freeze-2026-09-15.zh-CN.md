# C1 Feasibility Construct Repair v1 — Synthetic Validation Freeze Candidate

日期：2026-09-15（Asia/Shanghai）

| Field | Value |
|---|---|
| Contract ID | `C1_FEASIBILITY_CONSTRUCT_REPAIR_V1` |
| Status | `READY_FOR_SYNTHETIC_VALIDATION_FREEZE` |
| Execution | `ZERO_PROVIDER` / `liveExecution=FORBIDDEN` / `historicalOutcomeMutation=FORBIDDEN` |
| Machine contract | `research/context-benchmarks/construct-repair/c1-feasibility-construct-repair-v1.freeze-candidate.json` |
| Synthetic corpus | `research/context-benchmarks/construct-repair/synthetic/corpus.v1.json` |
| Adjudicator | `research/context-benchmarks/src/feasibility-construct-repair/adjudicate.ts` |
| Tests | `research/context-benchmarks/tests/feasibility-construct-repair-v1.test.ts` |
| Design predecessor | `docs/plan/c1-feasibility-construct-repair-v1-design-2026-09-15.zh-CN.md` |

## 目的

把 Layer 1/2/3 从设计叙述推进为**可机器裁决**的冻结候选规格，并附零 Provider synthetic suite。

本阶段**不**创建 fresh study identity，**不**发起 Provider calls，**不**回写 F0/F1 历史 verdict。

## 可证伪主张

> Linkage quality 与 execution feasibility 是两个相关但**不等价**的 construct。

Synthetic validation 必须证明三个性质，缺一则不得升格为 `READY_FOR_SYNTHETIC_VALIDATION`：

1. **constructSeparability** — A/B/C/D 四象限得到互不相同的标签  
2. **deterministicAdjudication** — 同 fixture → 同 adjudication  
3. **historicalNonInterference** — adjudicator / suite 不读写 consumed live-output

## 跨层 truth table（锁死）

| semantic | linkage | overall feasibility | observability | label |
|---|---|---|---|---|
| PASS | COMPLETE | PASS | PASS | `FEASIBLE` |
| PASS | INCOMPLETE | **PASS** | FAIL | `FEASIBLE_PLUS_OBSERVABILITY_DEFECT` |
| FAIL | COMPLETE | FAIL | PASS | `INFEASIBLE` |
| FAIL | INCOMPLETE | FAIL | FAIL | `INFEASIBLE_PLUS_OBSERVABILITY_DEFECT` |

关键原则（机器强制）：Layer 3 INCOMPLETE **不得**在 Layer 1 PASS 时单独映射为 overall FAIL。

合法状态：`trajectory RECOVERED + linkage INCOMPLETE`。

## Corpus 覆盖

最低四象限 + 边界：

- A/B/C/D 主象限  
- 无工具失败的 success / failure  
- UNKNOWN evidence  
- budget-exhausted 式 semantic fail + incomplete linkage  
- **`SX-REF-LINKAGE-GAP`**：同构于 t1 裁判模式（tool failure → corrected action → complete → oracle PASS → missing strict linkage），**不含**历史 run ID / verdict

期望：`L1=PASS, L2=RECOVERED, L3=INCOMPLETE, overall=PASS, observability=FAIL`。

## 审查清单（独立 contract review）

- [ ] Truth table 与 adjudicator 实现一致  
- [ ] `SX-REF-LINKAGE-GAP` 证明的是 construct 分解，不是针对历史 run 的 gate 放宽  
- [ ] 历史隔离条款完整  
- [ ] `pnpm exec vitest run tests/feasibility-construct-repair-v1.test.ts` 全绿  
- [ ] 明确：通过后才进入 `READY_FOR_SYNTHETIC_VALIDATION`（仍零 Provider）；其后才谈 Native mechanism / 新 live contract  

## 路线锁

```text
F1-40 live                 NO_GO
R0 / T0 / E1 live          HOLD
Historical F0/F1 verdicts  IMMUTABLE
Provider calls this phase  0
```
