# F0-v2 Final-bound Contract 验证记录

日期：2026-09-13（Asia/Shanghai）

状态：FINAL_BOUND_CANDIDATE / BINDING_REVIEW_REQUIRED / NO_PROVIDER

本记录对应 research/context-benchmarks/c1/f0/contracts/c1-f0-execution-feasibility-v2-final-bound.json。
它只形成不可变 binding candidate，不创建 study identity，不读取 credential，不执行 Provider。

## 两阶段绑定

```text
freezeCandidateRunContractSha256 = 31663b2833ea8ecf46fdc1165dd69b87e12c4ce1999fd595307368448d0606a7
executionRevision                = 164a3e101238116024e1e4eb98d97ff74faeffdb
executionSurfaceHash             = 7f540b59755231f0e3319a641f6e3139493fab04f3a3a2ffbeb015a0531e14ed
finalBoundRunContractSha256      = 609629226bc0657db7e1f4318e41a901b288af1260e01a78cd46b9b0019b3d0c
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
2. candidate/final contract 数据不进入 runner execution surface。

Node 24 合同与 runner 回归、full benchmark 和 headless core gate 均通过；本记录不代表 owner authorization，
也不授权 live Provider。

## 下一步

1. 完成 final-bound binding 的独立 review；
2. 保持 final-bound contract 与 runner surface 不变，生成 owner authorization record；
3. 仅在 fresh never-claimed studyId、精确 hashes、预算和 safety policy 全部绑定后，等待 owner authorization；
4. 授权前不得运行 F0-v2 live。
