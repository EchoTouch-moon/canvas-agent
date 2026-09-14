# C1-F1-32 credential-free runner integration

日期：2026-09-14（Asia/Shanghai）

状态：`IMPLEMENTED / CREDENTIAL_FREE_E2E_PASS / BINDING_READY / NO_PROVIDER`

本记录对应独立 runner implementation PR。它承接已冻结的 F1-32 machine contract，不修改 task、prompt、fixture、
Provider、tool semantics、recovery policy、gate 或 32-call 研究参数。

## 执行面

```text
runner                         = research/context-benchmarks/c1/f1/runner/c1-f1-32-execution-runner.ts
runner id                      = C1_F1_NATIVE_FEASIBILITY_RUNNER_32
execution mode                 = CREDENTIAL_FREE_NATIVE_ONLY
executionRevision              = f6a49a8ccfeb22b264745cd9b6b887ad46b9bfd5
executionSurfaceHash           = 0b9c57e1a50714958d52890bfc6fa92da5c30502ef48132fb5a729c4fa108994
bindingControlSurfaceHash      = bfa22c14f716eda9e8aa8d86fcd2800406ea2ab782f9ac616eb7513d890e9992
target inventory               = 282 files
  ├─ F0-v2 anchor files         = 281（全部 EXACT_UNCHANGED）
  └─ F1 budget adapter          = 1（BUDGET_ONLY_PROJECTION）
binding control inventory      = 3 files（F1 contract validator、anchor inventory、contract JSON）
freezeCandidateRunContractSha256 = 053fa42d540e3955b8228303036191ffd985292ddd9665d87397b232570885da
finalBoundRunContractSha256    = d6c9ce8822d6a13f4a8dd1069b70213e70cee6e03c0db1b09cb75e40b035b927（内存/报告绑定）
```

runner 在 clean checkout 中实际枚举 execution 与 binding-control inventory，读取文件字节计算 per-path hash，再分别
重算 aggregate digest；不会从 witness 反推文件内容。anchor path 的当前 hash 若偏离历史 inventory 会立即停止，
新增 executable path 若不在声明的 F1 runner prefix 中也会停止，control path/hash 或 control aggregate 不一致同样
会停止。

## credential-free 行为

- 只使用内存中的 provider binding 与 scripted fake response source；`providerCalls=0`、`networkRequests=0`。
- 只接受 F1-32 candidate 合同的 pending execution binding；runner 生成的 final-bound contract 与 surface witness
  仅写入执行报告，不改写冻结合同文件。
- 使用 32 Provider calls/run、1024 Provider calls/study、96 tool calls/run、3072 tool calls/study 和
  600000 ms/run 的硬预算。
- 复用 C1 leg executor、逐工具 provenance、post-run snapshot→pre-cleanup adjudication→cleanup→final disposition、
  UNKNOWN 分层和冻结 oracle 路径。
- 测试 identity 仅用于临时 credential-free E2E 输出；owner authorization identity 仍未创建，生产执行入口保持关闭。

报告会额外保存 `surface-witness.json`、`execution-binding.json` 和 `final-bound-contract.json`，同时保留合同要求的
九类 durable artifacts；原始 assistant content、tool arguments 和 provider payload 不进入持久化证据。

## 验证

`c1-f1-32-execution-runner.test.ts` 覆盖：

- 32-run balanced scheduler 与 F1 identity namespace；
- 282-file actual inventory、execution revision/surface hash 与 3-file binding-control hash；
- complete 32-leg fake study；
- 32-call per-run exhaustion；
- prospective side-effect provenance；
- zero-network boundary、final witness 与 final-bound contract 生成。

本地 Node 24 验证：

```text
F1 runner tests       = 6 passed
Context Benchmarks    = 39 files / 309 tests passed
typecheck             = passed
pnpm check:core       = passed
```

本阶段不创建 F1-32 fresh study identity、不读取 `.env`、不发送真实 Provider 请求。下一步是独立 binding review；只有
binding review 通过并获得 owner authorization 后，才允许生成 fresh identity 和进行 live F1-32。
