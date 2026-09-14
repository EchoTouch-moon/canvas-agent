# F0-v2 Live Execution V2 报告

日期：2026-09-13（Asia/Shanghai）

状态：`VALID / F0_V2_FEASIBILITY_NO_GO / CONSUMED`

本报告对应授权记录 V2 绑定的一次完整 F0-v2 Native-only study。它是有效、可判读的 feasibility 结果，但不支持
Context Runtime effectiveness、T0 或 E1 结论。

## Immutable identity and binding

```text
Study identity                     = c1-f0-v2-20260913-341fbab9
Identity status                    = CONSUMED / RETIRED
Final-bound run-contract SHA-256   = 4120e8d4c5c029ce224fb1341989cdc208d96799f1c399e736ee77aa36ea0611
Execution revision                 = 6d0189a998772e8d9e379f8ec56bc7f429546a2a
Execution surface SHA-256          = 583f6c974c207eb3e338b89aa345ab1aadd894fb25d83455b06ee59af13fbe0a
Enrollment manifest SHA-256        = 2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38
Execution checkout                = ec0940bf7d727b693495970346c3141714023a24
Authorization record              = docs/plan/cspv-c1-f0-v2-owner-authorization-v2-2026-09-13.zh-CN.md
```

## Study-level result

```text
Runs planned                       = 32
Runs started                       = 32
Runs completed                     = 32
Runs blocked                       = 0
Provider calls                     = 510
Network requests                   = 510
Response rows                      = 510
Tool executions                    = 725
Unknown runs                      = 0
Evidence-complete runs            = 32
```

```text
VALIDITY_GATE                     = PASS
PRECISION_GATE                    = PASS
PROVENANCE / RECOVERY SAFETY      = PASS
FEASIBILITY_GATE                  = FAIL
Final status                      = F0_V2_FEASIBILITY_NO_GO
```

这次不是 evidence 丢失或 shared invalidator 导致的 NO_GO；32 个 run 都有完整 evidence，且两个 task 各启动 16 个 run。
NO_GO 来自预先冻结的 feasibility gate。

## Per-task adjudication

| Task | Success | Failure | Unknown | Budget exhaustion | Oracle pass | Unrecovered-tool runs | Feasibility gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `c1-t1-localized-distractor-v1` | 16/16 | 0 | 0 | 0 | 16/16 | 4/16 | FAIL（unrecovered upper95=0.4844 > 0.20） |
| `c1-t2-multi-file-migration-v1` | 7/16 | 9 | 0 | 8/16 | 10/16 | 8/16 | FAIL |

具体区间：

```text
t1 success lower95                  = 0.8293  (pass)
t1 budget exhaustion upper95        = 0.1707  (pass)
t1 unrecovered failure upper95      = 0.4844  (fail)
t1 oracle pass lower95              = 0.8293  (pass)

t2 success lower95                  = 0.2267  (fail)
t2 budget exhaustion upper95        = 0.7214  (fail)
t2 unrecovered failure upper95      = 0.7214  (fail)
t2 oracle pass lower95              = 0.3910  (fail)
```

t1 的任务与 oracle 本身全部完成，但 4 个 run 存在未恢复工具错误，因此仍不能通过冻结的 safety/feasibility gate。
t2 仍是主要 feasibility 瓶颈：8 个 run 达到 24-provider-request 上限，9 个 run 的最终 feasibility disposition 为
failure，oracle 仅 10/16 pass。

## Tool and recovery evidence

```text
Failure class                     = NONE 624 / COMMAND_FAILED 64 / EDIT_MATCH_COUNT 32 / PATH_NOT_FOUND 5
Recovery action                   = NONE 624 / INSPECT_COMMAND_RESULT 64 / REISSUE_CORRECTED_ARGUMENTS 32 / REREAD_TARGET 5
Side-effect attribution           = EDIT_TOOL 152 / BASH_TOOL 3 / NONE 570
Provenance status                 = COMPLETE for all 32 runs
```

每个 tool execution 都有一条 metadata-only provenance；`task-adjudication.jsonl` 的 32 行均为
`PRE_CLEANUP_ADJUDICATION`，最终 disposition 只来自 cleanup 后 run manifest。

## Durable artifact hashes

```text
study-manifest.json                  = cf504271c90bbb21192ddb0ec4d0951fbbaab0c899ae477288031bc02fff8b26
run-manifest.json                    = 5c76e91e6fcba2cb8fadf353e424ee9ce73661ff8b44a44937bbe7ec5db9728a
checkpoints.jsonl                    = 47f83522863a01b41b61b0cd7474150f2b62aeadc1829fd67628422a7e62f755
checkpoint-summary.json              = 1e6030a2a6fc890da910fc64cedeb05eac9d8ee687672d26329031fcffc1e3cb
response-ledger.jsonl                = 1f2a6497ab82cba24efe01a73b32f2eb560199d8f71f2fc0dba009f892da9c6f
tool-provenance.jsonl                = d81d4c0446404bc9023d6c75d2c2484351a99fe3ede25ede7774d3c629039c1e
post-run-snapshot-manifest.jsonl     = 5d178cf0c049dab27aa2040d38b89cbfec4364e8b932c11023170446c80a8c10
task-adjudication.jsonl              = 1bb4814019a7fedc53a6665a027ebd8556f5540bf96251d0941f0f2eb99465cf
feasibility-summary.json             = 9bff7c8ca4b70be542acfc3d9d9f9e9c70670a27247d76eb278d7b6357444cac
```

对所有 artifacts 的 raw credential、Authorization header、provider payload、assistant content、raw arguments 和
tool-result content 扫描均无命中。原始输出目录保留在执行 worktree，不回填、不重试、不复用。

## Research interpretation

```text
Execution validity                 = PASS
Execution precision                = PASS
Native feasibility under v2        = NO_GO
Semantic lifecycle opportunity     = unchanged
Runtime treatment exposure         = NOT MEASURED
Causal effectiveness               = NOT MEASURED
```

本结果可以支持：在冻结的两个 task、24/96/600000 budget 与 hardening 条件下，Native execution feasibility
未达到预设门槛。它不能支持“Context Runtime 无效”、Runtime-vs-Native 效果比较、token savings 或 T0 triggerability
结论。Study identity 已 consumed；任何修改 task、prompt、budget、tool envelope 或 recovery policy 的后续工作都必须
建立新的 contract、binding 和 identity。
