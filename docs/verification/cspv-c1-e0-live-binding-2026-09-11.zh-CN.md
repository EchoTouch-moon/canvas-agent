# C1 E0 Final Live Binding 验证记录

日期：2026-09-11（Asia/Shanghai）

状态：`IMPLEMENTED / NO_PROVIDER_EXECUTION / READY_FOR_INDEPENDENT_REVIEW`。

本记录对应独立分支 `codex/c1-effectiveness-e0-live-binding`。它把 #114 已验证的 E0 scheduler、
`C1LiveBindingDriver`、sandbox tool executor 和 durable checkpoint sink 接到一个单独的 live-binding
surface；没有启动真实 Provider，也没有读取 `.env` 或创建 owner authorization。

## 1. Binding

| 项目                         | 值                                                                 |
| ---------------------------- | ------------------------------------------------------------------ |
| Binding                      | `C1_EFFECTIVENESS_E0_LIVE_BINDING_V1`                              |
| Mode                         | `NO_PROVIDER_EXECUTION`                                            |
| Executable revision          | `2ad5a73f720ca2c94b7464611b04c71018b25e3a`                         |
| Enrollment manifest SHA      | `9b3d787219c93f8ba7563e5b52366245c6279a697b7e729b5426e12bfab7a6bb` |
| Freeze-prep run-contract SHA | `1fa1840c5869b2a3c60f891cb37b10706fc41830651f1bc56131e87753ffdfb3` |
| Run-contract code revision   | `PENDING_E0_EXECUTION`                                             |
| E0 provider request SHA      | `bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a` |
| In-memory strict profile SHA | `dbcbff3eb4549710faaa018aab784dbb56c3082dae673931c50cb15d999eabc8` |
| Study shape                  | 4 pairs / 8 legs / t1×2 / t2×2 / arm order 2:2                     |

`Executable revision` 由 live-binding 与其共享 Provider/driver source 的最后代码提交解析；后续文档提交
不会被冒充为 execution revision。`runContractSha256` 仍是 freeze-prep hash，最终 live binding 需要在
独立 review 与 owner authorization 前重新计算。

## 2. Natural lifecycle and evidence

`C1E0NaturalObservationSource` 从每个 fresh fixture 的真实 read/tool-result 开始。Runtime policy 的输入
只有 model-visible messages、tool requests/results、版本 fingerprint、transition evidence 和 carried
removal evidence；它不接收 expected writable paths、reference fixture、task label 或 oracle 输出。

每次成功的 edit/write 后，私有版本探针比较 `v1`/`v2`；只有版本变化才调用冻结的
`SUPERSEDED_VERSION` policy。Dose projection 从本次 evidence 的 transition `REMOVE` source keys 与
carried keys 派生 lifecycle pair ID，不在 leg 启动前建立 stale-key 集合。t2 的两个 bootstrap read pair
因此产生 2 个 lifecycle pair / 4 个 source elements，t1 产生 1 个 pair / 2 个 source elements。

Layer 2 在每条 leg 完成后运行冻结 objective 与 regression oracle；oracle 结果只进入 leg/pair report，
从未进入 Runtime policy。fake response 的 token、cache 和 latency 不被当作效率数据；缺失项保持
`UNAVAILABLE`/`UNKNOWN`。

## 3. Credential-free substitute run

独立临时 output root 中运行 study `c1-e0-20260911-bbbbbbb2`，使用显式 scripted response factory，
每次 edit 的内容取自 reference fixture 仅用于 substitute 验证。结果如下：

| 指标                        |       结果 |
| --------------------------- | ---------: |
| status                      |     `PASS` |
| legs completed              |        8/8 |
| provider calls              |          0 |
| network requests            |          0 |
| fake transport permits      |         48 |
| response receipts           |         48 |
| tool executions             |         40 |
| non-zero treatment pairs    |          4 |
| non-zero distinct tasks     |          2 |
| Layer 2 oracle legs         | 8/8 `PASS` |
| Runtime treatment integrity | 4/4 `PASS` |
| finalBindingReady           |    `false` |

Pair Dose：`c1-e0-01` 与 `c1-e0-03`（t2）各为 2 lifecycle pairs / 4 source elements；
`c1-e0-02` 与 `c1-e0-04`（t1）各为 1 pair / 2 source elements。所有 Runtime leg 的
`taskEvaluation` 为 `PASS`，效率 `providerUsage` 保持 `UNAVAILABLE`。

metadata-only artifact hashes（临时目录，报告完成后清理）：

```text
checkpoints.jsonl        0e39f520afff58bb920a6c4ecb97a39ccd1fd4285e046ad10cd7d356deebfbcd
checkpoint-summary.json  d2c5a0aad046f193c462e6e1fd44aaf33bfb3805848661b81e4a0969dbc6195a
study-events.jsonl       34f76f74dba211542704e5a80e8227d8f6048da8a8bfe96e7a87fdf6a6fd7837
response-ledger.jsonl    7cdfdbe69dd3663432e856e35daa9a995a15830f91a84e42597e4cbf602cc8a8
dose-evidence.jsonl      18510196cceabb47709bc69a743fd1696274caf378a92bbdf9facfb9bddca282
pair-adjudication.jsonl  6cad86b1e0f617237a07b031957cd6336724a999368f11d2313651b5ca125717
batch-qualification.json a1f8cde0adeb84bdf51f1584472c5afda4620ef4f95f839b9e5b781c4a8fb84c
run-manifest.json        bd5992982e4954115dab97ed6e87c5b3d98471632339b7a3e20cb93831199b88
```

`response-ledger`、Dose、pair 和 manifest 均通过 raw-content guard；没有
`providerBoundMessages`、原始 `argumentsJson`、assistant content、Provider payload 或 authorization
header。

## 4. Verification

- 新 live-binding targeted tests：3/3 passed（Node `v23.11.0`，显式 test-only Node-range override；没有 Provider/network）。
- E0 runner + Dose tests：18/18 passed。
- Authorized Provider source tests：15/15 passed。
- SUPERSEDED policy/probe tests：21/21 passed。
- Context-benchmarks full suite：217 passed；本地 Node 23 下其余 24 项为已有 Node 24 range gate，不能作为代码失败依据。
- `pnpm test:core` 在 Node 23 下的 context-runtime/domain 等 headless 包通过；persistence 的 68 项失败来自 Node 23 内置 SQLite 与当前 Drizzle adapter 的 `stmt.setReturnArrays` 环境不匹配，属于已知运行时限制。
- Context-benchmarks typecheck：passed。
- `git diff --check`：passed。
- 最终门禁仍需远端 Node 24 Context Runtime CI 与 independent review；本地 Node 23 结果不替代它们。

## 5. 当前阶段裁定

```text
E0 design / enrollment / Dose             CLOSED / FROZEN
Credential-free runner (#114)             PASS / FROZEN FOR REVIEW
Final live binding wiring                  IMPLEMENTED / NO_PROVIDER_EXECUTION
Natural lifecycle path                     READY_FOR_INDEPENDENT_REVIEW
Layer 2 oracle evaluator                   WIRED / POST-LEG ONLY
Provider usage + latency provenance        WIRED / fake remains unavailable
Final executionRevision                    RECORDED ABOVE / NOT RUN LIVE
runContractSha256 final rebinding          PENDING
Independent review                         REQUIRED
Owner authorization                        NO_GO
E0 live                                   NO_GO
```
