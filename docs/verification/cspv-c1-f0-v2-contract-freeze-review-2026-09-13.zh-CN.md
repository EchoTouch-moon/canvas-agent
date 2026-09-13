# F0-v2 Contract Freeze Review 准备记录

日期：2026-09-13（Asia/Shanghai）

状态：PREPARED_FOR_CONTRACT_FREEZE_REVIEW / NOT_EXECUTABLE / NO_PROVIDER

本记录对应机器可读合同
research/context-benchmarks/c1/f0/contracts/c1-f0-execution-feasibility-v2.json，以及只读合同加载与校验模块
research/context-benchmarks/c1/f0/contract/c1-f0-v2-contract.ts。它不创建 study identity，不绑定最终 execution
revision，不读取 credential，也不授权 Provider。

## 冻结候选绑定

```text
contractId                = C1_F0_EXECUTION_FEASIBILITY_V2
freezeCandidateRunContractSha256 = 31663b2833ea8ecf46fdc1165dd69b87e12c4ce1999fd595307368448d0606a7
finalBoundRunContractSha256      = PENDING_F0_V2_IMPLEMENTATION
taskPanel                 = c1-t1-localized-distractor-v1 + c1-t2-multi-file-migration-v1
runsPerTask               = 16
totalRuns                 = 32
alternationSeed           = c1-f0-v2-task-order-20260913
perRunBudget              = 24 provider / 96 tool / 600000 ms
studyBudget               = 768 provider / 3072 tool / 19200000 ms
maxUnknownRunRate         = 0.125
minAdjudicableRunsPerTask = 14
feasibilityLines          = success >= 0.80 / budget <= 0.20 / unrecovered <= 0.20 / oracle >= 0.80
```

`31663b...` 是 `runContractHashRole=FREEZE_CANDIDATE` 的完整合同 hash。后续填入
`executionBinding.codeRevision` 与 `executionSurfaceHash` 后，完整合同内容会改变，必须重新生成
`finalBoundRunContractSha256`；候选 hash 不会作为 Owner Authorization 的最终合同 hash。

validator 已分为 candidate 与 final-bound 两个 phase-aware 入口，共享同一组 code-side freeze invariants。candidate
要求两个 execution binding 字段仍为 pending；final-bound 只允许把 role/status/designStatus 切换到 FINAL_BOUND、填入
40 位 execution revision 和 64 位 surface hash，并携带原始 candidate hash。任何 task、evidence、outcome、firewall、
artifact、预算、门槛、Provider 或 recovery 语义变化都会在重新计算 self-hash 后以
SEMANTIC_FREEZE_MISMATCH 拒绝。

maxUnknownRunRate=0.125 允许每个 16-run stratum 至多 2 个 unknown；minAdjudicableRunsPerTask=14 要求至少
14 个 run 进入 success/failure 的可判定分母，避免 missing evidence 掩盖 feasibility。unknown 不计作 failure，而由
PRECISION_GATE 单独裁定。

## 执行与身份边界

```text
providerConfigHash       = bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a
executionBinding.codeRevision       = PENDING_F0_V2_IMPLEMENTATION
executionBinding.executionSurfaceHash = PENDING_F0_V2_IMPLEMENTATION
toolHardening            = C1_F0_TOOL_HARDENING_V1
maxIdenticalFailureAttempts = 2
recovery definition      = operational recovery only
studyId                  = NOT_CREATED
retry / resume / reuse   = FORBIDDEN
```

F0-v2 保持 F0-v1 的 task、prompt、fixture、oracle、Provider/model、24-call budget 和 task-level gate；启用
prospective provenance 与 canonical recovery 只产生新的 execution surface。v1 与 v2 只能做描述性比较，不 pooled，
不声称 recovery hardening 的因果效果。

RECOVERED 的机器定义是：当前工具执行成功，并通过 recoveryOfToolCallId 关联到此前失败的工具执行；它不代表
语义子任务已经修复。corrected request 必须由模型显式发出并使用不同 canonical signature。

## Ground-truth 与 evidence 顺序

```text
execution terminates
  → freeze immutable post-run fixture snapshot + content/tree hash
  → oracle / writable-scope adjudication
  → persist adjudication evidence + snapshot reference
  → cleanup live sandbox
```

oracle、expectedWritablePaths 和历史结果永远不得进入 model-visible execution path。缺失 provenance row、schema
conflict 或 raw sensitive-content leakage 是 study invalidator；snapshot unavailable、partial evidence 或未知副作用
归因为 FEASIBILITY_UNKNOWN，并进入 unknown-rate / precision gate。

必需 artifact 在未来 runner 中至少包括：

```text
study-manifest.json
run-manifest.json
checkpoints.jsonl
checkpoint-summary.json
response-ledger.jsonl
tool-provenance.jsonl
post-run-snapshot-manifest.jsonl
task-adjudication.jsonl
feasibility-summary.json
```

## 零 Provider 校验

c1-f0-v2-contract.test.ts 的 7 项回归通过：

1. 正确读取自哈希合同，并确认 execution revision/surface hash 仍是 pending、study identity 尚未创建；
2. 顶层 key 顺序变化不改变 canonical contract hash；
3. 修改 freeze 字段但不更新 hash 时 fail closed，拒绝不匹配的 runContractSha256；
4. 修改 t1 expectedWritablePaths 并重算合法 self-hash 后，以 SEMANTIC_FREEZE_MISMATCH 拒绝；
5. 修改 t1 promptSha256 并重算合法 self-hash 后，以 SEMANTIC_FREEZE_MISMATCH 拒绝；
6. table-driven 修改 outcomes、requiredArtifacts 或 executionForbiddenInputs 并重算合法 self-hash 后，均以 SEMANTIC_FREEZE_MISMATCH 拒绝；
7. 只填充 execution revision/surface hash 并切换 phase 后，final-bound contract 可以通过共享 invariants 校验。

## 下一步

1. 独立 review 本 freeze candidate；
2. 实现独立 F0-v2 Native runner，接入 hardening，但保持 F0-v1 runner 默认行为不变；
3. 完成 credential-free E2E、post-run snapshot 顺序、UNKNOWN 分层与 recovery safety 回归；
4. 在 clean Node 24 head 上重新绑定 executionRevision、executionSurfaceHash 和 runContractSha256；
5. 独立 binding review 后创建 fresh studyId，再等待 owner authorization。

在上述步骤完成前，F0-v2 live Provider、T0 和 E1 均为 NO_GO/HOLD。
