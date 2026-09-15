# C1-F1-32 FINAL_BOUND binding（Stable main）

日期：2026-09-15（Asia/Shanghai）

状态：`FINAL_BOUND / READY_FOR_INDEPENDENT_BINDING_REVIEW / NO_IDENTITY / NO_PROVIDER`

本轮从 clean worktree `main @ 51a409cb61ebb917b6584aaac1e746d123e7f6a0` 重新计算 F1-32 binding。工作范围只有 final
binding artifact、校验回归与 verification record；没有修改执行面、control 面或冻结研究语义。

## Final binding tuple

```text
checkoutRevision              = 51a409cb61ebb917b6584aaac1e746d123e7f6a0
executionSurfaceRevision      = 69b85eecf6f785d9623e9857f7f3499ba34c2cce
executionSurfaceHash          = 27ee4691dac098d393f086151e8bde1acada7b61a33c70592fbe8683def3021b
bindingControlSurfaceHash     = 8ac49f85392dd09a4637ff9d78649a86c28c0ee9d00baaa8341e64e17b198e00
executionInventoryFiles       = 282
  ├─ F0-v2 anchor / EXACT_UNCHANGED = 281
  └─ F1 budget projection         = 1
bindingControlInventoryFiles  = 4
  ├─ F1 contract validator
  ├─ frozen F0 anchor inventory module
  ├─ F1-32 candidate contract JSON
  └─ inherited c1-carried-removals dependency
supplemental dependency SHA256 = de2538329df22823da68237ed7690042d0abb080173c924431c1e6df1dfd93bf
freezeCandidateRunContractSha256 = 053fa42d540e3955b8228303036191ffd985292ddd9665d87397b232570885da
finalBoundRunContractSha256   = c4725887cac211a7d17a930e1349f93d9e9c6510a3db1257bd30402a129938a8
```

`executionRevision` 的权威语义是完整 clean checkout 的 `git rev-parse HEAD`。`executionSurfaceRevision` 只表示执行
路径最近变更点，不作为 checkout identity。最终合同里的 `executionBinding.codeRevision` 等于上面的稳定 `main`
HEAD，而不是生成此报告的后续 artifact-only PR commit。

## Witness / contract 验证

- anchor inventory 的 281 个 per-path 文件 hash 重算后仍等于历史 F0-v2 `executionSurfaceHash=583f6c...`；F0-v2
  合同、identity 与 artifacts 均未重绑或重跑。
- target execution inventory 从 checkout 实际读取文件字节生成；281 条 anchor entry 均为 `EXACT_UNCHANGED`，唯一
  F1 runner path 为 `BUDGET_ONLY_PROJECTION`，aggregate 等于 `executionSurfaceHash`。
- control inventory 包含四个 control 文件；`c1-carried-removals.ts` 当前 SHA-256 必须等于冻结历史值，否则 fail closed。
- final-bound contract validator 成功；candidate reconstruction 回投后仍匹配 freeze candidate hash
  `053fa42d...`。
- `c1-f1-32-final-bound-binding.test.ts` 会在验证时重算当前 execution/control inventory 并与 final-bound artifact
  逐 path、逐 hash、aggregate join。

## Credential-free 验证与授权边界

在不读取 `.env`、不访问真实 Provider 的条件下：

```text
Provider calls = 0
Network requests = 0
study identity created = false
```

稳定 `main @ 51a409cb...` 的 post-merge Context Runtime CI run `34921826474` 已 completed / success。final-bound
artifact 和本报告只准备独立 binding review；fresh identity 尚未创建，owner authorization 尚未执行，live F1-32 仍为
`NO_GO`。
