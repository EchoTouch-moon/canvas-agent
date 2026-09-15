# F0-v2 Live Execution 报告

日期：2026-09-13（Asia/Shanghai）

状态：`TERMINAL / STUDY_INVALID / CONSUMED`

本报告对应一次已获授权但被 runner 证据分类缺陷终止的 F0-v2 live attempt。该 study 不构成可解释的 feasibility
结果，不得补跑、resume、retry、reuse 或 rebind。

## Immutable identity and binding

```text
Study identity                     = c1-f0-v2-20260913-de68f062
Identity status                    = CONSUMED / RETIRED
Final-bound run-contract SHA-256   = b340c987903318b0fed72de26007cc4a29d88cae0ac51a399eaa33cd4c6ebdab
Execution revision                 = c072af5c4fb3245a74e457a616d0c2b78ddd3f3d
Execution surface SHA-256          = bde57600d2f57ab48210298bcaa0b58283fe003301f617aa506eacddb46f0ae2
Enrollment manifest SHA-256        = 2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38
```

## Observed execution

```text
Runs planned                       = 32
Runs started                       = 4
Runs completed before invalidation  = 4
Runs blocked                       = 28
Provider calls                     = 68
Network requests                   = 68
Response rows                      = 68
Tool executions                    = 88
Task adjudication rows             = 4 (all PRE_CLEANUP_ADJUDICATION)
```

前三个 leg 正常完成并完成 cleanup；第 4 个 leg 在 24 次 Provider request 后收到：

```text
PREFLIGHT_FAILURE: live binding leg reached maxCalls=24 without a terminal outcome
```

这类错误实际对应冻结合同中的 per-run budget exhaustion，应该保留为该 run 的可判定失败并继续后续 runs；当前
runner 却把所有 `PREFLIGHT_FAILURE` 都升级成 shared invalidator，错误地将整项 study 置为 `STUDY_INVALID` 并阻断
剩余 28 个 runs。

因此本次裁定是：

```text
Runner classification defect observed
→ validity gate FAIL
→ study invalid / identity consumed
→ no feasibility estimate
```

不能从前三个成功 leg 推断 task feasibility，也不能把 28 个未执行 runs 当作失败。

## Durable evidence integrity

已写入并保留以下 artifacts：

```text
study-manifest.json
run-manifest.json
checkpoints.jsonl
checkpoint-summary.json
response-ledger.jsonl
tool-provenance.jsonl
post-run-snapshot-manifest.jsonl
task-adjudication.jsonl
feasibility-summary.json
```

artifact SHA-256：

```text
study-manifest.json                  = 8afefdd00c7c331a1f6b2803592aad1380790f5fde41a09d9aae7e7be6d7c1f2
checkpoints.jsonl                    = b8a6612e9970396b15d54b58b1fcd1e74c831314d6345784fdcb1e8397c310a7
checkpoint-summary.json              = 34d199126b230771f983b45fb3cd1dfa11bf15fb644475c79adc51fe8856b059
response-ledger.jsonl                = 2a922810edb9eea4ebfe8fab6979f18d56432a956cf2dc67c39fba487472a494

tool-provenance.jsonl                = 1a389708df2c215f59e6226080df6ca79be0429b17cef0348a0ed04cd1e52a70
post-run-snapshot-manifest.jsonl     = 9228a56caf6122fe71c56285ec5ef67a550d5388be31152fc194fb4e5eea241e
task-adjudication.jsonl              = b80f6bf18e8a267d884e965339954e7e04c72598dbf107b977a60b6e495921db
feasibility-summary.json             = a438d809db6ad1a462c46ff8ce59a2145efbfaa804d61d05cda7b8388a6eef28
```

raw credential、Authorization header、provider payload、assistant content、raw arguments 和 tool-result content 未在
artifacts 中发现。`task-adjudication.jsonl` 的 4 行均为 pre-cleanup facts，没有与最终 run record 形成第二个
conflicting disposition。

## Follow-up boundary

必须先修复并测试以下规则，再创建新的 final binding 与新的 study identity：

```text
PREFLIGHT_FAILURE + maxCalls=24
→ BUDGET_EXHAUSTED / ordinary run failure
→ evidence complete when checkpoint join is complete
→ continue next run

PREFLIGHT_FAILURE from provider response/schema/usage integrity
→ STUDY_INVALID
→ block remaining runs
```

新的 binding 和 identity 不得把本次 `de68f062` 当作补跑；本次 identity 永久不可复用。
