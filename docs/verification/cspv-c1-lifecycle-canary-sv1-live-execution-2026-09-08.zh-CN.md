# C1 生命周期 Canary SV1 真实执行（LIVE）：CANARY_STOP 与响应证据缺口裁定

日期：2026-09-08（Asia/Shanghai）。执行提交：`012093274da742eddd8178b4448d105e6b27c4ac`（分支 `codex/c1-v4-offline-followup`，PR #105 head；远端 CI run `34240182684` 的 `check` 与 `macos-electron` 均 success）。
Study identity：`c1-lifecycle-20260908-d4b4f5dc`（已消耗、terminal、retired）。
合同：`C1_LIFECYCLE_CANARY_SV1`，SHA-256 `7c4577a25499ad512883c006f773bc87d538ae5528e8692da87990158b21c7e5`。
Provider：Step Plan / `step-3.7-flash`，无 fallback，Runtime-only 单臂。
性质：受控机制诊断（`CONTROLLED_MECHANISM_NOT_EFFECTIVENESS`）。**不是** V4 恢复、64-leg 补跑或任务效用实验。
冻结设计：[SV1 纯 evict live canary](../plan/c1-superseded-version-live-canary-2026-09-08.zh-CN.md) ·
生命周期合同：[SUPERSEDED_VERSION Lifecycle Contract §11.4](../plan/c1-superseded-version-lifecycle-contract-2026-09-08.zh-CN.md)

本页同时裁定该次执行暴露的一个工程缺陷（响应证据未持久化）及其本地修复。
本页不修改、不重算、不回填任何原始证据。

## 1. 授权链

- SV1 [冻结设计](../plan/c1-superseded-version-live-canary-2026-09-08.zh-CN.md) → `authorization.pending.json`（保留不可变）→
  owner 于 2026-09-08 22:52 在对话中显式批准（原话："CI通过了，授权给你"）→ `authorization.authorized.json`。
- 设计 §6 的四项授权前置在执行时均已满足：独立冻结提交绑定精确 `executionRevision` 与 `contractSha256`、
  fresh PENDING 身份、该提交远端 CI 绿、owner 显式授权。
- 身份已永久登记并消耗（`.git/c1-lifecycle-identities/c1-lifecycle-20260908-d4b4f5dc.json`，`consumed: true`、`resume: FORBIDDEN`），
  不恢复、不重试、不复用。代码或设计改变后不继承本授权。
- C1 64-leg 正式实验授权状态不变（仍 **NO_GO**）。

## 2. 执行结果

| 项目 | 值 |
| --- | --- |
| 状态 | FAIL / `CANARY_STOP`（terminal=true，retired=true） |
| 真实 Provider 调用 | 1（`providerCalls=1`、`networkRequests=1`、`fakeResponses=0`） |
| Leg | RUNTIME 尝试 1、完成 0、未执行 0 |
| 终止阶段 | `finalStage=EXPECT_READ_A`（冻结序列的第一步都未完成） |
| failureMessage | `CANARY_STOP: model completed before the sequence reached EXPECT_COMPLETE` |
| 工具执行 | 0（`toolResults=[]`） |
| 干预 | `changedCalls=[]`、`carriedRemovedAtFinalCall=[]` —— **Runtime 未在真实 Provider 上产生任何 REMOVE** |
| 诊断标记 | `answerMatched=false`（ORCHID-42 未匹配） |
| Replay 对账 | call 1 = `NOT_EVALUATED`（未到达第 3 次请求的 lifecycle gate） |
| Provider 报告用量 | **结构性缺失**（见 §3），不填 0、不估算 |

执行时捕获的 provider-bound 边界（call 1，`OUTBOUND_PERMITTED`）：
`contextStrategy=RUNTIME_WORKING_SET`、`sourceDerivation=PI_NATIVE_MESSAGE_ANALYSIS`、
`providerBoundSourceKeys` = 中性 bootstrap 的 tool-call/tool-result 对、
`modelVisibleSemanticContextFingerprint=232c5817429f70e4af63111ecf8b5d1217c09105456f265993fb5ae43d000602`、
`systemDeveloperToolStructuresFingerprint=a1a72146a6aa23a76be9736ada00c4ea6e84b6304057dcbe9086293cfd999f74`、
`lifecycleEligible=false`、`runtimeContextChanged=false`、`lifecycleEvidence=NOT_OBSERVED_IN_PREFLIGHT`。

