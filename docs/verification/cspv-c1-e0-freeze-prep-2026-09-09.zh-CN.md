# C1 SUPERSEDED_VERSION Effectiveness E0 Freeze Preparation

日期：2026-09-09（Asia/Shanghai）。状态：`IMPLEMENTED / REVISIONS_APPLIED / RE_REVIEW_PENDING / EXECUTION_NO_GO`。

本记录验收 E0 的四项 freeze-prep 实现：Enrollment Manifest、study-level Run Contract、
`C1_EFFECTIVENESS_DOSE_V1` schema 和 credential-free readiness matrix。本记录没有 Provider 调用，
也不构成 E0 live authorization。

## 1. Binding artifacts

| Artifact            | ID / version                                 | Path                                                                                 | Binding digest                                                                       |
| ------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Enrollment Manifest | `C1_EFFECTIVENESS_E0_ENROLLMENT_V1`          | `research/context-benchmarks/c1/e0/manifests/c1-effectiveness-e0-enrollment-v1.json` | `manifestSha256=9b3d787219c93f8ba7563e5b52366245c6279a697b7e729b5426e12bfab7a6bb`    |
| Candidate pool      | `C1_E0_HISTORICAL_SUPERSEDED_OPPORTUNITY_V1` | 同上                                                                                 | `candidatePoolHash=d3a9c0965b2a11817c8eba88efc67c6a178e1e6736aac1d2e96b857b4ad827dc` |
| Run Contract        | `C1_EFFECTIVENESS_E0_RUN_V1`                 | `research/context-benchmarks/c1/e0/contracts/c1-effectiveness-e0-run-v1.json`        | `runContractSha256=1fa1840c5869b2a3c60f891cb37b10706fc41830651f1bc56131e87753ffdfb3` |
| Dose schema         | `C1_EFFECTIVENESS_DOSE_V1`                   | `research/context-benchmarks/src/c1-e0-dose.ts`                                      | `schemaVersion=1`                                                                    |
| Readiness           | `C1_EFFECTIVENESS_E0_READINESS_V1`           | `research/context-benchmarks/src/c1-e0-readiness.ts`                                 | provider-free matrix                                                                 |

Enrollment 明确标记 `enrollmentCohort=HISTORICAL_OPPORTUNITY_ENRICHED`。当前候选池只有两个有历史机会依据的
任务：t1 使用精确下界证据，t2 使用多文件腿级上界证据。确定性选择结果为
`[c1-t2-multi-file-migration-v1, c1-t1-localized-distractor-v1]`；固定四个 pair 时显式重复两次，
没有把 t3/t4 的未观测机会写成事实。

Run Contract 固定 4 pairs / 8 legs、`maxConcurrency=1`、2:2 arm-order quota、无 adaptive sampling、
`QUALIFICATION_NOT_CONFIRMATORY`、Step Plan `step-3.7-flash`、无 fallback、memory-only credential、
`providerConfigHash=bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a`、
以及 `nonZeroTreatmentPairs>=2` 且 `nonZeroDistinctTasks>=2` 的 qualification gate；另含
24/96/600000 per-leg budget、192/768/4800000 study budget，以及 `NO_PROVIDER` 前置状态。

## 2. Dose and provider-bound semantics

`C1_EFFECTIVENESS_DOSE_V1` 将以下两组字段分开：

```text
unique lifecycle objects:
  uniqueEligiblePairs / uniqueSelectedPairs / uniqueRemovedPairs
  uniqueRemovedSourceElements

call exposure / persistence:
  newRemovalPairCalls / carriedRemovalPairCalls
  suppressedStalePairCallExposures / suppressedSourceElementCallExposures
```

schema 硬不变量包括：

```text
uniqueRemovedPairs <= uniqueSelectedPairs <= uniqueEligiblePairs
uniqueRemovedSourceElements = 2 × uniqueRemovedPairs（pure-evict）
```

carried removal 必须有此前的 new removal；同一 composition 中每个 stale pair 最多计一次 suppression。
`runtimeContextChanged` 必须等于同一 composition 的
`prePolicyProviderBoundMessagesHash != postPolicyProviderBoundMessagesHash`，不比较已经分叉的
Native/Runtime trajectory ordinal。

