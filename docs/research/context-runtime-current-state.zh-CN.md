# Context Runtime 当前状态索引

更新时间：2026-09-11（Asia/Shanghai）。前次更新在 `codex/qwen-sv1-response-evidence`（基于 `0120932`），
记录机制 Canary V1–V3 与生命周期 Canary SV1 的**真实执行结果**和一项本地证据闭环修复；本次增补在
`codex/sv2-harness-seeded-implementation`（PR #110，head `52abc10`），记录 SV2 harness-seeded 真实执行结果。
本次进一步在 `codex/c1-effectiveness-e0-design` 起草 E0 合同；SV1/V1–V4 历史数字与结论保留原貌，不改写既有报告。

## 当前结论

C1 V4 已真实尝试并终止。近端主线改为失败证据与干预可达性收口，不能继续使用此前“等待 V3 签署”的状态。
系统通路已有工程证据；SV2 已证明一次受控的 Runtime pure-evict 机制路径可达，但仍没有 Native-vs-Runtime
效果结论。

```text
New effectiveness calls   NO_GO
V4 study                  TERMINAL / RETIRED
Mechanism canary V1–V3    TERMINAL / CANARY_STOP ×3（真实调用 5）
Lifecycle canary SV1      TERMINAL / CANARY_STOP（真实调用 1）
Lifecycle canary SV2      PASS / CLOSED / MECHANISM_ONLY（真实调用 1）
E0 effectiveness contract DESIGN_REVISION_2 / ACCEPTED
Enrollment manifest       PASS / READY_FOR_INDEPENDENT_REVIEW
E0 run contract           PASS / READY_FOR_INDEPENDENT_REVIEW
Dose schema               PASS / READY_FOR_INDEPENDENT_REVIEW
Credential-free readiness PASS / READY_FOR_INDEPENDENT_REVIEW
E0 freeze-prep            PASS / READY_FOR_INDEPENDENT_REVIEW
E0 execution runner       IMPLEMENTED / FAKE_STATE_MACHINE_PASS / LIVE_NO_GO
E0 final live binding     CLOSED / BINDING_VERIFIED
E0 live attempt           TERMINAL / NO_GO（`9cb656f5`）
Formal research stance   ACCEPTED / F0-T0-E1
Old study resume/reuse    FORBIDDEN
Wave B / productization   NO_GO
```

当前正式研究口径见[研究立场与阶段性复盘](./context-runtime-research-stance-2026-09-11.zh-CN.md)。
它将 mechanism、execution feasibility、natural triggerability、treatment exposure 和 causal effectiveness
分开计量；当前真实 E0 仍没有可识别的 Native-vs-Runtime treatment effect。

四次 Canary 停止（V1–V3 + SV1）中**只有 V1–V3 带有可用的模型行为观测**：三次都要求模型重复读取，
观测到它比提示要求少读一次（2→1、2→1、1→0）。SV1 的响应证据因下述缺口未被持久化，其 `outcome` 类型
（`COMPLETE` 还是 `FAILED`）、`assistantContent` 与 tool-request 数**全部未知**，因此**不能**并入该模式，
也不得叙述为"模型主动拒绝工具"。V1–V3 与 SV1 的模型驱动路径没有产生**已记录的**真实移除；SV2 则由 harness
预先构造 `read v1 → edit SUCCESS → v2`，在一次真实请求前完成了可审计的纯 eviction。SV2 只回答该受控路径能否到达，
不证明任何模型的任务效果、成本收益或跨模型泛化。详见
[SV1 执行与证据缺口裁定](../verification/cspv-c1-lifecycle-canary-sv1-live-execution-2026-09-08.zh-CN.md)。

