# F0-v2 Final-bound Contract 验证记录

日期：2026-09-13（Asia/Shanghai）

状态：FINAL_BOUND_LIVE_REBOUND / BINDING_REVIEW_REQUIRED / NO_PROVIDER

本记录对应 research/context-benchmarks/c1/f0/contracts/c1-f0-execution-feasibility-v2-final-bound.json。
它只形成不可变 binding candidate，不创建 study identity，不读取 credential，不执行 Provider。

## 两阶段绑定

```text
freezeCandidateRunContractSha256 = 31663b2833ea8ecf46fdc1165dd69b87e12c4ce1999fd595307368448d0606a7
executionRevision                = c072af5c4fb3245a74e457a616d0c2b78ddd3f3d
executionSurfaceHash             = bde57600d2f57ab48210298bcaa0b58283fe003301f617aa506eacddb46f0ae2
finalBoundRunContractSha256      = b340c987903318b0fed72de26007cc4a29d88cae0ac51a399eaa33cd4c6ebdab
runContractHashRole               = FINAL_BOUND
status / designStatus             = FROZEN / FINAL_BOUND
studyId                           = NOT_CREATED
```

Final-bound validator 会把 final contract 反向投影为 candidate phase，恢复 pending execution binding，并要求重算后
得到 candidate hash 31663b...。因此最终允许改变的字段仅为 phase/status、executionRevision、
executionSurfaceHash 和 final-bound hash metadata。

contract JSON 位于研究合同数据目录，该目录不属于 v2 executable surface；executionSurfaceHash 只绑定 runner、
hardening、contract validator、shared headless dependencies 和 v2 runner script，避免 contract replacement
造成自引用。

## 校验结果

c1-f0-v2-final-binding.test.ts 覆盖：

1. final-bound contract 使用 phase-aware validator 通过冻结 candidate semantics；
2. 现场重算 `computeC1F0V2ExecutionBinding(REPO_ROOT)` 并与 final contract 的 revision/surface hash 逐项相等；
3. candidate/final contract 数据不进入 runner execution surface。

此前的 `609629…` 与 `85b031…` final-bound hash 均随 executable-surface 变更失效；本记录仅保留新的
`b340c9…` live-rebound binding。新增的 authorized-provider runner 仍需独立 review；本记录不代表 owner authorization，
也不授权 live Provider。

## 下一步

1. 对本次 live-rebound final-bound binding 完成独立 review；
2. 保持 final-bound contract 与 runner surface 不变，生成 owner authorization record；
3. 仅在 fresh never-claimed studyId、精确 hashes、预算和 safety policy 全部绑定后，等待 owner authorization；
4. 授权前不得运行 F0-v2 live。
