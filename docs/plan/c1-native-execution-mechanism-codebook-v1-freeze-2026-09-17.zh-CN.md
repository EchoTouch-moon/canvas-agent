# C1 Native Execution Mechanism Codebook v1 — Freeze Candidate

日期：2026-09-17（Asia/Shanghai）

| Field | Value |
|---|---|
| Contract ID | `C1_NATIVE_EXECUTION_MECHANISM_CODEBOOK_V1` |
| Status | `FREEZE_CANDIDATE` / `READY_FOR_REVIEW` |
| Execution | `NO_PROVIDER` / `live=FORBIDDEN` |
| Historical coding | `NOT_STARTED` |
| R0 design eligible | `NOT_YET` |
| Machine codebook | `research/context-benchmarks/mechanism-study/codebook.v1.json` |
| Adjudicator | `research/context-benchmarks/mechanism-study/adjudicate.ts` |
| Calibration | `research/context-benchmarks/mechanism-study/synthetic/calibration.v1.json` |
| Tests | `research/context-benchmarks/tests/native-execution-mechanism-codebook-v1.test.ts` |
| Machine index | `docs/plan/c1-native-execution-mechanism-codebook-v1-freeze-2026-09-17.json` |
| Predecessor | `C1_NATIVE_EXECUTION_MECHANISM_STUDY_V1`（A design PASS / merged via #143） |

## 0. Scope of this freeze

本轮**只冻结 coding construct**，不开始 formal historical attribution。

```text
A design                      PASS
Codebook freeze candidate     READY_FOR_REVIEW
Historical coding             NOT STARTED
R0_DESIGN_ELIGIBLE            NOT YET
Provider / live               FORBIDDEN
```

## 1. Hard separations（机器强制声明）

```text
mechanism attribution
  ≠ causal attribution
  ≠ Runtime actionability
```

推论：

- 编码为 `EDIT_THRASH`（或任意 seed）**不**推出 Context Runtime 可干预。
- Actionability 必须**另行**通过 `RUNTIME_ACTIONABLE_V1` 四要件合取。
- Layer-3 linkage incompleteness **不是** Layer-1 failure mechanism。

## 2. Codebook contents（见 JSON）

每个 mechanism 锁定：

```text
definition / inclusion / exclusion / counterexample / requiredEvidence
```

种子：`EDIT_THRASH`, `INCORRECT_FILE_TARGETING`, `INSUFFICIENT_CONVERGENCE`, `PREMATURE_COMPLETION`, `OBJECTIVE_MISS`

开放码：

| Code | 严格触发 |
|---|---|
| `OTHER` | 无 seed inclusion 成立 + 非空 rationale + `rejectedSeedCodes[]` |
| `UNKNOWN` | 证据不足 / 校验失败 fail-closed / referee 指向 UNKNOWN |
| `MULTI_MECHANISM` | ≥2 seed 竞争且不能唯一定主码；需 `competingSeedCodes[]` |

`studyGrade=false` 直至 freeze review PASS。

## 3. Units & promotion

- **Event-level**：局部证据；`supportsRunPrimary` 才参与投票。
- **Run-level**：唯一 primary（或 UNKNOWN/MULTI/OTHER）。
- 分裂 seed 投票 → `MULTI_MECHANISM`（不因 R0 兴趣拆平；**priority 表仅展示顺序，不产生 unique winner**）。
- Event **永不**自动设置 `runtimeActionable`。
- **Dual coding**：`adjudicateMechanismCoding(coding, dual?)` 在提供 dual 时走 `refereeDualCoding`，referee 主码覆盖 event-promoted primary。

## 4. Confounder axes（正交）

```text
MODEL_LIMITATION
TASK_AMBIGUITY
TOOL_FAILURE
BUDGET_EXPOSURE
CONTEXT_STATE_FAILURE
```

Axes ≠ mechanism codes；可与任意 mechanism 共存。禁止把 Layer-3 linkage 映射成 `TOOL_FAILURE` 或 mechanism。

## 5. Referee（主路径可选输入）

```text
adjudicateMechanismCoding(coding, dual?)
  → event promotion
  → if dual: refereeDualCoding overrides primary
  → open-code / actionability checks
```

```text
either UNKNOWN → UNKNOWN
same OTHER without dual rationale → UNKNOWN
differing seeds → MULTI_MECHANISM
never tie-break by R0 interest
```

## 6. RUNTIME_ACTIONABLE_V1

四要件缺一不可：

1. observable runtime state（`observableStateId`）
2. Runtime can intervene（`interventionId`）
3. before irreversibility（`decisionPointId` + `irreversibilityNotYetReached=true`）
4. attribution evidence class ∈ `{RUNTIME_VISIBLE, RUNTIME_DERIVABLE}`

`SEALED_OFFLINE_ONLY` / `POST_HOC_NARRATIVE` → 可支持离线 mechanism 讨论，**不可**支持 actionability。

## 7. Fail-closed

- 非法 coding record → `accepted=false`, primary 强制 `UNKNOWN`, `runtimeActionable=false`
- `claimedRuntimeActionable=true` 但四要件失败 → violation
- mechanism code 本身永不蕴含 actionability

## 8. Calibration / synthetic

`calibration.v1.json` 覆盖：thrash 无 actionable、soft-leap 拒绝、四要件 PASS、sealed-offline 阻断、split→MULTI、OTHER 校验、dual referee、Layer-1 PASS 拒绝、premature completion。

**不含**历史 run ID。

## 9. Promotion gate after freeze PASS

```text
CODEBOOK_FROZEN_FOR_CALIBRATION_ONLY
  ≠ historical attribution campaign
  ≠ R0_DESIGN_ELIGIBLE
  ≠ Provider / F1-40 / R0 live
```

下一可选步：synthetic calibration 巩固 → 再考虑 **read-only** historical pilot（仍非 R0）。

## 10. Review checklist

- [x] 每码 definition/inclusion/exclusion/counterexample/requiredEvidence 可执行（人工 inclusion；机器查结构）  
- [x] OTHER/UNKNOWN/MULTI 触发严格  
- [x] event→run：≥2 distinct supporting seeds ⇒ MULTI；priority 仅 DISPLAY_ORDER  
- [x] dual referee 接入 `adjudicateMechanismCoding(coding, dual?)`  
- [x] 四要件与 evidence class 分离正确  
- [x] `pnpm exec vitest run tests/native-execution-mechanism-codebook-v1.test.ts` 全绿（review-fix：10/10）  
- [x] 仍在 `mechanism-study/`（不侵入 E0 `src/` surface）

## 11. Explicit residual（non-blocker for freeze）

```text
machine checks = structural + actionability + open-code triggers + dual referee
human/coder checks = seed inclusion/exclusion against trajectory evidence
```