V4 study：`c1-20260906-c1-feasibility-v1-5a4b5d58`，执行 SHA：`cf4b7ea61be784a92bcefec895b2d36888b91172`。
计划 64 leg、尝试 19、完成 18、终止未完成 1、未执行 45；完成 9/32 pair（T1 8、T2 1、T3/T4 0）。
全程记录 223 response / 279 tool executions；完成子集为 199 / 246，终止 leg 为 24 / 33。
最终 oracle 缺失仍为 UNOBSERVED；本轮独立对账未执行 frozen analyzer。

100 个 Runtime response 均没有记录上下文改变或 lifecycle eligibility，只有 ADD/KEEP。
此结果和分层样本不足共同限制解释：不能声称干预有效、节省 token，或从任务成功推断 Runtime 优势。
M5 未支持效率优势；M6–M9 的机制曝光不能替代完整任务比较。

## 本轮已执行与下一步

- 已完成：26 文件哈希校验、本机持久副本、可重复的 checkpoint 对账、13 项合成回归测试，以及绑定执行 SHA 的干预路径定位。
- 已完成核心修复：响应及逐工具事件独立持久化，manifest 明确区分全程与完成子集，异常尾部保留未知。
- 已执行受控干预实验：同输入基线保留全部来源，重复读取候选在第 2、3 请求发生移除；同时修复并验证连续移除的历史沿用与指纹边界。
- 已执行（真实 Provider，共 6 次调用）：机制 Canary V1/V2/V3 与生命周期 Canary SV1 四次均获 owner 显式授权并执行，
  四次全部 `CANARY_STOP`、身份 terminal/retired。V1–V3 停在 Native 门（模型比提示要求少读一次：2→1、2→1、1→0）；
  SV1 停在冻结序列第一步（`finalStage=EXPECT_READ_A`）：durable evidence 只支持"1 次出站请求已发出、
  返回了一个 `outcome !== 'CONTINUE'` 的正规化响应"；该响应未落盘，其 `outcome` 类型、内容与 tool-request 数未知，
  **不得**读作"模型 0 次工具调用直接作答"。Runtime 臂四次均未产生**已记录的**真实移除。
- 已执行（真实 Provider，SV2 新合同）：`c1-lifecycle-sv2-20260909-ef4d90a2` 在执行提交
  `69d9dfc923b64a293aac4eae2dd510178c8f34b4` 上完成 1 个 Runtime leg 和 1 次请求；harness 先完成
  `read v1 → edit SUCCESS → v2`，replay 记录 `NOT_CANDIDATE=1 / SUPERSEDED=1`，策略移除准确的 read call/result 对，
  provider-bound source/message 中陈旧对缺席，收到并持久化 `COMPLETE` 响应（input 532 / output 56 / total 588）。
  identity 已 consumed/retired；结果只支持机制可达性，不支持任务质量、成本、token savings 或 64-leg effectiveness。
- 已裁定并本地修复（零 Provider）：SV1 暴露“响应已返回但诊断提前终止导致 `RESPONSE_RECEIVED`/`RESPONSE_RECORDED`
  未持久化”的证据缺口——`checkpoints.jsonl` 只剩 1 条许可、`permitsWithoutRecordedResponse=1`，该次响应的
  tool-request 数与 usage 结构性缺失。修复提交 `cf0d45b47ffb1d35f1630e993675b50c53777455`：先让驱动落盘已知响应，
  再抛出同一个 `CANARY_STOP`；裁决、failureCode、finalStage 与“腿不计入完成”的分类均不变，合同 SHA 不变，
  历史 live 原件不回填。定向复现先红后绿，C1 相关 9 文件 85 项回归全绿，`tsc` 干净；
  经有界审查确认为 approve-with-nits，两项文档精度问题（源码行数 +15/−2、提前终止腿上
  `answerMatched`/`changedCalls` 现按证据求值）已如实修正并补锁定测试。
- SV2 机制问题已完成一次性诊断并关闭为 `PASS / MECHANISM_ONLY`；后续若要研究任务效果，应另行评审生命周期合同
  §11.5 的 effectiveness A/B 设计（Intervention Dose 为自变量），重新定义合同、identity、execution revision 和授权。
  本次 SV2 不自动开启 64-leg；V4、SV1/V1–V3 与 SV2 身份均永不恢复、补跑或重绑定。
