# F1-32 授权 Provider 执行入口实施计划

日期：2026-09-15（Asia/Shanghai）

## 目标

在不改变已冻结 F1-32 研究语义的前提下，实现可受 owner authorization 门控的真实 Provider 执行入口；先用假 Provider 完成全链路验证，再重新绑定变更后的执行面。当前阶段不创建 study identity、不读取真实凭据、不发出 Provider/network 请求。

## 当前证据

- #140 已合并到 `main`，post-merge Context Runtime CI `34923842658` 为 success。
- 现有 `runC1F1Native32CredentialFreeStudy()` 在 `NODE_ENV !== test` 时拒绝，并注入 sentinel credential；它只能验证 credential-free 运行链。
- 通用 `runC1LiveStudy()` 使用旧 C1 study orchestrator 与 24-call 限额，不能直接执行冻结的 F1-32 32-call contract。
- F1-32 final-bound artifact：`research/context-benchmarks/c1/f1/bindings/c1-f1-native-feasibility-32-final-bound.json`；freeze candidate hash 保持 `053fa42d540e3955b8228303036191ffd985292ddd9665d87397b232570885da`。
- 当前唯一 F1 study identity 仍未创建；owner authorization 与 Provider execution 均为 NO_GO。
- 已有 `c1-f0-v2-live-binding.ts` 提供 strict provider source、authorization preflight、预算、证据写入模式；它受 24-call F0 合同约束，不能直接充当 F1 执行入口。F1 需要复用相同 provider/source 和 evidence primitives，同时继续由 F1 32-call driver执行。

## 冻结不变量

- Task/prompt/fixture/oracle、Provider/model/config、32-run schedule、预算、gates、evidence/firewall/recovery semantics 均保持不变。
- 每 run: 32 Provider / 96 tool / 600,000 ms；study: 1,024 Provider / 3,072 tool / 19,200,000 ms；并发 1；fallback/retry/resume 禁止。
- Provider key 只能作为内存输入传递；本实现与测试不读取 `.env`。CLI 仅在 exact owner authorization、contract/surface/budget 校验及 identity 未 claim 检查之后，才从进程环境或指定 `.env` 路径读取 key；假 Provider 测试必须断言网络请求为 0。
- Owner authorization 必须在 credential access、study identity claim 和任何 Provider request 之前验证，并精确绑定新的 final-bound contract、execution revision、surface hashes、provider config 与预算。
- 真实执行只接受内存 credential reader；代码不解析 `.env`。Node test 环境必须显式注入 fake fetch；生产入口拒绝注入 transport，默认真实 fetch 仍需单独 owner authorization。
- Runtime intervention 保持 `DISABLED`；这仍是 Native-only F1，不测 Runtime treatment。

## 工作项

- [x] 追踪 F1 credential-free runner、C1 leg executor、authorized response source 和 identity claim 的现有接口。
- [x] 确认 live entrypoint 必须在 F1 runner surface 中执行，不能重用 F0 的 24-call study wrapper。
- [ ] 实现最小 F1-32 authorized execution entrypoint；先验证合同/授权/实际 binding，再 claim identity，再访问内存 credential。
- [ ] 加入假 Provider end-to-end 回归：完整 32 runs；验证 32/1,024 上限、无 fallback、授权失败早于 key access/claim/fetch、预算超限 latch、evidence 和 terminal handling。
- [ ] 现场重算 execution/control inventories、checkout revision 与 final-bound contract hash；freeze-candidate hash 必须不变。
- [ ] Node 24 运行针对性测试和 `pnpm check:core`；核对远端 CI。
- [ ] 生成新的 binding artifact/report 并提交带标签 PR，等待独立 binding review。
- [ ] 只有新 binding review 后再创建 fresh identity；owner authorization 与 live Provider execution 仍需单独门禁。

## 当前状态

`IMPLEMENTATION IN PROGRESS / ZERO PROVIDER / NO_IDENTITY / NO_OWNER_AUTHORIZATION`