`C1ProviderBoundCapture` 与 live evidence receipt 已增加 optional pre/post hash；旧 C1/SV2 调用在不提供时保持
兼容，E0 runner 后续必须提供并绑定这些字段。

## 3. Credential-free readiness evidence

`tests/c1-e0-dose.test.ts` 的 16 项测试覆盖：

| 场景                                             | 期望                                                          |
| ------------------------------------------------ | ------------------------------------------------------------- |
| eligible + REMOVE                                | non-zero unique dose、pre/post hash changed、可通过 integrity |
| carried removal across calls                     | unique pair 保持 1，new=1，carried/exposure 持续增长          |
| no eligible / UNKNOWN / no-op                    | dose=0 或 UNKNOWN，不删除，保留 ITT                           |
| protected evidence / atomicity / replay conflict | integrity hard fail                                           |
| ground-truth injected input                      | recursive leakage guard hard fail                             |
| Native 或 Runtime task failure                   | counterpart 继续执行                                          |
| experiment invalidator                           | counterpart 被阻断并记录 invalidation                         |
| response gap                                     | UNKNOWN，不补零                                               |
| claimed REMOVE but equal pre/post hash           | treatment integrity fail                                      |
| zero dose + hard invalidator                     | FAIL 优先于 INACTIVE（5 类交叉场景）                         |
| unknown top-level Runtime source                 | allowlist fail closed；递归 forbidden-key guard 仍保留       |
| response observed + usage unavailable            | OBSERVED / UNAVAILABLE，不以零替代                           |
| two non-zero pairs on one task                   | INCONCLUSIVE；必须覆盖两个 distinct task                     |

## 4. Verification

- Node `v24.15.0`、pnpm `11.9.0`。
- `pnpm --filter @canvas-agent/context-benchmarks typecheck`：passed。
- `pnpm --filter @canvas-agent/context-benchmarks test`：28 个测试文件、226 项通过。
- Dose/Binding 定向测试：12/12 passed。
- 本轮 Revision 3 定向测试：16/16 passed；新增 allowlist、hard-failure precedence、usage split 和双任务 gate。
- 本轮 typecheck、`benchmark:c1-e0-binding`、Prettier check 均 passed；本地 Node `v23.11.0` 因仓库要求 `>=24` 仅发出 engine warning，未作为 Node 24 证据。
- `pnpm check:core`：audit、format、lint、typecheck、非桌面 tests/build 的新增路径均通过。
- 远端 Context Runtime CI：run `34325494016` passed。
- PR A Enrollment/Run Binding：run `34325818925` passed。
- Revision 3 PR #113 headless CI：run `34329669313` passed（Node 24）。
- Typed policy-boundary follow-up headless CI：run `34330408833` passed（Node 24）。
- `git diff --check` 与相对 markdown link scan：passed。

本地曾有一次未修改的 `worker-runtime/tests/local-cli-runner.test.ts` 进程组取消场景超时；单独重跑 14/14
通过，远端 CI 未复现。该既有波动不改变 E0 binding 或 readiness 结果。

## 5. Remaining gates

当前只完成 freeze preparation：

```text
Enrollment Manifest       IMPLEMENTED / READY_FOR_REVIEW
Run Contract              IMPLEMENTED / READY_FOR_REVIEW (providerConfigHash + distinct-task gate)
Dose schema               IMPLEMENTED / READY_FOR_REVIEW
Credential-free readiness IMPLEMENTED / PASS (Revision 3 hardening)
E0 live                   NO_GO
E1                        HOLD
C1 original 64-leg        NO_GO
```

E0 live 前仍需把 `codeRevision` 从 `PENDING_E0_EXECUTION` 替换为经过 review 的 exact clean revision，
冻结最终 artifact hashes（包括 `providerConfigHash`）、owner authorization 和 single-use study identity。任何 E0 PASS 只产生进入 E1
review 的资格，不自动恢复 64-leg 或产生因果 effectiveness 结论。