- 已修订 `C1 SUPERSEDED_VERSION Effectiveness E0 Contract`（Design Revision 2）：固定 4 对资格实验，标记
  `HISTORICAL_OPPORTUNITY_ENRICHED` cohort，拆分 unique lifecycle objects 与 call-exposure，规定普通 task failure
  仍执行 frozen counterpart，按 treatment integrity、task correctness、efficiency 三层记录，并使用
  `treatmentExposureRatio` 与 `suppressedStalePairCallExposures`；E0 PASS 还要求 non-zero treatment 覆盖至少
  两个 distinct task，并绑定实际 outbound request configuration 的 `providerConfigHash`。Enrollment/Run Binding、
  Dose schema 和 readiness 已在 PR #112/#113 实现并完成 Revision 3 hardening；E0 live 仍为 `NO_GO`，64-leg 仍为
  `NO_GO`。
- 独立 PR #114 已实现 `C1_EFFECTIVENESS_E0_EXECUTION_RUNNER_V1`：基于冻结 E0 binding 运行 4 pairs / 8 legs，
  A 场景两 task 均 non-zero 得到 fake state-machine `PASS`，B 场景单 task repetition 得到 `INCONCLUSIVE`，
  C 场景 experiment invalidator + SIGINT 阻断 counterpart 得到 `NO_GO`，D 场景 isolated harness failure 继续 counterpart
  并得到 `INCONCLUSIVE`；四种场景均为 scripted fake、0 Provider calls、0 network requests。runner exact revision、artifact 和授权边界记录在 [E0 runner 验收](../verification/cspv-c1-e0-execution-runner-2026-09-10.zh-CN.md)，
  E0 live 仍为 `NO_GO`。
- 独立分支 `codex/c1-effectiveness-e0-live-binding` 初版已实现 `C1_EFFECTIVENESS_E0_LIVE_BINDING_V1`：复用 #114
  scheduler/driver，加入自然 read→edit/write→version probe→REMOVE 路径、transition-derived Dose、post-leg
  objective/regression oracle、usage/latency provenance 和 metadata-only artifacts。credential-free substitute
  完成 4 pairs / 8 legs，Layer 2 oracle 8/8、treatment integrity 4/4、Provider/network 0/0；executable revision
  `2ad5a73f720ca2c94b7464611b04c71018b25e3a`。这只是历史 live wiring readiness，随后由下述 P0 hardening 更新，
  final binding 与 owner authorization 仍为 `NO_GO`，详见 [E0 final live binding 验证](../verification/cspv-c1-e0-live-binding-2026-09-11.zh-CN.md)。
- #115 review 随后发现三个 effectiveness P0：expected writable path 预种了 treatment read、authorized
  source 没有穿过完整 8-leg runner、execution revision 未覆盖完整 headless surface。修复已在同一分支完成：
  初始上下文固定为 neutral `README.md`，scripted substitute 必须先 READ 再 EDIT/WRITE；同一内部 study runner
  同时支持 `SCRIPTED_FAKE` 与 `AUTHORIZED_PROVIDER`（后者用 injected fake fetch 做完整回归）；execution revision
  同时绑定 headless `executionSurfaceHash`，覆盖 research/runtime source、相关 workspace 与 lockfile，排除
  Electron 与文档。P0 hardening executable revision 为 `a85de4776ebbacd515c6be3c658333f118e7a2c1`，surface hash 为
  `a0b6286868ece674942af32286fefeddae28879b2a68a311f8acc826f609614c`；PR #115 需重新独立 review，E0 live 与 owner authorization 继续 `NO_GO`。
