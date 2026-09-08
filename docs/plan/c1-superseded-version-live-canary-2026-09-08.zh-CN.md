# SUPERSEDED_VERSION 纯 evict Live Canary：冻结设计（§11.4）

日期：2026-09-08。状态：**设计冻结候选，未实现、未授权、未执行（NO_GO）**。
承接：[Lifecycle Contract](c1-superseded-version-lifecycle-contract-2026-09-08.zh-CN.md) §11 第 4 步、
[Replay 能力裁定](../verification/cspv-c1-superseded-version-replay-capability-2026-09-08.zh-CN.md)。
性质：`CONTROLLED_MECHANISM_NOT_EFFECTIVENESS`——真实 Provider 生命周期机制证明，不回答效果问题。

## 0. 与机制 Canary V1–V3 的本质区别

**单臂 Runtime-only，无 Native 前置门。** 本步只回答"真实 Provider 上 Runtime 能否改变模型可见上下文"；
Native 前置门只会重新引入"Native 没按脚本走 → Runtime 永远跑不到"的风险（V1–V3 三连 CANARY_STOP 的教训）。
Native/Runtime 对照留给 Effectiveness A/B（§11.5）。

**不依赖模型制造冗余行为。** V1–V3 失败的根因是要求模型做"它认为冗余"的读取。本次轨迹中每一次工具调用
都对任务必需：第一次 read 是 edit 的前提（内容未知），README read 是取得未知 marker 的前提。
因此 bootstrap 必须为空——`src/a.js` 与 README 内容**均不得预先出现在模型可见上下文**
（现有 harness 的 `C1_LIVE_BOOTSTRAP_FILES=['README.md']` 在本合同中显式置空，作为实现绑定项冻结）。

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
| Bootstrap | **空**（无 bootstrap 读取对） |
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
