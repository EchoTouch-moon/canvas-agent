# C1 E0 Final Live Binding 验证记录

日期：2026-09-11（Asia/Shanghai）

当前状态：`CHANGES_REQUIRED_BEFORE_FINAL_FREEZE` 的 P0 修复已实现，等待 independent review。

本记录对应 PR #115 的同一分支。上一轮 review 发现 treatment opportunity 仍由 expected writable path
预种 read pair、authorized source 没有穿过完整 study runner，以及 executable revision 只覆盖三个文件。
本轮在同一 PR 中修正这三个语义 blocker，没有启动真实 Provider，也没有读取 `.env` 或创建 owner authorization。

## 1. Binding

| 项目                         | 值                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| Binding                      | `C1_EFFECTIVENESS_E0_LIVE_BINDING_V1`                                                |
| No-provider mode             | `NO_PROVIDER_EXECUTION`                                                              |
| Executable revision          | `a85de4776ebbacd515c6be3c658333f118e7a2c1`                                           |
| Execution surface hash       | `a0b6286868ece674942af32286fefeddae28879b2a68a311f8acc826f609614c`                   |
| Execution surface            | headless research source/packages + manifests + `pnpm-lock.yaml`；不含 Electron/docs |
| Enrollment manifest SHA      | `9b3d787219c93f8ba7563e5b52366245c6279a697b7e729b5426e12bfab7a6bb`                   |
| Freeze-prep run-contract SHA | `1fa1840c5869b2a3c60f891cb37b10706fc41830651f1bc56131e87753ffdfb3`                   |
| Run-contract code revision   | `PENDING_E0_EXECUTION`                                                               |
| E0 provider request SHA      | `bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a`                   |
| Study shape                  | 4 pairs / 8 legs / t1×2 / t2×2 / arm order 2:2                                       |

`executionRevision` 来自完整 headless execution surface 的最新 Git commit；`executionSurfaceHash` 对该
surface 的所有 tracked files 做内容绑定。只改变 `c1-superseded-version-policy.ts`、Runtime package 或
lockfile 都会改变 surface hash/绑定，不会被 Electron 或文档噪声掩盖。

`runContractSha256` 仍是 freeze-prep hash，最终 live binding 需要在独立 review 与 owner authorization 前
重新计算；本记录不把当前 revision 冒充成最终 run-contract code revision。

## 2. P0-1：自然 treatment opportunity

`C1E0NaturalObservationSource` 现在只允许固定的 neutral `README.md` bootstrap。E0 entrypoint 不再从
`expectedWritablePaths` 选择初始 read，也不允许调用方通过 factory 改写 bootstrap。

credential-free substitute 的 scripted model 通过与真实 Provider 相同的 tool loop 完成：

```text
fixed neutral README bootstrap
  → model response: READ P
  → real sandbox read result
  → model response: EDIT/WRITE P
  → real sandbox mutation
  → private v1/v2 probe
  → formal SUPERSEDED_VERSION policy
  → transition REMOVE
```

Runtime policy 仍只接收 model-visible messages、tool requests/results、版本 fingerprints、transition 和
carried removal evidence；task ground truth、reference fixture、expected writable paths 和 oracle 不进入
policy。Dose 从每次实际 transition 的 REMOVE source keys 派生 lifecycle IDs。

## 3. P0-2：共享 study runner 与两条路径

`runC1E0StudyInternal` 是两种 response source 共用的 8-leg scheduler/state machine：

- `runC1E0FinalLiveBindingNoProvider` 只接受 `SCRIPTED_FAKE`，strict provider preparation 使用显式内存 sentinel，
  `providerCalls=0`、`networkRequests=0`。
- `runC1E0FinalLiveBindingAuthorized` 要求显式 `AUTHORIZED` binding（study、execution revision、surface hash、
  contract、manifest、provider hash），只接受 caller 传入的 memory-only key；当前 pending contract 仅能通过
  test-only override 和 injected fetch stub 使用。

