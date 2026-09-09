# SUPERSEDED_VERSION 纯 evict Live Canary：冻结设计（§11.4）

日期：2026-09-08。状态：**设计冻结候选，未实现、未授权、未执行（NO_GO）**。
承接：[Lifecycle Contract](c1-superseded-version-lifecycle-contract-2026-09-08.zh-CN.md) §11 第 4 步、
[Replay 能力裁定](../verification/cspv-c1-superseded-version-replay-capability-2026-09-08.zh-CN.md)。
性质：`CONTROLLED_MECHANISM_NOT_EFFECTIVENESS`——真实 Provider 生命周期机制证明，不回答效果问题。

> **执行后状态更新（2026-09-08 夜间；上方状态行与本页其余冻结内容一律不改）**
>
> - 本设计已实现于 `012093274da742eddd8178b4448d105e6b27c4ac`，`contractSha256` 与 §1 一致
>   （`7c4577a25499ad512883c006f773bc87d538ae5528e8692da87990158b21c7e5`）；该提交远端 CI run `34240182684`
>   的 `check` 与 `macos-electron` 均 success。
> - §6 的四项授权前置在执行时均已满足，owner 于 2026-09-08 22:52 显式授权，随后**已真实执行一次**：
>   study `c1-lifecycle-20260908-d4b4f5dc`，结果 `FAIL / CANARY_STOP`、terminal/retired；1 次 Provider 调用、
>   `finalStage=EXPECT_READ_A`。durable evidence 只支持"出站请求已发出，且返回了一个 `outcome !== 'CONTINUE'`
>   的正规化响应"；报告里的 `toolResults=[]`、`changedCalls=[]`、`answerMatched=false` 都是抛错跳过赋值留下的
>   **默认值、不是观测**，该响应的 `outcome` 类型（`COMPLETE` 还是 `FAILED`）、内容与 tool-request 数**未知**。
>   §5 的 PASS 定义**未被满足**：Runtime 未产生已记录的真实移除，机制问题仍未回答。
>   §0 关于"每次工具调用都对任务必需、因而不依赖模型冗余"的假设，在本次执行中**既未被证实也未被证伪**——
>   该次执行没有留下任何可判断模型是否愿意取用工具的证据，不得叙述为"模型拒绝工具"。
> - 该次执行另暴露一个工程缺口：诊断在 `responseSource.next` 内提前抛错，驱动来不及写
>   `RESPONSE_RECEIVED`/`RESPONSE_RECORDED`（原件只剩 1 条许可、`permitsWithoutRecordedResponse=1`，
>   该次响应的 tool-request 数与 usage 结构性缺失）。已在
>   `cf0d45b47ffb1d35f1630e993675b50c53777455` 本地修复：先落盘已知响应，再抛同一个 `CANARY_STOP`；
>   裁决、failureCode、failureMessage、finalStage 与"腿不计入完成"的分类均不变，
>   §1–§5 的合同字段与 `contractSha256` 不变，历史原件不回填。
> - 身份已消耗，不恢复、不重试、不复用；本更新仅为状态同步，**不构成任何新的执行授权**。
>   完整结果、根因、验证命令与计数口径见
>   [SV1 执行与证据缺口裁定](../verification/cspv-c1-lifecycle-canary-sv1-live-execution-2026-09-08.zh-CN.md)。

## 0. 与机制 Canary V1–V3 的本质区别

**单臂 Runtime-only，无 Native 前置门。** 本步只回答"真实 Provider 上 Runtime 能否改变模型可见上下文"；
Native 前置门只会重新引入"Native 没按脚本走 → Runtime 永远跑不到"的风险（V1–V3 三连 CANARY_STOP 的教训）。
Native/Runtime 对照留给 Effectiveness A/B（§11.5）。

**不依赖模型制造冗余行为。** V1–V3 失败的根因是要求模型做"它认为冗余"的读取。本次轨迹中每一次工具调用
都对任务必需：第一次 read 是 edit 的前提（内容未知），README read 是取得未知 marker 的前提。
因此 `src/a.js` 与 README 内容**均不得预先出现在模型可见上下文**
（现有 harness 的 `C1_LIVE_BOOTSTRAP_FILES=['README.md']` 在本合同被 canary 专属覆盖）。

> **实现期修订（2026-09-08，设计意图不变）**：观察管线存在全局不变量
> `observedC1SourceKeys`——零来源观察直接拒绝（PREFLIGHT_FAILURE）。真正"空 bootstrap"必须削弱该共享
> 不变量，违反硬边界 1（不得为本诊断改全局语义）。因此 bootstrap 修正为**中性单文件 `AGENTS.md`**
> （纯合成、不含任何诊断内容），同样满足设计意图：src/a.js 与 README 对模型仍完全未知，
> 没有任何任务必需的调用可被跳过。中性文件及其内容哈希一并进入合同与 contractSha256。

## 1. 合同（`C1_LIFECYCLE_CANARY_SV1`，冻结项）

| 项目 | 冻结值 |
| --- | --- |
| Provider / 模型 | Step Plan / `step-3.7-flash`，无 fallback |
| 臂 | 单一 `RUNTIME` leg；无 Native leg |
| 身份 | fresh single-use identity，terminal 后不恢复、不重试、不复用 |
| 请求上限 | ≤4 Provider calls（30 秒/请求超时） |
| 工具上限 | ≤3 tool executions |
| 时间预算 | leg 120 秒 / 全程 120 秒 |
| 输出上限 | 沿用适配器每请求 max_tokens=16384（非用量估计） |
| Bootstrap | **中性 `AGENTS.md`**（canary 专属覆盖；见 §0 实现期修订，内容与哈希入合同） |
| 记录 | metadata-only checkpoints + 每调用 `C1_LIFECYCLE_REPLAY_RECORD`；不保存凭据、原始文件内容、read result 文本、oldText/newText |