- #115 的最后 binding closure（历史复核快照）已补齐：authorized path 在 identity claim、provider preparation 和 fetch 前强制
  `contract.executionBinding.codeRevision === executionRevision`；不匹配的 final-looking contract fail closed，
  `reportDir`、provider preparation 和 network request 均为 0。`finalBindingReady` 现在按实际绑定计算：no-provider/
  pending/mismatch 为 `false`，non-pending 且 contract、surface、manifest、provider 和 authorization 全匹配时为
  `true`。最终 executable revision 为 `1e759e6e82b8ecd26028df7137b656103bd62824`，surface hash 为
  `2f432c8a7f5570165dbb2b82174cdb28080161798c2ab8fc61287d6eb0c81d1a`；run-contract 已重绑定为
  `17bce0a284b37dff7b34efb8a593d063be7c3d12e6fac38f52f54ea7210b6cbe`，且 `codeRevision` 与 executable revision
  一致。授权 fake-fetch 在本地通过，Node 24 Context Runtime CI run `34552514310` 覆盖最终 head；正式
  binding-only review 仍需完成，owner authorization 与 E0 live 继续 `NO_GO`；随后状态由 #115/#116 合并和新的 E0 live run 更新。
- #116 已修复失败 leg 的通用证据投影：完整 `RESPONSE_RECORDED` rows 与 incomplete checkpoint summary 分层保存，
  `toolRequests` 与真实 `toolExecutions` 分开计数，失败时 `changedPathsStatus=UNKNOWN`。修复后的新绑定为
  `executionRevision=4aa8c06282ab4c0c0937563f550564f1f165d1cf`、`executionSurfaceHash=22f23b595ed637ccfb16ab7f30f17c5181515a80c9b89c7b40b63e7ad7834b93`、
  `runContractSha256=5c3ca28c9e4507b11bbe1944d2e01fd6fe262063d0a5618ae4d4b6ac3eb656d1`；PR #116 已合并，post-merge CI
  通过。
- 新绑定的 E0 live study `c1-e0-20260911-9cb656f5` 已获一次性 owner authorization 并执行一次：Native leg
  完成且 objective/regression oracle 通过；Runtime leg 24 次 response 后仍未终止，study 按冻结预算终止，
  其余 6 legs 阻断。该 run 为 `NO_GO`，只支持 execution-feasibility 与 zero-trigger 观察，不支持效果估计；
  原始报告与授权记录均保留在本机 ignored output 中，identity 不可复用。

[SV1 执行与证据缺口裁定](../verification/cspv-c1-lifecycle-canary-sv1-live-execution-2026-09-08.zh-CN.md) ·
[SV2 真实执行报告](../verification/cspv-c1-lifecycle-canary-sv2-live-execution-2026-09-09.zh-CN.md) ·
[E0 Effectiveness Contract](../plan/c1-superseded-version-effectiveness-e0-contract-2026-09-09.zh-CN.md) ·
[E0 Freeze Preparation](../verification/cspv-c1-e0-freeze-prep-2026-09-09.zh-CN.md) ·
[E0 Final Live Binding](../verification/cspv-c1-e0-live-binding-2026-09-11.zh-CN.md) ·
[E0 Final Live Binding 计划](../plan/c1-e0-final-live-binding-implementation-2026-09-11.zh-CN.md) ·
[后续实施验证](../verification/cspv-c1-followup-execution-2026-09-08.zh-CN.md) ·
[机制 Canary 计划](../plan/cspv-mechanism-canary-2026-09-08.zh-CN.md) ·
[本轮执行计划](../plan/cspv-c1-next-execution-2026-09-08.zh-CN.md) ·
[本轮验证报告](../verification/cspv-c1-v4-offline-followup-2026-09-08.zh-CN.md) ·
[机器对账结果](../verification/cspv-c1-v4-reconciliation-2026-09-08.json)

以下保留已有工程与合同绑定；历史 CI 结果是既有记录，本轮只核验最新 Git 基线和离线证据。

## 当前事实与绑定

