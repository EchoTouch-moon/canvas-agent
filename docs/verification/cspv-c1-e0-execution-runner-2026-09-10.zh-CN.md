# C1 SUPERSEDED_VERSION Effectiveness E0 Execution Runner

日期：2026-09-10（Asia/Shanghai）。状态：`IMPLEMENTED / FAKE_STATE_MACHINE_VERIFIED / LIVE_NO_GO`。

本记录验收独立 PR #114 的 credential-free E0 execution runner。runner 只使用 scripted fake Provider，
穿过真实的 C1 observation、tool loop、Runtime composition、checkpoint、Dose projection、pair adjudication、
batch gate、budget guard 和 single-use identity；不读取真实凭据、不访问网络、不创建 E0 live authorization。

## 1. Exact bindings

| Binding                            | Value                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------- |
| Runner                             | `C1_EFFECTIVENESS_E0_EXECUTION_RUNNER_V1` / schema `1`                                   |
| Runner execution revision          | `c6826708d1148f0ebcb66d993f5a28661bffaf24`（最后一个包含 runner executable code 的提交） |
| Enrollment manifest SHA            | `9b3d787219c93f8ba7563e5b52366245c6279a697b7e729b5426e12bfab7a6bb`                       |
| Freeze-prep run contract SHA       | `1fa1840c5869b2a3c60f891cb37b10706fc41830651f1bc56131e87753ffdfb3`                       |
| Run contract code revision         | `PENDING_E0_EXECUTION`（仍为 freeze-prep contract，未冒充最终 live binding）             |
| Provider request configuration SHA | `bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a`                       |
| Enrollment cohort                  | `HISTORICAL_OPPORTUNITY_ENRICHED`                                                        |
| Frozen plan                        | 4 pairs / 8 legs / t1 ×2 / t2 ×2 / arm order 2:2                                         |

每条 leg 使用独立的 E0 run identity 和 fresh fixture；study 共享 `24/96/600000` per-leg 与
`192/768/4800000` study budget，未触发预算上限。fake response source 的真实 `providerCalls=0`、
`networkRequests=0`；预算中的 24 次是 fake transport permits，不是 Provider 调用。

## 2. Full state-machine scenarios

三种场景均在同一 runner revision `c6826708` 下运行，使用固定的 single-use study IDs：

| Scenario                                             |                    Legs | Fake responses / tools | Dose result                                                   | Batch result                                                        | Terminal |
| ---------------------------------------------------- | ----------------------: | ---------------------: | ------------------------------------------------------------- | ------------------------------------------------------------------- | -------- |
| `BOTH_TASKS_NON_ZERO` (`c1-e0-20260910-aaaaaaaa`)    |           8/8 completed |                24 / 16 | t1、t2 四个 pair 均 non-zero，treatment integrity `PASS`      | `PASS`，`nonZeroTreatmentPairs=4`，`nonZeroDistinctTasks=2`         | no       |
| `ONLY_T1_NON_ZERO` (`c1-e0-20260910-bbbbbbbb`)       |           8/8 completed |                24 / 16 | t1 两次 non-zero；t2 两次 `INACTIVE`                          | `INCONCLUSIVE`，`nonZeroTreatmentPairs=2`，`nonZeroDistinctTasks=1` | no       |
| `EXPERIMENT_INVALIDATOR` (`c1-e0-20260910-cccccccc`) | 1 completed / 7 blocked |                  3 / 2 | 未形成可审计 treatment dose，pair 保留 `INVALID_FOR_ENDPOINT` | `NO_GO`，invalidator 优先                                           | `SIGINT` |

在第三种场景中，第一对 Native 完成后注入 experiment invalidator 并触发 SIGINT；Runtime counterpart 和
其余 7 条 leg 均未启动，所有 pair 的 `counterpartDecision` 为
`BLOCKED_EXPERIMENT_INVALIDATOR`。这验证了终止状态不会被伪装成 dose=0 或补跑结果。

## 3. Durable evidence

每个成功或终止的 study report 目录包含以下 metadata-only artifacts：

```text
run-manifest.json
checkpoints.jsonl
checkpoint-summary.json
study-events.jsonl
response-ledger.jsonl
dose-evidence.jsonl
pair-adjudication.jsonl
batch-qualification.json
legs/<single-use-run-id>/leg-manifest.json
```

`response-ledger` 只保留稳定 join keys、response ID、usage provenance、tool name/path/hash、transition 和
provider-bound hash；`dose-evidence` 保留 unique lifecycle 与 call exposure；pair/batch artifacts 保留终止和
qualification 裁定。写入前后均检查 `providerBoundMessages`、`argumentsJson`、`assistantContent`、raw payload、
authorization header 和 raw tool result 不存在。

## 4. Verification

- E0 runner / Dose / Binding 定向测试：21/21 passed（本地 Node `v23.11.0`，仅有仓库 Node 24 engine warning）。
- A/B/C fake study：分别得到 `PASS`、`INCONCLUSIVE`、`NO_GO`，均为真实 runner 全链路输出。
- `benchmark:c1-e0-runner` 默认 A 场景：8/8 legs、24 fake permits、0 Provider calls、0 network requests。
- 本地 headless audit、format、lint、typecheck 和 `git diff --check`：passed。
- 远端 Context Runtime CI：run `34492173394` passed，Node 24；29 个测试文件、235 项测试通过，并完成非桌面 build。

## 5. Remaining gates

```text
E0 contract / manifest / Dose semantics   ACCEPTED / FROZEN-PREP
Credential-free execution runner          IMPLEMENTED / FAKE_STATE_MACHINE_PASS
Independent review                         REQUIRED
Final live executionRevision               PENDING OWNER REVIEW
Final live run-contract binding             PENDING (current SHA is freeze-prep only)
Owner authorization                        NO_GO
E0 live                                   NO_GO
E1                                       HOLD
C1 original 64-leg                       NO_GO
```

下一步只需对 runner 的 exact revision、artifact set 和终止语义做独立 review；通过后另行生成最终 live
binding 和 owner authorization。当前 fake `PASS` 不构成 Provider-bound effectiveness 结论。
