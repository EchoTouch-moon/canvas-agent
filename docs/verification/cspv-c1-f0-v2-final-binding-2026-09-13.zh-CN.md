# F0-v2 Final-bound Contract 验证记录

日期：2026-09-13（Asia/Shanghai）

状态：FINAL_BOUND_REBOUND / BINDING_REVIEW_PASS / PR_#129_MERGED / NO_PROVIDER

本记录对应 research/context-benchmarks/c1/f0/contracts/c1-f0-execution-feasibility-v2-final-bound.json。
它只形成不可变 binding candidate，不创建 study identity，不读取 credential，不执行 Provider。

## 两阶段绑定

```text
freezeCandidateRunContractSha256 = 31663b2833ea8ecf46fdc1165dd69b87e12c4ce1999fd595307368448d0606a7
executionRevision                = 926be0a5e6eeecd08303a644a3858d61bb8212ba
executionSurfaceHash             = 9b600f7d20f6d543939881c9c92fd9badac55025d2982692bbc18dc2727b3974
finalBoundRunContractSha256      = 85b031207d8c3d7c3decafd9708db6a0d35238faba5949c2b657ce96ca9b4884
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

上一个 `609629…` final-bound hash 随 runner evidence correction 失效；本记录仅保留新的 `85b031…` binding。
Node 24 合同与 runner 回归、full benchmark 和 headless core gate 均通过；本记录不代表 owner authorization，
也不授权 live Provider。

## 下一步

1. 保持 final-bound contract 与 runner surface 不变，准备 owner authorization record；
2. 先完成 authorized-provider response source、真实 usage/evidence path 的实现与独立 review；
3. 仅在 fresh never-claimed studyId、精确 hashes、预算和 safety policy 全部绑定后，等待 owner authorization；
4. 授权前不得运行 F0-v2 live。
