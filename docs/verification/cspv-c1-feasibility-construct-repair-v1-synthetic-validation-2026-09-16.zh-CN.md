# C1 Feasibility Construct Repair v1 — Zero-Provider Synthetic Validation Result

日期：2026-09-16（Asia/Shanghai）

| Field | Value |
|---|---|
| Contract ID | `C1_FEASIBILITY_CONSTRUCT_REPAIR_V1` |
| Contract status at run | `READY_FOR_SYNTHETIC_VALIDATION` |
| Exact head | `96fe079fdf1dbe3ebdf5902751138702c8b96fcf` |
| Execution mode | `ZERO_PROVIDER` |
| Provider calls | `0` |
| Live execution | `FORBIDDEN` |
| Fresh study identity | `NOT_NEEDED` |
| Command | `pnpm exec vitest run tests/feasibility-construct-repair-v1.test.ts` |
| Suite result | **11 passed / 0 failed** |

## Final adjudication (machine evidence)

```text
SYNTHETIC_VALIDATION           = PASS
constructSeparability          = PASS
deterministicAdjudication      = PASS
historicalNonInterference      = PASS
ProviderCalls                  = 0
```

## Artifact hashes (SHA-256 at exact head)

| Artifact | SHA-256 |
|---|---|
| Machine contract `construct-repair/c1-feasibility-construct-repair-v1.freeze-candidate.json` | `62571958c30eb0a1f8ede165daaa0d5cde982bc1d45d11631729b5b3b3d6afa8` |
| Synthetic corpus `construct-repair/synthetic/corpus.v1.json` | `39f745cd3aa22b46114ee76047c0d711a1077af53885ea1332ce4aeb3f71f43b` |
| Adjudicator `construct-repair/adjudicate.ts` | `3663fb46a0c8b55b3203abeeec720f344ff4cf037980690d0c3e13b1677addeb` |
| Suite `tests/feasibility-construct-repair-v1.test.ts` | `78dc3e996348ddb7526982f01bd2802c316f2d5bf42717347cd1e05411cece62` |

## Property 1 — constructSeparability = PASS

| Quadrant | Observed label |
|---|---|
| A | `FEASIBLE` |
| B | `FEASIBLE_PLUS_OBSERVABILITY_DEFECT` |
| C | `INFEASIBLE` |
| D | `INFEASIBLE_PLUS_OBSERVABILITY_DEFECT` |

四象限互异：是。

`SX-REF-LINKAGE-GAP`：

```text
L1 semanticFeasibility            = PASS
L2 trajectoryRecoveryOutcome      = RECOVERED
L3 linkageCompleteness            = INCOMPLETE
overallExecutionFeasibility       = PASS
observabilityQuality              = FAIL
label                             = FEASIBLE_PLUS_OBSERVABILITY_DEFECT
```

Truth-table binding（contract → fixtureFromTruthTableRow → adjudicator）由 suite 覆盖并通过。

## Property 2 — deterministicAdjudication = PASS

- 同 fixture 两次 `adjudicateConstructRepairV1` → JSON 完全相等
- Suite：`is byte-stable for identical fixtures` PASS
- Suite：`deterministically adjudicates every corpus case` PASS

## Property 3 — historicalNonInterference = PASS

| Check | Result |
|---|---|
| Provider calls | `0`（合同声明 + 本轮零 Provider 命令，无 API key 环境） |
| Corpus 含历史 run ID / `.live-output` / consumed study markers | 无 |
| Loader / `assertHistoricalNonInterference` 对 historical 路径 | fail-closed |
| Adjudicator 位于 `construct-repair/`（非 E0 `src/` surface） | 是 |
| E0 `executionSurfaceHash` vs pre-construct baseline `22f23b595ed637ccfb16ab7f30f17c5181515a80c9b89c7b40b63e7ad7834b93` | **match** |
| Historical F0/F1 verdict mutation | 0（本轮未触碰） |
| E0 rebind | 未执行 |

Negative cases（fail-closed）：

- `.live-output/.../c1-f1-32-20260915-11df369c/...` → `historical_non_interference_violated`
- `/tmp/c1-f1-32-20260915-11df369c/...` → `historical_non_interference_violated`

## Suite inventory (11/11)

1. loads zero-provider corpus without historical run IDs  
2. binds adjudicator outputs to contract crossLayerTruthTable rows  
3. deterministically adjudicates every corpus case to its expected label  
4. separates the four primary quadrants into distinct labels  
5. keeps isomorphic referee pattern feasible with observability defect  
6. derives reachedTerminalComplete from terminationStatus…  
7. never maps Layer-3 incomplete alone to overall infeasible…  
8. treats pure task/oracle miss without tool failure as infeasible…  
9. is byte-stable for identical fixtures  
10. fail-closes corpus loader against historical live-output paths  
11. freeze-candidate contract declares zero-provider and historical mutation forbidden  

## Non-claims (explicit)

本轮 PASS **不**证明：

- Runtime effectiveness  
- 真实任务 feasibility  
- budget frontier 可重开  

## Route locks retained after validation

```text
F1-40              NO_GO
R0 / T0 / E1 live  HOLD
Provider live      NOT AUTHORIZED
Historical F0/F1   IMMUTABLE
```

## Closeout handoff

证据已锁定在 exact head `96fe079` + 上表 artifact hashes。

## Independent closeout（2026-09-16）

```text
SYNTHETIC_VALIDATION = PASS
synthetic phase       = CLOSED
closeout comment      = #143 / 5690678021
evidence commit       = f430131（纯文档；不改变 executable basis）
```

科学结论：repaired feasibility construct 在冻结 synthetic corpus 上已证明具备 construct separability、deterministic adjudication 与 historical non-interference。

非结论保留：Runtime effectiveness / real-task feasibility / budget frontier reopening **均未建立**。

下一步仅可讨论 design-only 分叉（Native mechanism study design，或 Prospective construct / R0 design-only）；**仍不得直接进入 live**。