| 项目                             | 当前状态                                             | 绑定或解释                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 远端 `main`                      | `cf4b7ea61be784a92bcefec895b2d36888b91172`           | 2026-09-08 fetch 核验；PR #104 已合并。本轮未核对该提交 CI                                                                                                                                                                                                                                                                                                                                                                 |
| PR #98                           | `MERGED / CI_GREEN / IMPLEMENTATION_ACCEPTED`        | implementation `55d834483ba044099e0be8d64b95028becabb014`；merge commit `583ecb74623b77dce2238f67faba1b2e046aaa9b`；实现 usage amendment 的 adapter/validator/serialization 兼容层                                                                                                                                                                                                                                         |
| PR #100                          | `MERGED / CI_GREEN / ZERO_PROVIDER_CLOSURE_ACCEPTED` | merge commit `816c13c15ef8247ec9f27c981e025283be4e366b`；补齐 usage source map、正式 treatment 入口审计和离线 adjudicator 证据闭环                                                                                                                                                                                                                                                                                         |
| PR #102                          | `MERGED / CI_GREEN / LIVE_ENTRYPOINT_ACCEPTED`       | merge commit `4d5e39a9b337d6cabdc84d450680bc54ad85561b`；实现正式 C1 live entrypoint 的授权、ground-truth-free bootstrap、scope gate 与 execution provenance                                                                                                                                                                                                                                                               |
| `C1_USAGE_CONTRACT_AMENDMENT_V1` | `FROZEN / MERGED`                                    | 只调整 provider cache split 的可用性语义；原 `C1_RUN_CONTRACT_V1` 保持不变                                                                                                                                                                                                                                                                                                                                                 |
| `C1_PROTOCOL_V1`                 | `FROZEN`                                             | 比较问题、对照/处理臂、指标与裁决边界                                                                                                                                                                                                                                                                                                                                                                                      |
| `C1_A_MANIFEST_V1`               | `FROZEN`                                             | 4 个任务层、fixture、oracle、anchors 与身份绑定                                                                                                                                                                                                                                                                                                                                                                            |
| `C1_RUN_CONTRACT_V1`             | `FROZEN`                                             | 32 matched pairs / 64 legs、AB/BA、主终点、预算与统计规则                                                                                                                                                                                                                                                                                                                                                                  |
| C1 treatment readiness           | `FROZEN / PASS`                                      | provider-bound Native fidelity、Runtime treatment 与 T4 cold/restored 证据已通过零 Provider readiness                                                                                                                                                                                                                                                                                                                      |
| C1 study orchestration           | `MERGED / ACCEPTED`                                  | 64-leg 顺序执行、隔离 sandbox、七类 metadata-only evidence、terminal/kill-switch                                                                                                                                                                                                                                                                                                                                           |
| 首次 C1 Live attempt             | `TERMINAL / NOT ADMISSIBLE`                          | study `c1-20260905-c1-feasibility-v1-35359a74`；1 次 provider/network attempt、0 个 completed leg、usage capability mismatch                                                                                                                                                                                                                                                                                               |
| 首次 study identity              | `CONSUMED / RETIRED`                                 | 永不 resume、reuse 或 rebind；不能用 #98 或后续修复继续该 identity                                                                                                                                                                                                                                                                                                                                                         |
| 机制 Canary V1–V3                | `TERMINAL / CANARY_STOP ×3`                          | study `c1-mechanism-20260908-312fad65` / `-2d05cb78` / `-4fa2ce0e`；真实调用 2+2+1；三次均停在 Native 门（模型读 1/1/0 次），Runtime 臂未执行；三个身份均 consumed/retired                                                                                                                                                                                                                                                 |
| 生命周期 Canary SV1              | `TERMINAL / CANARY_STOP`                             | study `c1-lifecycle-20260908-d4b4f5dc`；执行提交 `012093274da742eddd8178b4448d105e6b27c4ac`、合同 SHA `7c4577a25499ad512883c006f773bc87d538ae5528e8692da87990158b21c7e5`；1 次真实调用、`finalStage=EXPECT_READ_A`。`toolResults=[]`/`changedCalls=[]`/`answerMatched=false` 均为抛错跳过赋值留下的**默认值、非观测**；响应的 `outcome` 类型（`COMPLETE`/`FAILED`）、内容与 tool-request 数**未知**；身份 consumed/retired |
| 生命周期 Canary SV2              | `PASS / CLOSED / MECHANISM_ONLY`                     | study `c1-lifecycle-sv2-20260909-ef4d90a2`；执行提交 `69d9dfc923b64a293aac4eae2dd510178c8f34b4`、合同 SHA `87bd74f1caea0a80cee8c4c85da6d3768a52ef950548de630516c3e8f4abb613`；1 次 Runtime 请求、0 tool request；read v1 对被 adjudicate 为 `SUPERSEDED` 并在 provider-bound 边界缺席；身份 consumed/retired；[执行报告](../verification/cspv-c1-lifecycle-canary-sv2-live-execution-2026-09-09.zh-CN.md)                  |
| E0 Effectiveness Contract        | `DESIGN_REVISION_2 / ACCEPTED`                       | [E0 合同草案](../plan/c1-superseded-version-effectiveness-e0-contract-2026-09-09.zh-CN.md)；固定 4 matched pairs、enriched cohort、unique/exposure Dose schema、双 distinct-task qualification gate 和 providerConfigHash                                                                                                                                                                                                  |
| E0 freeze-prep implementation    | `PASS / READY_FOR_INDEPENDENT_REVIEW / NO_PROVIDER`  | [冻结准备验收](../verification/cspv-c1-e0-freeze-prep-2026-09-09.zh-CN.md)；manifest、run contract、Dose schema 和 readiness hardening 已通过远端 Node 24 CI；E0 live 仍为 `NO_GO`                                                                                                                                                                                                                                         |
| E0 execution runner              | `IMPLEMENTED / FAKE_STATE_MACHINE_PASS / LIVE_NO_GO` | [E0 runner 验收](../verification/cspv-c1-e0-execution-runner-2026-09-10.zh-CN.md)；4 pairs / 8 legs fake study、A/B/C/D qualification、终止和 isolated-failure counterpart 场景已覆盖；exact live binding 和 owner authorization 仍待独立 review                                                                                                                                                                           |
| E0 final live binding            | `CLOSED / BINDING_VERIFIED`                          | [E0 final live binding 验证](../verification/cspv-c1-e0-live-binding-2026-09-11.zh-CN.md) 与[独立技术复核](../verification/cspv-c1-e0-live-binding-independent-review-2026-09-11.zh-CN.md)；neutral bootstrap、共享 fake/authorized 8-leg runner、headless execution surface hash、`codeRevision == executionRevision` 与最终 run-contract SHA 已验证；真实 E0 结果仍需按新研究立场解释                                    |
| PR #115                          | `MERGED / CI_GREEN`                                  | merge commit `f433524610bd79fa86b6dddc5c683a585c0092ec`；PR-head CI run `34553083218` 与 post-merge CI run `34554609142` 均 success；完成 final live binding 实现与首次授权运行前置                                                                                                                                                                                                                                        |
| PR #116                          | `MERGED / CI_GREEN`                                  | merge commit `7b33e75249c8cb864cf4b41819e69ba9cd3694e5`；Node 24 post-merge CI run `34567191785` success；完成失败 leg partial checkpoint、计数和 cleanup truth hardening                                                                                                                                                                                                                                                  |
| E0 live attempt `9cb656f5`       | `TERMINAL / NO_GO / CONSUMED`                        | 新绑定一次性授权运行；2/8 legs attempted、1 Native completed、1 Runtime budget exhausted、6 blocked；37 response、78 tool executions、0 lifecycle eligibility、0 dose；不输出 treatment effect                                                                                                                                                                                                                             |
| SV1 响应证据缺口                 | `ADJUDICATED / FIXED (local)`                        | 原件仅 1×`OUTBOUND_PERMITTED`、`permitsWithoutRecordedResponse=1`、`responseStatus=NOT_RECORDED`；根因是 canary 在 `responseSource.next` 内抛错早于驱动落盘；修复 `cf0d45b47ffb1d35f1630e993675b50c53777455`；历史原件不回填，该次 usage 与 tool-request 数保持未知                                                                                                                                                        |
| PR #105                          | `OPEN / CI_GREEN / REVIEW_REQUIRED`                  | head `012093274da742eddd8178b4448d105e6b27c4ac`，base `main`；CI run `34240182684` 的 `check` 与 `macos-electron` 均 success；尚无独立 review，CI 绿不替代内容审查                                                                                                                                                                                                                                                         |
| `main` CI 基线（2026-09-09）     | `BLOCKED / UPSTREAM_ADVISORY`                        | `origin/main` 仍锁定 `js-yaml@4.3.1`，其 `pnpm audit --prod --audit-level high` 受 `GHSA-2883-xcg3-v3hh` 阻塞；修复在独立 PR #107（`js-yaml@4.3.2`），其后 CR-ARCH #109 与 SV2 #110 的 Context Runtime / Electron workflows 已分别通过。#107 合并前，不能把 `main` 的旧绿灯 run 当作当前基线；修复仍与研究证据 PR 分离                                                                                                     |
| CR-005                           | `CLOSED_AS_STOPPED_EXPERIMENT`                       | Run 1/Run 2 保留；没有把 C5/C6 伪装成补跑结果                                                                                                                                                                                                                                                                                                                                                                              |
| CSPV-B0/B1                       | `POLICY_CAPABILITY_GAP → PASS`                       | 原 oracle 先暴露缺口，B1 在不改 frozen suite 的条件下修复并通过                                                                                                                                                                                                                                                                                                                                                            |

