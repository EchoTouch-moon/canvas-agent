# SUPERSEDED_VERSION：历史 V4 正式 Replay 能力裁定（§11 Step 3a）

日期：2026-09-08。性质：证据能力裁定（Evidence Capability Adjudication），零 Provider 调用。
裁定对象：能否用正式 `C1_SUPERSEDED_VERSION_V1` policy 对历史 V4 durable evidence 做逐调用离线 replay。

## 裁定结论

```text
Formal-policy replay against historical V4:
NOT_EXECUTABLE_FROM_DURABLE_EVIDENCE
原因：EVIDENCE_CAPABILITY_GAP
```

## 正式 policy 的输入需求 vs V4 实际持久化内容

| 五条件所需输入 | V4 durable evidence 实际情况 |
| --- | --- |
| 完整模型可见 message stream | **不持久化**。`C1JsonlLiveBindingEvidenceSink` 对每条 checkpoint 序列化后扫描，出现 `providerBoundMessages` 或 `argumentsJson` 即抛 `EVIDENCE_WRITE_FAILURE`（c1-live-binding.ts:899）——metadata-only 是**主动强制**的合同，不是遗漏 |
| read result 原始文本（v1 指纹来源） | 不存在；只有 `toolName` + `argumentHash` |
| edit/write 原始参数（oldText/newText 与路径确认） | 不存在；同上 |
| 调用边界的 versionProbe(P) 状态 | 不存在；历史执行时无此探针概念 |
| tool execution success | ✅ 有（toolEvents result） |
| read/edit 路径同一性 | 部分可推断（argumentHash 相等 ⇒ 参数相同），但仅对 read⇔read；read⇔edit 的 path 同一性无法从 hash 建立 |

结论：六个输入中四个结构性缺失，且缺失由证据合同**刻意造成**（不持久化 raw model/tool context）。
历史 V4 的 84.2% 下界是用 manifest / expectedWritablePaths / changedPaths 等 ground truth 算出的——
这些输入被冻结合同 §4 明令禁止进入正式 policy。**禁止通过注入 ground truth 补齐缺失输入做"伪 replay"**
（那会把 changedPaths 绕道重新注入 policy，破坏"ground-truth 结构性缺席"）。

## 保留什么

- [Prevalence Study](../research/c1-superseded-version-prevalence-2026-09-08.zh-CN.md) 的 ≥84.2% 保留为
  **ground-truth-assisted observational prevalence lower bound**：历史 V4 显示该生命周期现象自然高发。
- 正式 policy 的证据链独立成立：五条件合同 → 20 项定向单测 → 真实沙箱假源驱动级机制验证
  （真实 v1/v2 指纹变化 → REMOVE SUPERSEDED → carried 持续）。
- 两者的关系表述：历史轨迹证明现象存在；正式 policy 证明能在无 ground-truth 下识别并处理该现象；
  **但两者尚不能在同一历史轨迹上逐腿机械对齐**。

## 已补上的能力：fingerprint-only Lifecycle Replay Evidence

新增 `src/c1-lifecycle-replay-evidence.ts`（schemaVersion 1）：

- **存 policy 输入，不存判定**：`beforeVersionFingerprint`、mutation 结构事实、`after.probeStatus` /
  `after.versionFingerprint`、`pairShape`、`protected`、`committed`、`pairFingerprint`、`sourceKeys`。
  不保存 read result text、文件内容、oldText/newText。
- **判定可重算**：`adjudicateC1LifecycleReplayRecord` 按五条件从存储输入重新计算
  SUPERSEDED / NOT_SUPERSEDED / UNKNOWN / NOT_CANDIDATE；`reconcileC1LifecycleReplayCall`
  与执行期实际 REMOVE 集合对账，唯一失败模式为 CONTRACT_CONFLICT（UNKNOWN 是合同的保守正确性，不算错误）。
- 采集复用正式 policy 的同一组采集器（`collectReadPairs` / `collectSuccessfulMutations` / `c1PairIdCounts`），
  合格性不会随实现漂移而分叉。
- 定向测试（`tests/c1-lifecycle-replay-evidence.test.ts`，8 项）：驱动级轨迹上 replay 判定与
  执行期移除 MATCH；编辑前 NOT_CANDIDATE；全部记录序列化不含任何原文片段（7 个禁用串扫描）；
  单元级五条件正反例与 CONTRACT_CONFLICT 双向检测。

## 对 §11 的修订

Step 3 已按本裁定拆为 3a/3b，见[生命周期合同](../plan/c1-superseded-version-lifecycle-contract-2026-09-08.zh-CN.md) §11。
后续机制 canary（live，需新授权）应在执行期持久化本 replay evidence，
使第一次真实 lifecycle intervention 即具备"触发证据 → decision → composition → provider-bound request"全链条可 replay。
