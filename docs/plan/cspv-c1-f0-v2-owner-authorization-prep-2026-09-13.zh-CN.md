# F0-v2 Owner Authorization Preparation

日期：2026-09-13（Asia/Shanghai）

状态：`DRAFT / PREPARED / PENDING_OWNER_AUTHORIZATION / ZERO_PROVIDER`

本记录把已实现并通过 PR #131 review/合并的 F0-v2 live binding 整理成授权草案。它不构成 owner
授权，不 claim 或 consume study identity，不读取 `STEP_PLAN_API_KEY`，也不执行 Provider。

## 授权边界

本次准备只绑定以下已冻结事实：

- F0-v2 的 task panel、prompt、fixture、oracle、32-run shape、预算、阈值、evidence、firewall 与 recovery policy；
- final-bound contract、execution revision、execution surface hash、enrollment manifest 与 provider config hash；
- 一个 fresh、single-use、尚未 claim 的 study identity 候选。

任何 task、prompt、fixture、oracle、预算、阈值、tool envelope、Provider 配置或 evidence 语义变化，都必须重新
进入 freeze 与 binding review，不能在本记录或候选 identity 上修补。

## 精确 binding

```text
Contract ID                         = C1_F0_EXECUTION_FEASIBILITY_V2
Final-bound contract                = research/context-benchmarks/c1/f0/contracts/c1-f0-execution-feasibility-v2-final-bound.json
Freeze candidate SHA-256            = 31663b2833ea8ecf46fdc1165dd69b87e12c4ce1999fd595307368448d0606a7
Final-bound run-contract SHA-256    = b340c987903318b0fed72de26007cc4a29d88cae0ac51a399eaa33cd4c6ebdab
Execution revision                  = c072af5c4fb3245a74e457a616d0c2b78ddd3f3d
Execution surface SHA-256           = bde57600d2f57ab48210298bcaa0b58283fe003301f617aa506eacddb46f0ae2
Enrollment manifest                 = research/context-benchmarks/c1/manifests/c1-effectiveness-v1.json
Enrollment manifest SHA-256         = 2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38
Provider config SHA-256             = bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a
Node range                          = >=24.0.0 <25.0.0
Live binding merge commit          = eb060c37e7bf74038c279a858c98523f7d322467
Live binding PR                    = #131
```

`c072af5…` 是由 executable surface 解析出的 revision；后续文档、合同数据和授权准备记录不改变它。`31663b…`
是不可变的 research freeze candidate hash，不能被 final binding 替换。

## Provider binding

```text
Provider                            = step-plan
Model                               = step-3.7-flash
Endpoint                            = https://api.stepfun.com/step_plan/v1/chat/completions
Credential environment              = STEP_PLAN_API_KEY
Credential persistence              = MEMORY_ONLY
Fallback                            = NONE
Runtime intervention                = DISABLED
Response source required for live   = AUTHORIZED_PROVIDER
```

credential-free runner 仍保持独立，当前已合并的 live runner 另外提供 authorized-provider 模式：

```text
C1_F0_V2_RUNNER_MODE               = CREDENTIAL_FREE_NATIVE_ONLY
responseSource                      = SCRIPTED_FAKE
providerCalls / networkRequests     = 0 / 0

C1_F0_V2_LIVE_BINDING_MODE         = AUTHORIZED_PROVIDER_NATIVE_ONLY
responseSource                      = AUTHORIZED_PROVIDER
```

因此 live execution 已有独立 wiring，但仍必须使用 exact final binding、fresh identity 和 owner sign-off；这份草案
本身不自动授权 Provider。

## Fresh study identity 候选

```text
Candidate studyId                   = c1-f0-v2-20260913-de68f062
Identity status                     = NOT_CLAIMED / NOT_RESERVED
Derivation                          = SHA-256(final-bound contract SHA + date + authorization-prep-v2)[0:8]
```

该候选值只写入本准备记录，不创建报告目录，不写入 live output store，也不消耗 identity。准备时已检查仓库文本与
本地研究输出目录，没有发现相同的 v2 study identity。

只有在 owner 明确授权、所有 pre-call gate 通过后，runner 才能在 fresh output root 原子 claim 这个 exact identity。
如果 identity、run path、checkpoint path 或 report path 已存在，必须 fail closed，并重新生成新的授权记录；不得
resume、retry、reuse、overwrite 或 rebind。候选 identity 不能改成另一个值来绕过冲突。

## Frozen study scope 与预算

```text
Arm                                 = NATIVE_ONLY
Runtime intervention                = DISABLED
Task count                          = 2
Runs per task                       = 16
Total runs                          = 32
Run order                           = deterministic balanced alternation
Alternation seed                    = c1-f0-v2-task-order-20260913
Max concurrency                     = 1
```

| 范围 | Provider requests | Tool requests | Wall clock |
| --- | ---: | ---: | ---: |
| 每个 run | 24 | 96 | 600,000 ms |
| 整个 study | 768 | 3,072 | 19,200,000 ms |

冻结裁决门槛：

