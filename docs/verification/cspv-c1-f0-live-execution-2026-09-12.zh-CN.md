# F0 真实执行报告

日期：2026-09-12（Asia/Shanghai）

裁决：**`F0_FEASIBILITY_NO_GO`**

本报告记录一次已授权、不可重跑的 F0 Native-only study。F0 只回答冻结 task panel 上的执行可行性，不比较
Native 与 Runtime，也不产生 treatment effect、Dose 或 T0/E1 结论。

## 不可变绑定

```text
studyId                 = c1-f0-20260912-41753674
contractId              = C1_F0_EXECUTION_FEASIBILITY_V1
runContractSha256       = a564ae3f3102678142d7a67c3e0a33f238c22d3221784d7926cc2b44d8349122
executionRevision       = c38785ada3573c2cc7a3927fd53c6670142eb537
executionSurfaceHash    = 587e4ec6cd7532ff405cb18214215f15d8cd7b0e90a8a58a6220336e82f5eeff
providerConfigHash      = bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a
provider                = step-plan
model                   = step-3.7-flash
executionBaseMerge      = fc2a693af244853843fd00bff028ecc6a9b997ff
```

`studyId` 已 consumed。不得 resume、retry、reuse 或用后续代码重新绑定这次 study。

## Study-level 结果

| 项目                              |                                                               结果 |
| --------------------------------- | -----------------------------------------------------------------: |
| 计划 / 启动 / 完成 / 阻断 run     |                                                   32 / 32 / 32 / 0 |
| Provider permits / response calls |                                                          513 / 513 |
| Network requests                  |                                                                513 |
| Tool executions                   |                                                                717 |
| terminationStatus                 | 21 `TERMINAL_COMPLETE`、1 `TERMINAL_FAILED`、10 `BUDGET_EXHAUSTED` |
| evidenceStatus                    |                                                      32 `COMPLETE` |
| VALIDITY_GATE                     |                                   `PASS`（shared invalidator = 0） |
| PRECISION_GATE                    |             `PASS`（两个 task 各 16 个 started run，run IDs 唯一） |
| FEASIBILITY_GATE                  |                                                             `FAIL` |
| 最终状态                          |                                         **`F0_FEASIBILITY_NO_GO`** |

## 分 task 结果

### `c1-t1-localized-distractor-v1`

- 16/16 run 到达 `TERMINAL_COMPLETE`，objective/regression oracle 为 16/16 `PASS`。
- 14/16 满足 end-to-end success；2 个 run 额外修改了 `package-lock.json`，触发 writable-scope failure。
- end-to-end success rate：`14/16 = 0.875`；单侧 95% Clopper–Pearson 下界：`0.6562`，低于 `0.80`。
- budget exhaustion：`0/16`；unrecovered tool failure：`0/16`；oracle pass among adjudicable：`16/16`。

### `c1-t2-multi-file-migration-v1`

- 16 个 run 中 5 个 `TERMINAL_COMPLETE`、1 个 `TERMINAL_FAILED`、10 个 `BUDGET_EXHAUSTED`。
- 5 个 oracle 完整通过；其中 4 个满足 end-to-end success。
- end-to-end success rate：`4/16 = 0.25`；单侧 95% 下界：`0.0903`。
- budget exhaustion rate：`10/16 = 0.625`；单侧 95% 上界：`0.8222`，高于 `0.20`。
- unrecovered tool failure run rate：`11/16 = 0.6875`；单侧 95% 上界：`0.8679`，高于 `0.20`。
- oracle pass among adjudicable：`5/16 = 0.3125`；单侧 95% 下界：`0.1321`，低于 `0.80`。

## 证据对账

本机原始证据目录：

```text
/Users/v/Documents/V-c1-f0-final-run/research/context-benchmarks/.live-output/c1-f0-live-binding/c1-f0-20260912-41753674
```

必需 artifact 的 SHA-256：

```text
study-manifest.json       e040a24f000ce337fcfe3cfb1c1e219d21e7d94ff32f1ca4b34fbfaa63c36e14
run-manifest.json         4ee755ec88511466dbf5359d939653ecc0ad86191d643d48dd5d691a417fd5a0
checkpoints.jsonl         2642c3acc6eebe0a946b0bec615a2cb10304d5c326d12fc8e57798977f29371d
checkpoint-summary.json   9eebc788776ece868224cdd218c6b14acb33064ea9a646061a068aee9bedb7b0
response-ledger.jsonl     c79e9145ac1187dd66778c2f9038a0964a316235729f42382433f104048c4f6d
task-adjudication.jsonl   d4f96d4e0803a8e789e7a7589aab39829f283348b70805032a8e181ae1169ad4
feasibility-summary.json  5632e82a9c64570aaf9779c89ac795a5e7e73a8b022fc2f10c11a8049ea98b74
```

checkpoint phases 为 `513 OUTBOUND_PERMITTED / 513 RESPONSE_RECEIVED / 717 TOOL_EXECUTION_RECORDED /
513 RESPONSE_RECORDED`；checkpoint ordinal 连续，32 个 run 的 response join 完整。所有 response evidence
均为 `AUTHORIZED_PROVIDER`、`networkSent=true`、`fallbackSent=false`、`NATIVE_UNMANAGED`，usage 均为
`PROVIDER_REPORTED`。报告 artifact 未发现 credential、原始 provider payload、assistant content、tool
arguments 或 tool-result content。

## 记录性问题

额外的 per-leg `leg-manifest.json` 中 `networkRequests` 当前写入的是 study 累计值，而不是该 leg 的局部值。
这不影响本报告使用的 checkpoint、response ledger、run record 或四层 gate；后续 runner hardening 应修正该
字段。该修复不得修改本次已消费 study 的原始 artifact，也不得触发补跑。

## 研究解释

这次结果证明：在当前 Provider、任务提示、工具边界和 24-call/run 预算下，两个冻结 task panel 的 Native
执行可行性没有达到预声明门槛，尤其 multi-file migration 的预算耗尽和未恢复工具失败率很高。

它不支持以下结论：

- Context Runtime 无效或有效；
- Runtime 相比 Native 的效果差异；
- lifecycle triggerability、Dose 或 token savings；
- 对整个 benchmark 或其他模型的泛化结论。

F0 的下一步是记录 `NO_GO` 并重新评估 task stratum、工具错误恢复和预算设计，再决定是否进入 T0 contract
设计；不得直接把这次结果升级为 E1 effectiveness 实验。