### 失败原因（模型侧）

模型在第 1 次请求即返回终止型结果，没有发起 `read src/a.js`，冻结序列停在 `EXPECT_READ_A`。
设计 §0 的假设是"每次工具调用都对任务必需，因此不依赖模型冗余"；该假设在本次真实执行中**未成立**：
即使 `src/a.js` 与 README 内容都不在模型可见上下文，模型仍直接作答而未取用工具。

**工具确实已发送给模型**：本次的 `systemDeveloperToolStructuresFingerprint` 与机制 Canary V1/V2/V3 三次真实执行
逐字节相同（`a1a72146a6aa23a7…`），而那三次模型都实际调用了 `read`。因此"零工具调用"不是 harness 漏发工具结构造成的假象。
这是本项目第 4 次连续 `CANARY_STOP`（V1 要 2 读→读 1；V2 要 2 读→读 1；V3 要 1 读→读 0；SV1 要 3 次工具→0 次）。

## 3. 工程缺陷裁定：响应已返回，但证据未持久化

### 现象

本次执行的 `checkpoints.jsonl` **只有 1 条 `OUTBOUND_PERMITTED`**，没有 `RESPONSE_RECEIVED`，也没有 `RESPONSE_RECORDED`；
`callAccounting` 因此为 `normalizedResponses=0`、`permitsWithoutRecordedResponse=1`、`responseRecorded=0`、
`recordedResponseUsage` 全 0，call 行 `responseStatus=NOT_RECORDED`、`receipt=null`、`toolExecutionsNotRecorded=null`。
`completeness=ACKNOWLEDGED_EVENTS_ONLY`、`checkpointWriteFailed=false`：账本没有写盘失败，是**控制流把已收到的响应丢弃了**。

### 根因

`research/context-benchmarks/src/c1-lifecycle-canary.ts` 的 `responseSource.next` 包装在
`await source.next(...)` **返回之后、`return response` 之前**判定提前 COMPLETE 并直接 `stop()` 抛错；
而共享驱动 `c1-live-binding.ts` 只在 response source 正常返回后才写 `RESPONSE_RECEIVED`（收据）与
`RESPONSE_RECORDED`（证据行）。异常从包装内部抛出，驱动永远到不了那两个 checkpoint。

对照：机制 Canary V1–V3 的包装只记录 `answerMatched` 并原样返回响应，终止裁定在 `runLeg` 之后进行，
因此三次执行的 checkpoint 链完整（V3 为 1×`OUTBOUND_PERMITTED` + 1×`RESPONSE_RECEIVED` + 1×`RESPONSE_RECORDED`，
`permitsWithoutRecordedResponse=0`）。缺陷是 SV1 新增包装独有的。

### 影响（哪些结论因此不可用）

对本次 SV1 执行，以下事实**结构性缺失，保持未知，不得回填**：

- 该次响应的 tool-request 数量（"模型零工具调用"是从 `outcome != CONTINUE` 与 `toolResults=[]` 推断，账本无直接记录）；
- 该次响应的 provider-reported usage（因此本页不能像 V3 那样给出 token 数）；
- 该次响应的 `taskOutcome` 收据与消息计数。

这不改变本次执行的裁决（FAIL / CANARY_STOP / terminal / retired），但使该次停止**不可完整审计**，
违反冻结设计 §4"账本完整：permits/responses/tool executions 全程可对账，无静默缺口"与
后续包 B 验收第 3 条"已响应但工具执行失败……保留真实可知边界"。

## 4. 修复（本地、零 Provider）

修复提交：`cf0d45b47ffb1d35f1630e993675b50c53777455`（分支 `codex/qwen-sv1-response-evidence`，基于 `0120932`）。
范围仅 `src/c1-lifecycle-canary.ts`（+15/−2）与其定向测试；不改共享驱动、不改冻结合同、不改任何原始证据。

行为变化：

