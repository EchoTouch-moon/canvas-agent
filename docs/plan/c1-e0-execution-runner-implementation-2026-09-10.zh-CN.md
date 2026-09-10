# C1 E0 Execution Runner 实施计划

日期：2026-09-10（Asia/Shanghai）

## Goal

把已通过 freeze-prep 的 E0 语义实现为一个只使用 scripted fake Provider 的完整 study state machine：加载冻结 enrollment/run contract，按 4 pairs / 8 legs / 2:2 arm order 顺序执行 Native 与 Runtime，落盘 response ledger、checkpoint、Dose evidence、pair adjudication 和 batch qualification，并验证单次 study identity、预算、kill switch、counterpart 规则和 metadata-only 证据边界。

本阶段只证明执行链路可完整运行，不创建真实 Provider authorization，不读取真实凭据，不把 fake usage 或 fake task outcome 写成 effectiveness 结论。

## Completion criteria

- [ ] E0 enrollment manifest、run contract、task fixture hashes 和 providerConfigHash 在 runner 启动时重算并 fail closed。
- [ ] A：t1/t2 两个 task 的四个 pair 都产生 Runtime non-zero dose，batch gate 为 `PASS`。
- [ ] B：只有 t1 两个 repetition 产生 non-zero dose，batch gate 为 `INCONCLUSIVE`。
- [ ] C：experiment invalidator 触发 operator kill switch，counterpart 被阻断，batch gate 为 `NO_GO`。
- [ ] 每个 leg 使用 fresh fixture、fresh leg identity，共享 study budget guard 和 durable checkpoint sink。
- [ ] 证据仅保存稳定 join keys、usage provenance、tool metadata、transition/dose metadata；禁止 raw provider/tool payload。
- [ ] 远端 Node 24 Context Runtime CI 通过；最终 runner execution revision 只记录在 runner report，不改写 freeze-prep run contract 的 `PENDING_E0_EXECUTION`。

## Decisions

- 新增独立 `c1-e0-execution-runner.ts` 和独立 PR；不把执行代码堆入 #111/#112/#113。
- 复用既有 `C1LiveBindingDriver`、`C1LegExecutor`、`C1SandboxToolExecutor`、`C1HardBudgetGuard` 和 durable checkpoint sink；E0 runner 只负责 E0-specific scheduling、dose projection、pair/batch adjudication 和 artifact set。
- fake provider 使用显式 sentinel 环境值和 scripted responses；底层 strict provider profile hash 与 E0 run-contract request configuration hash 分开记录，避免把 fake preparation profile 冒充实际 request config。
- `codeRevision` 在现有 E0 run contract 中保持 `PENDING_E0_EXECUTION`；runner report 捕获当前 Git revision，后续独立 review 决定是否生成最终 live binding。

## Authorization boundary

E0 live execution remains `NO_GO`. 本计划不会调用 `C1AuthorizedProviderResponseSource`、不会访问网络、不会使用 `.env` 中的真实 credential、不会创建真实 Provider study identity。fake study 的 `PASS` 仅表示 state machine qualification pass。

## Evidence

最终验证记录写入 `docs/verification/cspv-c1-e0-execution-runner-2026-09-10.zh-CN.md`，并在 PR 描述中绑定 exact runner head、CI run、fake study scenario 结果和未解决授权门。
