# F0-v2 Owner Authorization Record V2

日期：2026-09-13（Asia/Shanghai）

状态：`AUTHORIZED / F0_V2_LIVE_GO / SINGLE_USE / PROVIDER_EXECUTION_PERMITTED`

本记录覆盖一次全新的 F0-v2 Native-only feasibility study。上一轮 `de68f062` 已被裁定为 runner classification
invalidator defect 并永久 consumed；本记录不恢复、重试、重绑定或重解释上一轮 identity。

生成与提交本记录不读取 credential、不 claim identity、不创建 live report 目录，也不发出 Provider request。

## Exact immutable binding

```text
Contract ID                         = C1_F0_EXECUTION_FEASIBILITY_V2
Freeze candidate SHA-256            = 31663b2833ea8ecf46fdc1165dd69b87e12c4ce1999fd595307368448d0606a7
Final-bound run-contract SHA-256    = 4120e8d4c5c029ce224fb1341989cdc208d96799f1c399e736ee77aa36ea0611
Execution revision                  = 6d0189a998772e8d9e379f8ec56bc7f429546a2a
Execution surface SHA-256           = 583f6c974c207eb3e338b89aa345ab1aadd894fb25d83455b06ee59af13fbe0a
Enrollment manifest SHA-256         = 2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38
Provider config SHA-256              = bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a
Execution checkout                  = codex/c1-f0-v2-final-binding exact head ec0940bf7d727b693495970346c3141714023a24
Runner fix PR                       = #132, approved / merged
Post-merge Context Runtime CI       = 34758002755 / success
Node range                          = >=24.0.0 <25.0.0
```

runner 必须在执行前现场重算 execution revision 与 surface hash，并与 final-bound contract 和本记录逐项相等。任何
executable surface 变化都会使本记录失效。

## Provider binding

```text
Provider                            = step-plan
Model                               = step-3.7-flash
Endpoint                            = https://api.stepfun.com/step_plan/v1/chat/completions
Credential environment              = STEP_PLAN_API_KEY
Credential persistence              = MEMORY_ONLY
Fallback                            = NONE
Response source                     = AUTHORIZED_PROVIDER
Runtime intervention                = DISABLED
```

credential 只允许在 exact authorization、contract、surface、manifest、provider 和 identity preflight 全部通过后读入
内存，不得写入任何 durable artifact。

## Authorized study identity

```text
Study identity                     = c1-f0-v2-20260913-341fbab9
Identity status                    = FRESH / NEVER_CLAIMED / SINGLE_USE
```

runner 必须在 fresh output root 原子 claim 这个 exact identity；若 identity 或任何关联路径已经存在，必须在首个
Provider request 前终止。claim 后无论成功、失败、budget exhaustion 或 evidence invalidator，均不得 retry、resume、reuse、
overwrite 或 rebind。

## Frozen study shape and budgets

```text
Arm                                = NATIVE_ONLY
Task count                         = 2
Runs per task                      = 16
Total runs                         = 32
Run order                          = deterministic balanced alternation
Alternation seed                   = c1-f0-v2-task-order-20260913
Max concurrency                    = 1
Per-run budget                     = 24 Provider / 96 tool / 600,000 ms
Study budget                       = 768 Provider / 3,072 tool / 19,200,000 ms
```

```text
max unknownRunRate                         = 0.125
min adjudicable runs per task              = 14
lower95(successAmongAdjudicable)           >= 0.80
upper95(budgetExhaustionRate)              <= 0.20
upper95(unrecoveredToolFailureRunRate)     <= 0.20
lower95(oraclePassAmongAdjudicable)        >= 0.80
```

普通 run failure、tool failure 和 budget exhaustion 留在分母；UNKNOWN 不计作 feasibility failure，但进入 precision gate。
共享合同、identity、evidence 或 infrastructure invalidator 才能阻断剩余 runs。

## Evidence and terminal policy

必须生成：

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

`task-adjudication.jsonl` 的 cleanup 前记录必须标记 `PRE_CLEANUP_ADJUDICATION`，不得写最终 `runDisposition` 或
`fixtureCleaned`；cleanup 后的 run-manifest 提供唯一最终判定。

任何 binding mismatch、missing provenance row、schema conflict、raw payload/credential leakage、budget breach 或
hard infrastructure failure 都必须保留已有证据、清理 sandbox、latch study terminal，并禁止后续 leg、resume、retry、reuse
和 rebind。

## Owner decision

```text
Decision                           = AUTHORIZED / F0_V2_LIVE_GO
Authorization owner               = EchoTouch-moon
Authorization timestamp (UTC)     = 2026-09-13T12:50:29Z
Authorization scope               = one F0-v2 Native-only study, 32 runs
Provider execution                = PERMITTED FOR THIS EXACT RECORD ONLY
T0 / E1 / Runtime intervention    = NO_GO / HOLD
```

该授权不改变冻结研究语义，不授权任何后续 study。study terminal 后必须生成新的 contract binding 与 authorization record。
