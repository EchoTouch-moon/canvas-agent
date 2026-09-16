# C1 Feasibility Construct Repair v1 — Synthetic Validation Gate

日期：2026-09-15 起草；2026-09-16 升格（Asia/Shanghai）

| Field | Value |
|---|---|
| Contract ID | `C1_FEASIBILITY_CONSTRUCT_REPAIR_V1` |
| Status | `SYNTHETIC_VALIDATION_PASS` / `syntheticPhase=CLOSED` |
| Execution | `ZERO_PROVIDER` / `liveExecution=FORBIDDEN` / `historicalOutcomeMutation=FORBIDDEN` |
| Machine contract | `research/context-benchmarks/construct-repair/c1-feasibility-construct-repair-v1.freeze-candidate.json` |
| Synthetic corpus | `research/context-benchmarks/construct-repair/synthetic/corpus.v1.json` |
| Adjudicator | `research/context-benchmarks/construct-repair/adjudicate.ts` |
| Tests | `research/context-benchmarks/tests/feasibility-construct-repair-v1.test.ts` |
| Design predecessor | `docs/plan/c1-feasibility-construct-repair-v1-design-2026-09-15.zh-CN.md` |
| Validation head | `96fe079fdf1dbe3ebdf5902751138702c8b96fcf` |
| Evidence commit | `f43013136d1f00f753dbaa2b265b689c44600cd7` |
| Closeout comment | `#143` comment `5690678021` |

## 目的

把 Layer 1/2/3 从设计叙述推进为**可机器裁决**的规格，并附零 Provider synthetic suite。

本阶段**不**创建 fresh study identity，**不**发起 Provider calls，**不**回写 F0/F1 历史 verdict。

## 正式升格与收口（2026-09-16）

```text
READY_FOR_SYNTHETIC_VALIDATION_FREEZE
  → READY_FOR_SYNTHETIC_VALIDATION   (promotion head cbc7538 / CI #525)
  → SYNTHETIC_VALIDATION_PASS         (validated head 96fe079)
synthetic phase = CLOSED
```

独立复审 + exact-head CI / validation 依据：

- Construct contract review PASS；prior blockers CLOSED
- Historical execution-surface static isolation PASS
- Construct-repair suite 11/11 PASS on `96fe079`
- Closeout comment `#143` / `5690678021`

科学结论：repaired construct 在冻结 synthetic corpus 上具备 separability、determinism、historical non-interference。

非结论：Runtime effectiveness / real-task feasibility / budget frontier **未建立**。

下一设计分叉（仍 design-only，非 live）：

```text
A. Native execution mechanism study design
B. Prospective construct validation / R0 design-only
```

## 可证伪主张

> Linkage quality 与 execution feasibility 是两个相关但**不等价**的 construct。

Synthetic validation 必须证明三个性质：

1. **constructSeparability** — A/B/C/D 四象限得到互不相同的标签  
2. **deterministicAdjudication** — 同 fixture → 同 adjudication  
3. **historicalNonInterference** — 不读写 consumed live-output，且不静态侵入旧 E0 `research/context-benchmarks/src` execution surface

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

- [x] Truth table 与 adjudicator 实现一致（contract JSON → `fixtureFromTruthTableRow` → adjudicator exact equality）  
- [x] `SX-REF-LINKAGE-GAP` 证明的是 construct 分解，不是针对历史 run 的 gate 放宽  
- [x] 历史隔离条款完整（runtime I/O allowlist + **静态**不侵入 E0 `research/context-benchmarks/src` execution surface）  
- [x] Layer-2 composition：`reachedTerminalComplete` 仅从 `terminationStatus` 推导；`L1=PASS + L2=UNRECOVERED` fail-closed  
- [x] `pnpm exec vitest run tests/feasibility-construct-repair-v1.test.ts` 全绿（11/11）  
- [x] `format:check:core` / lint / typecheck / Context Runtime CI #525 全绿  
- [x] 升格为 `READY_FOR_SYNTHETIC_VALIDATION`（仍零 Provider）  
- [x] zero-Provider synthetic validation PASS；`synthetic phase = CLOSED`  

## Review REQUEST_CHANGES 修复（2026-09-15 → 2026-09-16）

| Blocker | Resolution |
|---|---|
| L2 不参与 overall / 可构造矛盾输入 | `reachedTerminalComplete` 禁止独立字段；从 `terminationStatus` 推导；composition 对 `PASS+UNRECOVERED` fail-closed |
| historical non-interference 仅声明 | loader 固定/allowlist `construct-repair/`；拒绝 `.live-output`、`.audit`、consumed study markers；负向测试 |
| contract ↔ adjudicator 漂移 | 测试从 `crossLayerTruthTable` 派生 fixture 并 exact-equality 绑定 TT-A–F/U + RECOVERED+INCOMPLETE 合法态 |
| CI `format:check:core` / TS5097 | Prettier + 去掉测试 import `.ts` 后缀 |
| 新代码侵入 E0 execution surface | adjudicator 从 `src/` 迁出到 `construct-repair/`；**不** rebind E0 |

当前状态：

```text
SYNTHETIC_VALIDATION_PASS        ACTIVE ✅
synthetic phase                  CLOSED
executionMode                    ZERO_PROVIDER
next                              design-only fork discussion (A/B); no live
```

## 路线锁

```text
F1-40 live                 NO_GO
R0 / T0 / E1 live          HOLD
Historical F0/F1 verdicts  IMMUTABLE
Provider live              NOT AUTHORIZED
Provider calls this phase  0
```
