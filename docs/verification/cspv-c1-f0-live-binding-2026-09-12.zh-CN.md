# F0 Authorized Live Binding 验证记录

日期：2026-09-12（Asia/Shanghai）

状态：`IMPLEMENTED / FAKE_FETCH_PASS / READY_FOR_OWNER_REAUTHORIZATION`

本记录承接已合并的 F0 Native-only runner 与冻结合同，补齐真实 Provider response source、usage provenance
和 live execution authorization seam。它没有执行真实 Provider；当前绑定需要在独立 review 后重新授权。

## 新绑定

```text
contractId              = C1_F0_EXECUTION_FEASIBILITY_V1
runContractSha256       = a564ae3f3102678142d7a67c3e0a33f238c22d3221784d7926cc2b44d8349122
codeRevision            = c38785ada3573c2cc7a3927fd53c6670142eb537
executionSurfaceHash    = 587e4ec6cd7532ff405cb18214215f15d8cd7b0e90a8a58a6220336e82f5eeff
providerConfigHash      = bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a
```

这次 execution surface 包含 F0 runner、authorized response adapter、fixture/tool loop、checkpoint/evidence
层和所依赖的 headless workspace；Electron 仍未进入 surface。

## 实现边界

- 只有在 worktree clean、Node 24、合同 hash、execution revision、surface hash 和 provider config 全部匹配后，
  才允许 claim study identity。
- identity claim 完成后才读取 `STEP_PLAN_API_KEY`；key 只存在内存，不写入日志、报告或子进程环境。
- 每个 run 使用真实 `AUTHORIZED_PROVIDER` response source，固定 Native-only、单 study、32 个唯一 run，禁止
  fallback、retry、resume 和 reuse。
- Provider usage、response receipt、network request 和 tool execution 分开记录；原始 assistant content、tool
  arguments、provider payload 和 authorization header 不进入 durable artifacts。
- 每个 fixture execution sandbox 在 post-run oracle 前清理；oracle 运行在临时 adjudication 副本中。
- 普通 task/provider/tool failure 保留在分母；共享合同、身份、证据或基础设施错误 fail closed。

## Credential-free 验证

Node 24 下 `c1-f0-live-binding.test.ts` 的 2 项回归通过：

1. 旧 binding 在 identity claim 和 credential read 之前被拒绝；
2. injected fake fetch 完成 32 个 Native legs，确认 `providerCalls=32`、`networkRequests=32`、真实
   `PROVIDER_REPORTED` usage provenance 和 metadata-only ledger；该结果不是 F0 feasibility 结果。

`@canvas-agent/context-benchmarks` 全量回归、typecheck 和格式检查也必须在 PR CI 中通过后，才进入真实授权。

## 当前裁定

```text
Live binding implementation = PASS
Fake-fetch end-to-end        = PASS
Real Provider execution      = NO_GO（等待新绑定 owner reauthorization）
Fresh study identity         = NOT_CREATED
```