1. 包装内不再抛错，改为把违规原因记入 `deferredStop`，并**原样返回响应**，让驱动照常写
   `RESPONSE_RECEIVED` 与 `RESPONSE_RECORDED`；
2. `runLeg` 返回后、`completed.add(runId)` **之前**抛出同一个 `CANARY_STOP`。

刻意保持不变的项（防止把 PASS 写成放宽断言的产物）：

- 裁决仍为 `FAIL`，`failureCode=CANARY_STOP`，`failureMessage` 逐字不变；
- `finalStage` 取值不变：只有 `stage === 'EXPECT_COMPLETE'` 才转 `TERMINAL`，提前终止时仍停在原阶段；
- 腿**仍不计入** `completedLegs`：到达终止 outcome 不等于满足冻结序列，`legStatus` 仍为 `INCOMPLETE`、`finalOracle` 仍为 `UNOBSERVED`；
- 不伪造 `CONTINUE`、不改变模型结果、不吞掉失败、不补造 usage；
- **不新增任何请求**：终止型 outcome 本身就让驱动 `break`，第 2 次出站永不发生（测试以 `served===1` 锁定）；
- **不会在模型终止后执行工具**：LIVE 路径下 `outcome === 'COMPLETE'` 必然 `toolRequests.length === 0`
  （`src/c1-authorized-provider.ts:385-397`：只要存在 tool call，或 `finish_reason` 为 `tool_calls`/`function_call`，
  一律归一化为 `CONTINUE`；只有 `finish_reason === 'stop'` 才是 `COMPLETE`）。因此把响应交回驱动
  不会引入"模型已终止却仍执行工具"的新副作用。只有手写 FAKE 脚本才可能构造 `COMPLETE` + tool requests 的形态，
  该形态受临时 fixture sandbox（`finally` 中 `rm -rf`）与预算守卫约束，现有测试均未构造它；
  本修复不为这一 LIVE 不可达形态增加推测性防护；
- 发送前的 lifecycle gate（hard boundary #3）位置不变，仍在内层 source 之前；
- 合同序列化未触及，`contractSha256` 仍为 `7c4577a2…`（既有定向测试继续锚定）。

**一处如实披露的口径变化（审查提出）**：`answerMatched`、`changedCalls`、`carriedRemovedAtFinalCall`
在提前终止腿上此前因包装内抛错而被**整段跳过**，永远停在默认值（`false` / `[]` / `[]`）；修复后
`runLeg` 正常返回，这三个字段按已持久化的响应与证据求值，因此可能为 `true` 或非空。
这更真实（本次 SV1 live 事件三者恰好仍为 `false`/`[]`/`[]`，故该次报告的这些字段值不变），
且**不能改变裁决**：`pass` 同时要求 `failureCode === null` 与 `finalStage === 'TERMINAL'`，提前终止腿两者都不满足。
新增定向测试锁定该点：模型第 1 次调用就答出正确 marker 时，`answerMatched=true` 而状态仍
`FAIL / CANARY_STOP`、`finalStage=EXPECT_READ_A`、`completedLegs=0`——"答对"买不到 PASS。

历史 live 证据**不回填**：`c1-lifecycle-20260908-d4b4f5dc` 的 report/checkpoints 保持缺口原貌，
修复只对今后的执行生效。

## 5. 复现与回归验证

Node `v24.15.0`，pnpm 11.9.0，全部为假 Provider（`SCRIPTED_FAKE`）；本工作区无 `.env`，
脚本级运行另以 `env -u STEP_PLAN_API_KEY` 显式去除凭据。**本轮新增真实 Provider 调用 = 0，网络请求 = 0。**

### 5.1 先红：独立复现

新增定向测试 `persists the returned response before an early completion stops the diagnostic`
（SV1 live 执行的离线镜像：第 1 次调用即 COMPLETE、无 tool request、标记不匹配）。修复前：

```text
× persists the returned response before an early completion stops the diagnostic
AssertionError: expected +0 to be 1 // Object.is equality
❯ tests/c1-lifecycle-canary.test.ts:243:46
   243|       expect(accounting.normalizedResponses).toBe(1)
Tests  1 failed | 8 passed (9)
```