两条路径共用 natural observation、sandbox tool loop、Dose、Layer 2 oracle、checkpoint、pair adjudication 和
artifact writer。authorized 回归不访问公网，但走完整 `AUTHORIZED_PROVIDER` source kind，记录
`networkSent=true`、`fallbackSent=false` 与 `PROVIDER_REPORTED` usage。

## 4. Credential-free substitute 结果

Study `c1-e0-20260911-ddddddd4` 使用 neutral bootstrap 和 scripted model read/edit sequence：

| 指标                        |       结果 |
| --------------------------- | ---------: |
| status                      |     `PASS` |
| legs completed              |        8/8 |
| provider calls              |          0 |
| network requests            |          0 |
| fake transport permits      |         88 |
| response receipts           |         88 |
| tool executions             |         80 |
| non-zero treatment pairs    |          4 |
| non-zero distinct tasks     |          2 |
| Layer 2 oracle legs         | 8/8 `PASS` |
| Runtime treatment integrity | 4/4 `PASS` |
| finalBindingReady           |    `false` |

t2 两个 pair 各观察到 9 个实际 read/edit lifecycle pairs（18 个 source elements），t1 两个 pair 各观察到
1 个 pair（2 个 source elements）。这反映的是 scripted model 实际读取并修改的路径，不是 harness 预造的
stale-key 集合。

## 5. Authorized-kind credential-free regression

使用 injected fake `fetch` 的完整 8-leg 回归通过：

| 指标              |                                               结果 |
| ----------------- | -------------------------------------------------: |
| response source   |                              `AUTHORIZED_PROVIDER` |
| status            |                                             `PASS` |
| legs completed    |                                                8/8 |
| provider calls    |                                                 88 |
| network requests  |                              88（全部为测试 stub） |
| `networkSent`     |                                        全部 `true` |
| `fallbackSent`    |                                       全部 `false` |
| provider usage    |           8/8 legs `AVAILABLE / PROVIDER_REPORTED` |
| Layer 2 oracle    |                                         8/8 `PASS` |
| finalBindingReady | `false`（仍是 freeze-prep contract test override） |

另有 surface-drift authorization 测试：hash 不匹配时在 identity claim、provider preparation 和 fetch 前返回
`NO_GO / NOT_AUTHORIZED`，fetch 调用数为 0。

## 6. Verification

- 新 live-binding tests：6/6 passed（Node `v23.11.0`，显式 test-only Node-range override）。
- E0 runner + Dose tests：18/18 passed。
- Authorized Provider source tests：15/15 passed。
- SUPERSEDED policy/probe tests：21/21 passed。
- headless audit：passed，workspace classification `unknown=0`、core findings `0`。
- headless format、lint、typecheck、build：passed。
- 本地 Node 23 的其余历史 live/canary tests 仍受 Node 24 gate 影响；不把该环境限制归因于本轮代码。
- `git diff --check`：passed。
- PR #115 Node 24 Context Runtime CI：run `34512216303` 通过，对应包含 P0 修复的 head `0701c28cf47fe7cacdfd9a61613a8ce811a9980f`；之后仅有文档提交。

## 7. 当前阶段裁定

```text
E0 design / enrollment / Dose             CLOSED / FROZEN
Credential-free runner (#114)             PASS / FROZEN FOR REVIEW
Natural treatment opportunity              HARDENED / MODEL-GENERATED READ REQUIRED
Shared 8-leg study runner                  WIRED FOR FAKE + AUTHORIZED KINDS
Authorized provider adapter                WIRED / MEMORY-ONLY KEY / NO FALLBACK
Execution surface revision + hash          WIRED / HEADLESS / ELECTRON EXCLUDED
Final live binding                         CHANGES_REQUIRED_BEFORE_FINAL_FREEZE → P0 FIXED
Independent review                         REQUIRED
Final run-contract rebinding               PENDING
Owner authorization                        NO_GO
E0 live                                   NO_GO
```
