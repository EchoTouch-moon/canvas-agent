# F0-v2 Credential-free Runner Integration 验证记录

日期：2026-09-13（Asia/Shanghai）

状态：IMPLEMENTED / CREDENTIAL_FREE_E2E_PASS / REBOUND_BINDING_REVIEW_REQUIRED / NO_PROVIDER

本记录对应冻结的 F0-v2 candidate contract 和独立 runner：
research/context-benchmarks/c1/f0/v2/runner/c1-f0-v2-execution-runner.ts。
它只验证编排、证据和 hardening 接线，不创建 live authorization，不读取真实 credential，不访问 Provider。

## 执行边界

```text
contract                    = C1_F0_EXECUTION_FEASIBILITY_V2
freezeCandidateRunContract  = 31663b2833ea8ecf46fdc1165dd69b87e12c4ce1999fd595307368448d0606a7
executionRevision           = 926be0a5e6eeecd08303a644a3858d61bb8212ba
executionSurfaceHash        = 9b600f7d20f6d543939881c9c92fd9badac55025d2982692bbc18dc2727b3974
responseSource              = SCRIPTED_FAKE
providerCalls / network     = 0 / 0
task panel                  = same two F0-v1 tasks
run shape                   = 32 runs, 16 per task
budgets                     = 24 provider / 96 tool / 600000 ms per run
```

runner 显式加载 FREEZE_CANDIDATE phase，并拒绝已经填入 execution revision 或 surface hash 的 candidate。
future final-bound contract 必须由 phase-aware validator 另行校验。

contract JSON 属于研究合同数据，由 runContractSha256 绑定，刻意不进入 execution surface；否则 candidate→final-bound
替换会与 executionSurfaceHash 形成循环。

## 已接入的执行链

每个 run 依次执行：

1. fresh fixture materialization 与 frozen task hash 校验；
2. shared C1LiveBindingDriver 的 Native-only response/checkpoint path；
3. C1_F0_TOOL_HARDENING_V1 adapter，写入逐 tool metadata-only provenance；
4. execution 终止后冻结 post-run fixture snapshot 与 hash；
5. 在 snapshot 上完成 writable-scope 与 objective/regression adjudication；
6. 以 `PRE_CLEANUP_ADJUDICATION` 写入 cleanup 前已知的 metadata-only 事实，不写最终 disposition 或
   `fixtureCleaned`；
7. 清理 live sandbox 后，由最终 run record / run-manifest 写入唯一的 `runDisposition` 与 `fixtureCleaned`。

因此 `task-adjudication.jsonl` 与 cleanup 结果通过 `runId` 一对一 join，单次 run 只有一个最终判定来源，
不会再出现 cleanup 前后两个相互矛盾的 durable disposition。

普通 run failure、tool error 和 budget exhaustion 留在分母；shared evidence/identity/provider invalidator
阻断剩余 runs。UNKNOWN 使用独立 run disposition 和 precision unknown-rate 统计，不压成 failure。

## Credential-free 场景回归

c1-f0-v2-execution-runner.test.ts 覆盖：

- 32-run balanced plan、v2 run identity 与 task coverage；
- TOOL_RECOVERY：不同 canonical request 的 corrected success、recovery linkage、provenance 与零 network；
- TOOL_SIDE_EFFECT：BASH_TOOL 对 package-lock.json 副作用的 prospective attribution；
- UNKNOWN_SNAPSHOT：snapshot unavailable → FEASIBILITY_UNKNOWN；
- SINGLE_RUN_FAILURE：普通失败后继续剩余 runs；
- STUDY_INVALIDATOR：shared invalidator 后阻断剩余 runs；
- TOOL_LOOP：第三次相同 canonical failure 被 block，streak=3。
- cleanup join：pre-cleanup adjudication 不含最终 disposition/cleanup 字段，最终 run-manifest 恰有一条
  对应判定；

所有 durable artifacts 都拒绝 raw arguments、command、assistant content、provider payload、credential 和
tool-result content。测试使用临时 output root，结束后清理；其 study IDs 只是 credential-free test identity，
不构成 live study authorization。

## 验证结果

```text
Node 24 runner integration tests   9/9 passed
Node 24 benchmark suite             36 files / 279 tests passed
headless core gate                 audit / format / lint / typecheck / test / build passed
Provider / network                  0 / 0
final-bound contract                rebound and locally validated; independent binding review required
owner authorization                 NO_GO
```

本次 runner evidence correction 已产生新的 executable binding；旧的 `164a3e… / 7f540b…` 不再适用。只有独立
binding review、fresh live identity 和 owner authorization 都完成后，才可进入 F0-v2 live。