### Fixture（纯合成，fresh）

```text
src/a.js:
export const value = 1;

README.md:
# Synthetic lifecycle diagnostic
The diagnostic marker is ORCHID-42.
This file contains no project or personal data.
```

marker 冻结为 `ORCHID-42`（与既往 COBALT-17 不冲突）。

### 固定提示

```text
This is a read-only-context lifecycle diagnostic. Do exactly these steps, one tool call at a time:
1. Read the file src/a.js.
2. Edit src/a.js to change value from 1 to 2.
3. After the edit succeeds, read README.md.
4. Reply with only the diagnostic marker from README.md.
Do not call bash or write or any other tool. Do not read or edit any other path.
```

## 2. 期望真实轨迹与观测点

```text
Call 1 → read src/a.js                      （v1 进入 Working Set）
Call 2 → edit src/a.js  → sandbox SUCCESS    （v1→v2；executor 验证内容哈希确实变化，no-op → CANARY_STOP）
Call 3 → ★ 核心观测点（发送前）
           probe OBSERVED；v1≠v2；replay adjudication = SUPERSEDED；
           REMOVE 陈旧读取对 ×2；provider-bound source keys 不含该对；
           → read README.md
Call 4 → carried removal 持续；返回 marker ORCHID-42
```

模型不按脚本走（顺序越界、工具/路径越界、跳过步骤）是**允许的信息性失败**（CANARY_STOP），
不重试、不为通过而补输入。

## 3. 工具范围与顺序门（执行前校验整个批次，不依赖模型自律）

仅允许且必须按序：

1. `read {"path":"src/a.js"}`
2. `edit {"path":"src/a.js", ...}`（oldText 必须恰好一次匹配）
3. `read {"path":"README.md"}`

顺序越界、额外路径、bash/write/其他工具、单响应多工具 → `CANARY_STOP`。
edit 执行后 executor 复核 sandbox 内容指纹确实变化，no-op → `CANARY_STOP`。

## 4. Lifecycle Gate（逐条写死，任一不满足 → CANARY_STOP/FAIL）

第 3 次请求发送**之前**：

- [ ] versionProbe = `OBSERVED`
- [ ] before/after fingerprint 均存在且**不同**
- [ ] 该调用边界的 replay record 经 `adjudicateC1LifecycleReplayRecord` 重算 = `SUPERSEDED`
- [ ] 实际 REMOVE 集合 = 陈旧读取对 ×2（call+result）
- [ ] provider-bound source keys 不包含该对；包含 edit 对与既有保留来源

第 4 次请求：

- [ ] carried removal 持续（绑定原 transition 与准确消息指纹）
- [ ] 陈旧对未恢复、未单边 rehydrate

全程：

- [ ] 每次调用持久化 `C1_LIFECYCLE_REPLAY_RECORD`（存输入不存判定）
- [ ] policy decision 与 replay capture 来自同一次 observation、同一套 collectors
- [ ] run 后 `adjudicate → reconcileC1LifecycleReplayCall` 逐调用全部 `MATCH`；
      任何 `CONTRACT_CONFLICT` 判 Canary **FAIL**
- [ ] `UNKNOWN` 出现 → 保守停止；**不得为通过而补输入**
- [ ] 账本完整：permits/responses/tool executions 全程可对账，无静默缺口

## 5. PASS 定义（刻意收窄）

> **PASS = 至少一个真实 Provider-bound request 中，SUPERSEDED_VERSION policy 基于五条件产生 REMOVE；
> 实际发送上下文确认陈旧对缺席；下一请求 carried removal 持续；fingerprint-only replay 独立重算与
> live decision 完全一致；任务按固定 marker 正常结束。**

PASS **不代表**：token 节省、任务质量提高、SUPERSEDED_VERSION 普遍有效、Runtime 优于 Native、
64-leg 可以开跑。它仅仅是 **real-provider lifecycle mechanism proof**——
项目第一条"触发证据 → decision → composition → provider-bound request 全链条可 replay"的真实干预证据。

## 6. 授权前置（全部满足才可进入授权评审）

1. 本计划与执行代码**独立提交**，工作树干净，绑定精确 executionRevision（commit SHA）与 contractSha256；
   不授权会变化的工作树。
2. 生成 fresh study identity 的 PENDING 绑定（生成不 claim identity；真实身份登记于 Git common directory，
   跨工作区共享、永不释放）。
3. **该冻结提交的远端 CI 绿**（首次引入远端背书口径）。
4. owner 对该具体 studyId / executionRevision / contractSha256 / 预算显式授权；
   授权记录与 PENDING 原件并存，原件不可变。
5. 本授权不覆盖 C1 64-leg 正式实验（仍 NO_GO）或任何其他范围。

## 7. 明确不做

Native 对照；proactive re-read / refresh 注入；STALE_OBSERVATION / RESOLVED_EVIDENCE / BUDGET_PRESSURE；
效果、成本或质量结论；为凑 PASS 放宽任何门、补任何输入、重试任何失败。