同一测试中 `status=FAIL`、`failureCode=CANARY_STOP`、`failureMessage`、`finalStage=EXPECT_READ_A`、
`answerMatched=false`、`completedLegs=0`、`served=1` 的断言**在修复前已通过**——证明缺陷只在证据持久化，
裁决逻辑本来就正确，修复没有放宽任何断言。

### 5.2 后绿：修复与回归

```text
pnpm exec tsc --noEmit                                    TSC_EXIT=0
pnpm exec vitest run tests/c1-lifecycle-canary.test.ts    10 passed (10)
```

C1 相关回归（9 个文件、85 项，全绿）：

```text
✓ tests/c1-superseded-version-policy.test.ts      (20 tests)
✓ tests/c1-lifecycle-replay-evidence.test.ts      ( 9 tests)
✓ tests/c1-superseded-version-probe.test.ts       ( 1 test )
✓ tests/c1-live-binding.test.ts                   ( 8 tests)
✓ tests/c1-lifecycle-canary.test.ts               (10 tests)
✓ tests/c1-carried-removals.test.ts               ( 5 tests)
✓ tests/c1-failure-accounting.test.ts             (10 tests)
✓ tests/c1-duplicate-read-policy.test.ts          (11 tests)
✓ tests/c1-mechanism-canary.test.ts               (11 tests)
Test Files  9 passed (9)      Tests  85 passed (85)
```

（上方 §5.1 红灯记录的 `8 passed (9)` 是修复前当次运行的原貌，当时该文件为 9 项；
第 10 项"提前答对 marker 仍 FAIL"是审查后补加的口径锁定测试，见 §4 披露段。）

### 5.3 边界覆盖

| 边界 | 覆盖位置 | 结果 |
| --- | --- | --- |
| 正常终止（4 调用 / 3 工具 / gate 全过） | 既有 `runs the full scripted trajectory…` | PASS，`changedCalls=[3,4]` |
| 响应后诊断失败（提前 COMPLETE） | 新增测试（本次修复） | FAIL，响应已落盘 |
| 提前终止但答案恰好匹配 marker | 新增 `still fails when an early answer happens to match…` | `answerMatched=true`，状态仍 FAIL/`CANARY_STOP`、`finalStage=EXPECT_READ_A`、`completedLegs=0`——"答对"买不到 PASS |
| 许可后无响应（source 抛错） | 新增 `keeps a permitted call with no returned response unknown…` | `permitsWithoutRecordedResponse=1`、`NOT_RECORDED`、`receipt=null`、`toolExecutionsNotRecorded=null`（缺失保持未知，不记 0） |
| 许可前失败（授权/身份门） | 既有 `rejects a wrong live authorization…` | 不 claim 身份、不读凭据、输出目录为空 |
| 发送前 gate 失败（不发第 3 请求） | 既有 `blocks the third outbound request…` | `served=2`，硬边界 #3 保持 |
| 工具越序 / no-op edit / 写盘异常 | 既有 3 项 + `c1-failure-accounting.test.ts` 10 项 | 保持原语义 |
| 禁止下一请求 | 新增（`served===1`）+ 既有 24-call 测试 | 通过 |
| terminal 身份拒绝复用 | 既有 `…retires its identity` / 同输出根二次运行 rejects | 通过 |

### 5.4 持久化证据回读对账

修复后经**已发布入口**跑一次假源 canary（`scripts/c1-lifecycle-canary.ts --fake`，studyId
`c1-lifecycle-20260908-ff000002`，FAKE 模式不写身份注册表），回读 metadata-only 证据：

```text
{"status":"PASS","studyId":"c1-lifecycle-20260908-ff000002","providerCalls":0,"fakeResponses":4,
 "failureCode":null,"finalStage":"TERMINAL","changedCalls":[3,4]}

accounting: outboundPermits 4 | normalizedResponses 4 | permitsWithoutRecordedResponse 0
            responseRecorded 4 | toolRequests 3 | recordedToolExecutions 3
usage:      inputTokens 40 | outputTokens 8 | totalTokens 48
completeness: ACKNOWLEDGED_EVENTS_ONLY | checkpointWriteFailed: False
per-call:   (1..4, COMPLETED, NORMALIZED_RESPONSE_RECEIVED, responseRecorded=True, notRecorded=0)
checkpoints: 4×[OUTBOUND_PERMITTED, RESPONSE_RECEIVED, TOOL_EXECUTION_RECORDED, RESPONSE_RECORDED]
             （第 4 次无工具，故为 15 条）
replay:     lifecycle-replay.jsonl 7 条（仅指纹，无内容、无判定）
```

