# C1 生命周期 Canary SV2 真实执行（LIVE）：PASS / 纯 eviction 可达

日期：2026-09-09（Asia/Shanghai）。执行提交：`69d9dfc923b64a293aac4eae2dd510178c8f34b4`。
Study identity：`c1-lifecycle-sv2-20260909-ef4d90a2`（已消耗、terminal、retired）。
合同：`C1_LIFECYCLE_CANARY_SV2`，SHA-256
`87bd74f1caea0a80cee8c4c85da6d3768a52ef950548de630516c3e8f4abb613`。
Provider：Step Plan / `step-3.7-flash`，无 fallback，Runtime-only 单臂。
性质：受控机制诊断（`CONTROLLED_MECHANISM_NOT_EFFECTIVENESS`）。**不是**任务效用、成本节省、token savings
或 C1 64-leg effectiveness 实验。

冻结依据：[SV2 零 Provider 验收](./cspv-c1-lifecycle-canary-sv2-zero-provider-2026-09-09.zh-CN.md) ·
[SUPERSEDED_VERSION 生命周期合同](../plan/c1-superseded-version-lifecycle-contract-2026-09-08.zh-CN.md)。

## 1. 授权链

- owner 在本对话中确认按冻结绑定执行一次 live request；授权绑定文件为 ignored 的
  `research/context-benchmarks/reports/lifecycle-canary-sv2-preparation-20260909/authorization.authorized.json`。
- 授权精确覆盖 execution revision、study identity、contract SHA、Step Plan `step-3.7-flash`、
  内联 synthetic fixture、最多 1 个 Provider request、Provider tool request 上限 0、无 fallback、不可 resume/retry。
- 凭据从 `/Users/v/Documents/V/.env` 注入本地进程内存，仅供本次请求使用；未输出、未写入 Git、未写入证据。
- identity 在 Git common directory 永久登记并消耗：
  `.git/c1-lifecycle-sv2-identities/c1-lifecycle-sv2-20260909-ef4d90a2.json`，`consumed=true`、
  `resume=FORBIDDEN`。不得恢复、重试或复用。

## 2. 执行结果

| 项目                    | 值                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------- |
| 状态                    | **PASS**（`terminal=true`、`retired=true`）                                           |
| Protocol                | `protocolCompleted=true`                                                              |
| Leg                     | RUNTIME 尝试 1、完成 1                                                                |
| 真实 Provider 调用      | 1（`providerCalls=1`、`networkRequests=1`、`fakeResponses=0`）                        |
| Provider tool request   | 0；tool execution 0                                                                   |
| Provider 响应           | 已观察、已持久化；`outcome=COMPLETE`                                                  |
| Provider usage          | input 532 / output 56 / total 588；cache read `REPORTED=0`；cache write `UNAVAILABLE` |
| Runtime 生命周期        | `runtimeContextChanged=true`；transition 含 2 个 `REMOVE`                             |
| Replay 裁定             | 2 条：`NOT_CANDIDATE=1`、`SUPERSEDED=1`                                               |
| 移除来源                | `run/tool-call://sv2-seed-read-a-v1` 与对应 `run/tool-result://sv2-seed-read-a-v1`    |
| 陈旧对是否到达 Provider | `stalePairPresentInProviderBoundMessages=false`                                       |

## 3. 证据与对账

原始 metadata-only 证据保留在 ignored 目录：
`research/context-benchmarks/reports/lifecycle-canary-sv2-live-20260909/c1-lifecycle-sv2-20260909-ef4d90a2/`。
该目录包含 `binding.json`、`checkpoints.jsonl`、`lifecycle-replay.jsonl` 和 `report.json`，权限为私有模式。

文件 SHA-256：

```text
binding.json          cc937ab9ae2a9ff7cd40cf53b24e9d26e81f6060c9101d6b0fa3705a0e4e826a
checkpoints.jsonl     94efd0ab7c7229d0ec9d9fb537c21f460622bcdba106a95d030446bb126eb3dc
lifecycle-replay.jsonl
                      27457c04b10b9f8c84bb32d089c9d9a778038d6e2e783a4848ad66f801327712
report.json           f008699cf1e16dc7fa67a1c735b03f42ca742f5ca43586f456a544e70c4fa861
```

checkpoint 序列完整：

```text
1  OUTBOUND_PERMITTED
2  RESPONSE_RECEIVED
3  RESPONSE_RECORDED
```

全程和已完成 leg 的账本均为 1 次 outbound permit、1 次 normalized response、0 次 permit-without-response、
1 次 response recorded、0 次 provider tool request。没有静默响应缺口。

Harness 实际执行并验证了：

```text
read src/a.js @ v1 → edit SUCCESS → src/a.js @ v2
→ durable replay + fsync/read-back → SUPERSEDED adjudication
→ pure eviction → replay/policy MATCH → provider-bound absence check
→ one real request
```

Provider-bound source keys 只保留中性 bootstrap 对和 `sv2-seed-edit-a-v1-to-v2` 对；陈旧 read pair 的 call/result
均不在 source keys 或消息列表中。durable artifacts 未包含 `AGENTS.md`、v1/v2 文件原文、raw request/response、
assistant 原文或凭据；只保存 hash、结构指纹、usage 和状态字段。

## 4. 结论边界

本次 PASS 支持一个有限的机制结论：在一个 harness-seeded、单 Runtime leg 的真实 Provider 请求中，
`SUPERSEDED_VERSION` replay evidence 能在请求前被持久化和裁定，策略能移除陈旧 read pair，且该移除结果
在 provider-bound source/message 边界上得到确认。

本次执行不回答任务质量、答案正确性、成本、token savings、跨模型泛化、carried removal，也不代表 C1 64-leg
effectiveness。`outcome=COMPLETE` 只表示该次协议收到终止型响应，不是任务 oracle 结论。该 single-use identity
已经退休，后续不同设计必须使用新合同、新 identity、新 execution revision 和新授权。

## 5. 后续状态

- SV2 机制问题：**CLOSED / PASS（单次可达性）**。
- SV1 历史证据与其未知项：保持不变，不回填。
- §11.5 与 C1 64-leg effectiveness：仍需另行设计、review 和授权，不能由本次 PASS 自动开启。
