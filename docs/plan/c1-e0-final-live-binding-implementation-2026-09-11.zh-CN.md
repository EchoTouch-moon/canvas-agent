# C1 E0 Final Live Binding 实施计划

日期：2026-09-11（Asia/Shanghai）

## 目标

在独立于 #114 的分支中，把已经冻结并通过 credential-free runner 验证的 E0 调度器和
`C1LiveBindingDriver` 接到一层共享的 live binding study runner。此阶段只证明 wiring 和证据边界可执行，
不读取真实 credential、不访问 Provider、不创建 owner authorization，也不改写 E0 enrollment、pair order、
threshold 或 provider request configuration。

## 固定边界

- 代码、测试和文档从 #114 最新 head `9fdef03` 分支出发；#114 的 runner hardening 不再追加。
- E0 request hash 继续使用
  `bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a`。
- Run Contract 继续保留 `codeRevision=PENDING_E0_EXECUTION` 和 freeze-prep
  `runContractSha256=1fa1840c5869b2a3c60f891cb37b10706fc41830651f1bc56131e87753ffdfb3`；本 PR 不生成最终
  immutable authorization binding。
- strict Provider profile hash 与 E0 request hash 分开：profile 只用于内存中的 executor preparation，E0
  hash 写入 provider-bound capture 和 evidence。
- no-provider entrypoint 只接受显式注入的 scripted substitute；不能从 `process.env` 或 `.env` 取得 key。
  authorized source 工厂只接受调用方显式传入的 memory-only key，测试用 fetch stub，不产生真实网络请求。
- E0 的初始上下文固定为 neutral `README.md`；model 必须通过真实 tool loop 自己产生 READ，再产生 EDIT/WRITE，
  才能形成 lifecycle opportunity。

## 实施内容

1. `c1-e0-live-binding.ts` 复用 `buildC1E0ExecutionPlans`、`C1LiveBindingDriver`、sandbox tool executor、
   checkpoint sink 和 E0 dose/readiness adjudicator；`runC1E0StudyInternal` 同时服务 scripted 与 authorized kind。
2. `C1E0NaturalObservationSource` 从固定 neutral bootstrap 开始，等待 model tool-loop 产生 read/tool-result；每次成功 edit/write 后以私有
   content fingerprint probe 运行 `SUPERSEDED_VERSION` policy，policy 只接收六键 runtime allowlist，不能看
   task ground truth 或 oracle。
3. `projectC1E0LiveDose` 从当前 leg 的真实 transition `REMOVE` source keys 和 carried removal evidence
   派生 lifecycle pair IDs；不在 runner 启动前预造 stale-key 集合。
4. 每个 fresh fixture leg 完成后调用冻结的 objective/regression oracle；结果只进入 Layer 2 report，不进入
   Runtime policy。usage、response receipt、cache metric 和 latency 遵守 UNKNOWN/UNAVAILABLE 规则。
5. metadata-only artifacts 写入独立 single-use study 目录；raw provider messages、tool arguments、response
   content、authorization header 永不落盘。
6. `C1AuthorizedProviderResponseSource` 增加可选 outer request hash override，使 E0 authorized adapter 能
   保留 strict profile binding，同时验证 E0 request hash；authorized wrapper 只有在完整 authorization binding
   通过后才会 claim identity 或调用 source。
7. execution revision 从三个文件扩大为完整 headless execution surface，并额外记录内容级
   `executionSurfaceHash`；Electron、文档和无关产品依赖不进入该 hash。

## 验证矩阵

- 8 legs / 4 pairs / t1×2 / t2×2，2:2 arm order，所有 leg 使用 fresh fixture 和独立 run identity。
- scripted substitute 的 full study：neutral bootstrap、model-generated READ/EDIT、自然 lifecycle、REMOVE dose、
  Layer 2 两层 oracle、checkpoint join、batch qualification PASS，且 `providerCalls=0`、`networkRequests=0`。
- authorized-kind injected fake fetch 的 full study：同一 8-leg runner、`networkSent=true`、
  `PROVIDER_REPORTED` usage、无公网请求。
- t2 两个 bootstrap read pairs 验证 multi-lifecycle source-key cardinality；t1 验证单 pair。
- authorized adapter 使用 in-memory key 和 fetch stub，检查 E0 request hash、Provider usage 解析和不读取环境。
- metadata artifact 禁止 raw content/arguments；scripted usage 与 latency 保持不可用于效率结论。
- Node 23 本地仅作为实现检查；最终环境验证以仓库要求的 Node 24 CI 为准。

## 收口条件

- 本地 targeted tests、headless typecheck/lint/format 与 diff 检查通过。
- 远端 Context Runtime CI 在 Node 24 通过。
- 新 PR 保持 Draft，标记为 `documentation`、`enhancement`、`area:context-runtime`，并在 verification
  记录中明确 P0 hardening 状态、`finalBindingReady=false`、`Owner authorization=NO_GO`。
