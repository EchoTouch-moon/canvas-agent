# C1 E0 Final Live Binding 独立技术复核

日期：2026-09-11（Asia/Shanghai）

复核对象：PR #115 binding-closure head `ba1bccb1557e1083d55b3be072c5581b191a988b`，base 为
`codex/c1-effectiveness-e0-execution-runner`。

裁定：`TECHNICAL_REVIEW_PASS / FINAL_RUN_CONTRACT_REBIND_VERIFIED`。

这是针对实现语义和证据边界的独立技术复核，不等同于 GitHub 正式 review。当前 PR 正式 review 数仍为 0，
owner authorization 与 E0 live 继续 `NO_GO`。

## 固定身份

```text
executionRevision        = 1e759e6e82b8ecd26028df7137b656103bd62824
executionSurfaceHash     = 2f432c8a7f5570165dbb2b82174cdb28080161798c2ab8fc61287d6eb0c81d1a
enrollmentManifestSha    = 9b3d787219c93f8ba7563e5b52366245c6279a697b7e729b5426e12bfab7a6bb
providerConfigHash       = bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a
runContractSha256        = 17bce0a284b37dff7b34efb8a593d063be7c3d12e6fac38f52f54ea7210b6cbe
runContract.codeRevision = 1e759e6e82b8ecd26028df7137b656103bd62824
```

## 复核项目

| 项目                          | 结果 | 证据                                                                                                                                  |
| ----------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Neutral treatment opportunity | PASS | 固定 `README.md`；entrypoint 不从 `expectedWritablePaths` 选择 bootstrap；scripted model 先 READ 再 EDIT/WRITE                        |
| Runtime policy leakage        | PASS | policy 只接收六键 allowlist；oracle、reference、task label 和 expected paths 不进入 policy                                            |
| Natural lifecycle             | PASS | sandbox tool result、私有 v1/v2 probe、formal `SUPERSEDED_VERSION`、transition `REMOVE` 串联                                          |
| Shared scheduler              | PASS | `runC1E0StudyInternal` 同时承载 `SCRIPTED_FAKE` 与 `AUTHORIZED_PROVIDER`                                                              |
| Authorized path               | PASS | injected fake fetch 完整运行 8 legs，`networkSent=true`、`fallbackSent=false`、provider usage available                               |
| Binding equality              | PASS | authorization 与 runtime revision/surface/manifest/provider/contract 对齐；contract codeRevision equality gate 位于 identity claim 前 |
| Dose projection               | PASS | lifecycle IDs 从实际 REMOVE/carry source keys 派生，experiment pair ID 独立保存                                                       |
| Layer 2                       | PASS | objective/regression oracle 仅在 leg 后运行，不 feeding Runtime policy                                                                |
| Provenance                    | PASS | Provider usage 写入 metadata ledger；fake usage/latency 不被当作效率数值                                                              |
| Artifact safety               | PASS | raw provider messages、tool arguments、assistant content、credential 和 authorization header 不落盘                                   |
| Surface scope                 | PASS | headless research source、Runtime/adapter workspace、相关 manifests、`package.json` 与 lockfile；Electron/docs 排除                   |

## 验证

- 新 live-binding tests：7/7 passed。
- E0 runner、Dose、authorized source、SUPERSEDED policy/probe：54/54 passed。
- headless audit：`unknown=0`、`coreFindings=0`。
- headless format、lint、typecheck、build 与 `git diff --check`：passed。
- PR #115 Node 24 Context Runtime CI run `34516618048`：success。
- 未读取真实 credential，未访问真实 Provider，未创建或消费 E0 live identity。

## 结论与下一步

实现语义与证据边界没有阻塞项；final Run Contract rebind 已完成。rebind 只修改
`research/context-benchmarks/c1/e0/contracts/c1-effectiveness-e0-run-v1.json` 的 `codeRevision` 和
`runContractSha256`；必须保持 execution surface、enrollment manifest、provider configuration、pair matrix、
threshold 和 budget 不变。

rebind 后的本地 authorized fake-fetch 使用真实 rebinding contract、未使用 pending-contract override，并确认
`finalBindingReady=true`；Node 24 CI 需要覆盖 rebind-only delta。之后还需要一次 binding-only formal review；owner
authorization 与 E0 live 在此之前仍为 `NO_GO`。
