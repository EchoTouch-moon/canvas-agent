# C1-F1-32 授权 Provider runner 与重新绑定

日期：2026-09-15（Asia/Shanghai）

状态：`IMPLEMENTED / FAKE_PROVIDER_E2E_PASS / FINAL_BOUND / READY_FOR_INDEPENDENT_BINDING_REVIEW / NO_IDENTITY / NO_PROVIDER`

本记录承接 PR #140 的 binding closure。#140 已合并到 `main`，merge commit `aac6a58c1149cb41d51d38d6511629b604514dd4` 的 Context Runtime CI `34923842658` 为 success。随后 F1-32 runner 增加了单独的授权 Provider 入口；因此此前绑定到 `main @ 51a409cb...` 的 final-bound tuple 只作为历史快照保留，本次按新执行提交重新计算绑定。未修改 F1 freeze candidate 的研究语义。

## 当前 final-bound tuple

```text
executionRevision              = 0e55a36f3a2c47bef9d90611df1c75a389a9263d
executionSurfaceRevision       = 0e55a36f3a2c47bef9d90611df1c75a389a9263d
executionSurfaceHash           = f5b5f10c463014d951b0983f2c01c9668cd94aa54ff63024ca247e739e28ec51
bindingControlSurfaceHash      = 8ac49f85392dd09a4637ff9d78649a86c28c0ee9d00baaa8341e64e17b198e00
executionInventoryFiles        = 282
  ├─ F0-v2 anchor / EXACT_UNCHANGED = 281
  └─ F1-32 runner projection       = 1
bindingControlInventoryFiles   = 4
freezeCandidateRunContractSha256 = 053fa42d540e3955b8228303036191ffd985292ddd9665d87397b232570885da
finalBoundRunContractSha256     = bbb7db4fd5a5ffdfb58ca9242e456c9e48de3a2577d97bb98241647439dcc1cf
```

F0-v2 的 281 个 anchor 文件仍逐项 `EXACT_UNCHANGED`；唯一 target-only 路径仍是 F1 runner，并由冻结 witness 归类为 `BUDGET_ONLY_PROJECTION`。4-file control inventory 没有变化，`c1-carried-removals.ts` 的历史 SHA-256 仍被校验。candidate hash 保持不变；final-bound hash 因新 execution revision/surface 重新计算。

## 授权入口

F1-32 现在导出单独的 `runC1F1Native32AuthorizedStudy()`，并提供带停止信号处理的 CLI。它复用已有 `C1AuthorizedProviderResponseSource`、F0-v2 hardening adapter、objective/regression oracle、snapshot/adjudication 和 evidence writer；F1 driver继续执行冻结的 32-call/run envelope。

调用前会从 clean checkout 重新计算 execution/control inventories 与 FINAL_BOUND hash，并逐字段核对授权记录：fresh single-use `studyId`、execution revision、两类 surface hash、candidate/final contract hash、enrollment manifest、provider config、完整 budget projection、Native-only、fallback/retry/resume/reuse 与 memory-only credential policy。缺失字段、额外字段、旧 hash、已 claim identity 或预算漂移会在 credential read、identity claim 和 fetch 之前拒绝。

credential reader 是延迟回调。CLI 先完成授权、合同、绑定、预算及 identity-unclaimed 检查，再从 `STEP_PLAN_API_KEY` 或明确给定的 `.env` 路径把值读入内存；执行报告只保留授权记录 SHA-256、owner 和时间，不写入 key。Node test 模式强制注入 fetch stub，生产模式拒绝自定义 transport。stop signal 会中止当前响应并阻断剩余 runs。

后续正式执行命令形式如下；本轮没有调用它：

```text
pnpm --filter @canvas-agent/context-benchmarks exec tsx \
  c1/f1/runner/c1-f1-32-execution-runner.ts \
  --authorization-file <owner-authorization.json> [--env-file <credential-file>]
```

## Credential-free 验证

Node 24 下的授权 fake-provider regression 已通过：

- `AUTHORIZED_PROVIDER` response source 经真实 F1 transport/driver 跑完 32-run schedule；测试 fetch stub 没有网络出口，报告标记 `INJECTED_FAKE_FETCH`、`networkRequests=0`。
- 32 个 per-run Provider request 上限在第 32 次后停止；预算 permit 与模拟 source request 对账。
- stale surface authorization 在 credential callback、identity claim 和 fetch 前拒绝。
- 请求模型、endpoint、token ceiling、Provider config、usage provenance、artifact redaction 均有断言；synthetic identity 输出目录在测试清理阶段删除。
- 原 credential-free runner 与授权入口相关回归：2 个测试文件、9 项测试通过；Context Benchmarks typecheck 通过。
- Node 24 `pnpm check:core` 全量通过：headless audit、format、lint、typecheck、全部 workspace tests 和 build；Context Benchmarks 为 41 个测试文件、313 项测试通过。

这些结果只证明授权执行路径和 evidence plumbing 可被假 Provider 驱动，不构成真实 Provider feasibility 结果。当前仍为：

```text
studyIdStatus       = NOT_CREATED
owner authorization = NOT_GRANTED
Provider calls      = 0 real
network requests    = 0 real
F1-32 live          = NO_GO
```

新增执行代码与 authorized fake-provider regression 提交为 `0e55a36f3a2c47bef9d90611df1c75a389a9263d`。此报告、final-bound artifact 与 binding regression test 属于后续 binding-only 记录；它们不替代独立 binding review、fresh identity 或 owner authorization。
