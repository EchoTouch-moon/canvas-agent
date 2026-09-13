# C1-F1 32-call machine contract Freeze Review（候选）

日期：2026-09-13（Asia/Shanghai）

状态：`FREEZE_REVIEW / NO_PROVIDER / NO_IDENTITY`

本记录对应 F1 Native Feasibility Frontier 的第一个新 budget point。它只冻结 `32 Provider calls/run`，不创建
40/48 point 的合同或 identity，也不授权 Provider execution。

## 合同候选

```text
Contract ID                         = C1_F1_NATIVE_FEASIBILITY_32
Contract path                       = research/context-benchmarks/c1/f1/contracts/c1-f1-native-feasibility-32.json
runContractHashRole                 = FREEZE_CANDIDATE
runContractSha256                   = 5dbbd75d040b91152d4cbe7c16ee49e79147988384a402cbce740a9a7f9ce868
executionBinding.codeRevision       = PENDING_F1_32_IMPLEMENTATION
executionBinding.executionSurfaceHash = PENDING_F1_32_IMPLEMENTATION
studyId                             = NOT_CREATED
```

合同保留 F0-v2 的两个 task、16 runs/task、32 runs、deterministic balanced alternation、one-sided 95% Clopper–Pearson
规则、UNKNOWN 分层、post-run snapshot→adjudication→cleanup 顺序、provenance/recovery safety、ground-truth firewall、
oracle 与 required artifact 集合。F1-32 唯一改变的实验变量是：

```text
budgets.perRun.maxProviderRequests = 32
budgets.study.maxProviderRequests  = 32 × 32 = 1024
```

study-level network/provider limiter 必须使用同一个派生 ceiling；tool ceiling、wall-clock ceiling、task/prompt/
fixture/Provider/model/tool/recovery/oracle 语义保持不变。

## Historical-anchor witness

合同携带已消费 F0-v2 24-call study 的绑定：

```text
anchor studyId                 = c1-f0-v2-20260913-341fbab9
anchor executionRevision      = 6d0189a998772e8d9e379f8ec56bc7f429546a2a
anchor executionSurfaceHash   = 583f6c974c207eb3e338b89aa345ab1aadd894fb25d83455b06ee59af13fbe0a
anchor runContractSha256      = 4120e8d4c5c029ce224fb1341989cdc208d96799f1c399e736ee77aa36ea0611
```

`surfaceEquivalenceWitness` 采用两阶段 schema。候选合同为 `PRE_BINDING`，只冻结 anchor、分类策略和空的
target/entries；实现绑定阶段必须转为 `FINAL_BOUND`，写入实际 target binding 与逐路径 entries。分类只允许
`EXACT_UNCHANGED` 或 `BUDGET_ONLY_PROJECTION`，后者仅可出现在 F1 budget plumbing；缺失路径、无法回溯、重复
路径或任何 `OTHER_CHANGE` 都必须 fail closed。identity namespace 由合同自身单独冻结，不再冒充 surface exact match。

## Frontier 语义

合同将 F1 point label、`FRONTIER_DRIVING_GATE`、顺序停止规则和 transition bracket 机器化：只有 t2 的
budget-sensitive composite 失败且其它 validity/precision/evidence/t1/t2 非预算 gate 通过，才允许继续到 40；
40/48 各自需要新的合同、binding、identity 与授权。

若最终出现稳定可行 point `B`，transition bracket 使用最近一个由 `FRONTIER_DRIVING_GATE` 驱动且标记为
`VALID_INFEASIBLE` 的 tested point `L`，输出 `(L,B]`。搜索链遇到 `INVALID`、`INCONCLUSIVE` 或
`FRONTIER_INCONCLUSIVE_NON_BUDGET` 时不形成 bracket，也不把首个通过点解释为精确阈值。

## 验证覆盖

`c1-f1-native-feasibility-32-contract.test.ts` 已覆盖：

- candidate self-hash、32-call point、1024 study ceiling 与 identity 未创建；
- F0-v2 historical anchor 与 surface witness；
- 合法重算 self-hash 后的 study ceiling、outcome、surface witness drift fail closed；
- candidate→final-bound 只允许填入 execution binding、phase/hash 字段和实际 surface witness evidence；witness target
  binding 必须与 execution binding 双向一致。

当前验证只使用 credential-free contract checks；没有读取 `.env`、创建 study identity 或发出 Provider/network 请求。
后续顺序仍为：独立 contract review → credential-free runner → actual surface witness → final binding → fresh identity
与 owner authorization。