## 冻结合同与历史授权入口

任何历史授权均不构成新执行许可。V2/V3 文件用于历史追溯；V4 的实际 terminal 状态以本页所链离线档案为据。
策略、任务、预算或执行版本改变，须新设计、新冻结和覆盖确切身份的授权。

相关冻结文件：

- [`C1 comparative effectiveness protocol`](../plan/cspv-c1-comparative-effectiveness-protocol-2026-09-01.md)
- [`C1 task / fixture manifest`](../plan/cspv-c1-task-fixture-manifest-2026-09-01.md)
- [`C1 analysis / run contract`](../plan/cspv-c1-analysis-run-contract-2026-09-01.md)
- [`C1 treatment readiness`](../verification/cspv-c1-treatment-readiness-2026-09-01.md)
- [`C1 live authorization gate`](../plan/cspv-c1-live-authorization-gate-2026-09-02.md)
- [`retired C1 live authorization record`](../plan/cspv-c1-live-authorization-record-2026-09-04.md)
- [`C1 usage contract amendment`](../plan/cspv-c1-usage-contract-amendment-2026-09-05.md)
- [`C1 Live authorization record V2 (historical / superseded)`](../plan/cspv-c1-live-authorization-record-2026-09-05-v2.md)
- [`C1 Live authorization record V3 (draft)`](../plan/cspv-c1-live-authorization-record-2026-09-06-v3.md)
- [`C0-L1 live evidence`](../verification/cspv-c0-l1-live-evidence-2026-09-01.md)
- [`CR-005 interim evidence analysis`](../verification/context-runtime-cr-005-interim-evidence-analysis.md)
- [`C1 zero-provider evidence closure`](../verification/cspv-c1-zero-provider-evidence-closure-2026-09-05.md)

## 范围与叙事边界

当前贡献是可观察、可追溯、可受控改变的上下文执行基础；策略效用仍未知。
UI、第二模型、更多策略与扩样属于候选方向，不能替代失败路径和干预输入的核心验收。
历史 CR-005、M 系列、readiness 与 V4 是不同证据层级，不混用计数或授权。