许可与响应逐调用可对账，无静默缺口。

### 5.5 原件不可变核验

本次工作前后对 live 原件重算 SHA-256，三个文件全部一致（未读改、未重生成）：

```text
1fbc538f0817e18bbc1e998ed6001217209a419e2c4e313ddad45b0c468e238e  binding.json
f8a2616c25a14523ddd17d8ff577774ac5430924fb81996fa9d91314034edc09  checkpoints.jsonl
e2b8725a3cc05b0636f8392bba9070f92f59bd7b009d69a4eb03552937950160  report.json
```

## 6. 计数口径

全程=已确认 checkpoint：1 许可 / 0 已记录响应（**缺口，非 0 响应**）/ 0 工具执行。
已完成 leg：0。未完成 leg：1（RUNTIME，`legStatus=INCOMPLETE`、`finalOracle=UNOBSERVED`）。未执行 leg：0。
真实 Provider 调用：1（本次 live，已计入历史总真实调用 6 次 = V1–V3 的 5 次 + SV1 的 1 次）。
本轮修复与验证新增真实调用：**0**。

## 7. 结论边界

可以说：

- SV1 在真实 Provider 上完成了一次全链路（授权→身份→出站许可→停止→terminal/retired）执行，结果为 FAIL/CANARY_STOP；
- 缺陷根因、影响范围与修复已在本地用假 Provider 独立复现并验证；
- 工具结构确已发送，"模型未按冻结序列取用工具"是模型侧观察，不是 harness 漏发。

**不能说**：

- SUPERSEDED_VERSION 策略在真实 Provider 上有效或无效——Runtime 臂从未产生真实移除，机制问题仍未回答；
- 任何 token 节省、任务质量、成本或 Runtime 优于 Native 的结论；
- SV1 该次响应的 usage 或 tool-request 数（结构性缺失，保持未知）；
- 64-leg 可以开跑（仍 NO_GO）；
- "该模型永远不会调用工具"——4 次停止只支持"在这些诊断形态下模型持续少做甚至不做被要求的读取"，需重新审视诊断设计。

## 8. 后续（需 owner 决策，本轮不自动执行）

1. **SV2 诊断设计**：4 次停止的共同点是"把机制证明挂在模型自愿行为上"。候选方向是让触发条件完全由 harness
   构造（例如 bootstrap 直接携带一对已在沙箱中被改写的读取，使第 1 次真实请求就存在可移除的陈旧对），
   被测对象纯化为"Runtime 在真实请求上的上下文管理"。需新冻结设计、新合同 SHA、新身份、新授权。
2. **或接受机制层负结果**，转入生命周期合同 §11.5 的 effectiveness A/B 设计（以 Intervention Dose 为自变量、
   只在预选存在机会的 task 上配对）。在此之前 64-leg 维持 NO_GO。
3. 无论哪项：本修复不继承任何旧授权；SV1/V1–V3/V4 的 terminal 身份一律不恢复、不重试、不复用。

## 9. 证据位置

- Live 原件（ignored，不可变）：`research/context-benchmarks/reports/lifecycle-canary-live-20260908/c1-lifecycle-20260908-d4b4f5dc/`
- 授权历史（ignored）：`research/context-benchmarks/reports/lifecycle-canary-preparation-20260908/`
  （`authorization.pending.json` 与 `authorization.authorized.json` 并存，原件不可变）
- 身份注册表：`.git/c1-lifecycle-identities/c1-lifecycle-20260908-d4b4f5dc.json`（Git common directory，跨工作区共享）
- 修复后假源回读（ignored）：`research/context-benchmarks/reports/qwen-sv1-readback-20260908/`
- 定向测试：`research/context-benchmarks/tests/c1-lifecycle-canary.test.ts`
