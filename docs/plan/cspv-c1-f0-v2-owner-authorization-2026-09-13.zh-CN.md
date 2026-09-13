# F0-v2 Owner Authorization Record

日期：2026-09-13（Asia/Shanghai）

状态：`AUTHORIZED / F0_V2_LIVE_GO / SINGLE_USE / PROVIDER_EXECUTION_PERMITTED`

本记录依据 owner 在本任务中的明确授权生成，绑定一次且仅一次 F0-v2 Native-only feasibility study。它不授权
T0、E1、Runtime intervention 或任何其他 study；terminal 后不得 resume、retry、reuse 或 rebind。

生成与提交本记录不读取 credential、不 claim study identity、不创建 live report 目录，也不发出 Provider request。

## Exact immutable binding

```text
Contract ID                         = C1_F0_EXECUTION_FEASIBILITY_V2
Freeze candidate SHA-256            = 31663b2833ea8ecf46fdc1165dd69b87e12c4ce1999fd595307368448d0606a7
Final-bound run-contract SHA-256    = b340c987903318b0fed72de26007cc4a29d88cae0ac51a399eaa33cd4c6ebdab
Execution revision                  = c072af5c4fb3245a74e457a616d0c2b78ddd3f3d
Execution surface SHA-256           = bde57600d2f57ab48210298bcaa0b58283fe003301f617aa506eacddb46f0ae2
Enrollment manifest SHA-256         = 2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38
Provider config SHA-256              = bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a
Execution checkout                  = codex/c1-f0-v2-final-binding exact head eb060c37e7bf74038c279a858c98523f7d322467
Live binding implementation         = PR #131, approved and merged
Post-merge Context Runtime CI       = 34754471280 / success
Node range                          = >=24.0.0 <25.0.0
```

授权 runner 必须在执行前现场重算 execution revision 与 surface hash，并将它们与 final-bound contract 和本记录
逐项比较。文档提交不改变 executable surface；若任何 executable 文件变化，本记录立即失效。

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

credential 只允许在上述 binding、合同、Node 版本和 identity preflight 全部通过后读入内存，不得进入日志、合同或
任何 durable artifact。

## Authorized study identity

```text
Study identity                     = c1-f0-v2-20260913-de68f062
Identity status                    = FRESH / NEVER_CLAIMED / SINGLE_USE
```

runner 必须在 fresh output root 原子 claim 上述 exact identity；如果 identity、run、checkpoint 或 report path 已存在，
必须在首个 Provider request 前终止。该 identity 一旦被 claim，即使执行失败或 evidence invalid，也不得重试、恢复或复用。

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

所有 run（包括普通失败、tool failure 和 budget exhaustion）保留在分母。UNKNOWN 不计作 feasibility failure，
但必须进入 precision gate；shared contract、identity、evidence 或 infrastructure invalidator 才能阻断剩余 runs。

## Evidence and terminal policy

必须生成冻结的 metadata-only artifact set：

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
hard infrastructure failure 都必须 preserve durable evidence、清理 sandbox、latch study terminal，并禁止后续 leg、
resume、retry、reuse 与 rebind。

## Owner decision

```text
Decision                           = AUTHORIZED / F0_V2_LIVE_GO
Authorization owner               = EchoTouch-moon
Authorization timestamp (UTC)     = 2026-09-13T11:36:08Z
Authorization scope               = one F0-v2 Native-only study, 32 runs
Provider execution                = PERMITTED FOR THIS EXACT RECORD ONLY
T0 / E1 / Runtime intervention    = NO_GO / HOLD
```

本记录只授权上述 exact identity、exact checkout/binding、exact contract、Provider 配置、预算和 terminal policy。任何
绑定变化都要求新记录；study terminal 后不得修补本记录或复用该 identity。