```text
max unknownRunRate                         = 0.125
min adjudicable runs per task              = 14
lower95(successAmongAdjudicable)           >= 0.80
upper95(budgetExhaustionRate)              <= 0.20
upper95(unrecoveredToolFailureRunRate)     <= 0.20
lower95(oraclePassAmongAdjudicable)        >= 0.80
```

UNKNOWN 不计作 feasibility failure，但必须进入 precision gate。普通任务失败、tool failure 和 budget exhaustion
留在分母；共享合同、identity、evidence 或基础设施 invalidator 才能阻断剩余 runs。

## Evidence 与 terminal policy

study 必须生成以下 metadata-only artifacts：

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

`task-adjudication.jsonl` 中的 cleanup 前记录必须标记 `PRE_CLEANUP_ADJUDICATION`，只保存当时已知的 oracle、scope、
snapshot、evidence、provenance 和 recovery 事实；最终 `runDisposition` 与 `fixtureCleaned` 只能由 cleanup 后的
run record / run manifest 提供唯一来源。

禁止持久化 credential、Authorization header、raw provider payload、raw prompt、assistant text、raw tool arguments、
raw command 或 tool-result content。任何 evidence schema conflict、missing provenance row、raw-data leakage、binding
mismatch 或 hard infrastructure failure 都必须：

```text
preserve durable evidence
→ abort active transport when applicable
→ cleanup active sandbox
→ latch study terminal
→ forbid resume / retry / reuse / next-leg continuation
```

## Pre-call gate

| Gate | 当前准备状态 |
| --- | --- |
| Frozen research semantics | `PASS / IMMUTABLE` |
| Freeze candidate hash | `PASS / 31663b…` |
| Final-bound contract | `PASS / b340c9…` |
| Actual surface ↔ contract binding | `PASS / c072af5… + bde57600…` |
| PR #129 independent review | `APPROVED` |
| PR #129 merge + post-merge CI | `PASS / 8b98fb1… / 34745499654` |
| PR #131 live binding review + merge | `APPROVED / MERGED / eb060c3…` |
| PR #128 final-binding stack | `OPEN / DRAFT / MERGE PENDING` |
| Credential-free E2E | `PASS / ZERO_PROVIDER` |
| Authorized-provider live response source | `IMPLEMENTED / FAKE_FETCH_E2E_PASS` |
| Candidate identity | `NOT_CLAIMED / NOT_RESERVED` |
| Owner decision | `PENDING EXPLICIT SIGN-OFF` |

在 `PR #128` stack 收口、exact final binding 复核和 owner 明确签署前，不得 claim identity 或发出第一条 Provider request。

## Owner sign-off template（未授权）

```text
CSPV-C1 F0-v2 Owner Authorization
Decision:                         PENDING OWNER SIGN-OFF
Authorization owner:              <owner to sign>
Authorization timestamp (UTC):   <set only at sign-off>
Contract ID:                      C1_F0_EXECUTION_FEASIBILITY_V2
Freeze candidate SHA-256:          31663b2833ea8ecf46fdc1165dd69b87e12c4ce1999fd595307368448d0606a7
Final-bound run-contract SHA-256:  b340c987903318b0fed72de26007cc4a29d88cae0ac51a399eaa33cd4c6ebdab
Execution revision:               c072af5c4fb3245a74e457a616d0c2b78ddd3f3d
Execution surface SHA-256:        bde57600d2f57ab48210298bcaa0b58283fe003301f617aa506eacddb46f0ae2
Enrollment manifest SHA-256:      2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38
Provider config SHA-256:          bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a
Study identity:                   c1-f0-v2-20260913-de68f062
Identity status:                  NOT_CLAIMED / NOT_RESERVED
Provider/model:                   step-plan / step-3.7-flash
Endpoint:                         https://api.stepfun.com/step_plan/v1/chat/completions
Credential:                       STEP_PLAN_API_KEY / MEMORY_ONLY
Fallback:                         NONE
Node range:                       >=24.0.0 <25.0.0
Scope:                             2 tasks / 16 runs per task / 32 runs total / NATIVE_ONLY
Budgets:                           24/96/600000 per run; 768/3072/19200000 study
Unknown policy:                   U=0.125 / M=14 / UNKNOWN is not failure
Recovery:                          max identical attempts=2; corrected retry model-emitted; no implicit retry
Resume/retry/reuse/rebind:        FORBIDDEN
Provider execution:               NO_GO UNTIL EXACT STACK + EXPLICIT OWNER SIGN-OFF
```

该 block 只有在所有 binding 仍与本记录一致、fresh identity 仍未 claim、live source 已独立 review 后，才可由 owner
填写决策与时间。任何 binding 变化都要求生成新的授权记录。

## 下一步

1. 收口并合并 `PR #128`，或对包含 exact final-bound contract 的执行 checkout 完成一次新的独立确认；
2. 重新核对候选 identity `c1-f0-v2-20260913-de68f062` 未 claim、报告路径为空、预算与合同逐项相等；
3. 由 owner 明确签署后，才允许原子 claim identity 和执行一次 F0-v2 live study。

在这些步骤完成前，F0-v2 live、T0 和 E1 继续为 `NO_GO / HOLD`。
