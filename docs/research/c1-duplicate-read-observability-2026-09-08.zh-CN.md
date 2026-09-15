# 重复读取自然出现率：V4 真实轨迹观察性分析

日期：2026-09-08。分析提交：`935d8faf` 之后的工作区状态（脚本随本报告一同提交）。
数据：`research/context-benchmarks/reports/c1-v4-20260906/study/checkpoints.jsonl`（V4 真实 Provider 证据，未改动）。
性质：离线观察性研究，**零 Provider 调用**。动机：机制 Canary 三次真实执行（V1/V2/V3 均 CANARY_STOP）
表明模型不会按提示产生重复读取；本分析回答更根本的问题——**自然任务中重复读取到底出不出现**。

## 方法与口径

- 总体：checkpoints.jsonl 中全部 `RESPONSE_RECORDED` 捕获（全程口径，含终止腿）。
- **同参数重调用**：同一 leg（runId）内相同 `(toolName, argumentHash)` 出现 ≥2 次。
  `argumentHash = sha256(argumentsJson)`，相等即参数字节相同（read 即同一路径）。
- **介入变更**：两次出现之间若夹有 edit/write（严格口径）或任何 bash（宽泛口径），
  重读可能合法（内容可能已变），不计为冗余候选。
- **bootstrap 重复**：模型 read 的参数哈希与已知 bootstrap 读取（`{"path":"README.md"}` 及序列化变体）匹配，
  即模型重读 bootstrap 已展示的文件——duplicate-read 策略在 Canary 中实际移除的情形。
- 复现：`python3 research/context-benchmarks/scripts/c1_duplicate_read_observability.py <checkpoints.jsonl>`；
  完整输出存档于 `reports/c1-v4-20260906/duplicate-read-observability-20260908.json`（ignored）。

## 结果

样本：19 腿（NATIVE 10 / RUNTIME 9；16 腿 `localized_investigation_distractors` + 3 腿 `multi_file_multi_source`），
223 次响应，279 次工具调用（read 137 / bash 103 / edit 39）。每腿读取 min 4 / 中位 6 / max 19。

| 指标 | 结果 |
| --- | --- |
| 同参数 read 重读组数 | **0**（20 个同参数重组全部为 bash） |
| 含同参数 read 重读的腿 | **0 / 19** |
| bootstrap README 重读 | **0 / 19 腿（0 / 137 次 read）** |
| 同参数 bash 重组 | 20 组分布于 17 腿，全部夹有介入 edit/write（如改后重跑测试），宽泛口径同为 True |

模型读取频繁（中位每腿 6 次），但 137 次读取没有一次以相同参数重复同一路径；
bootstrap 展示过的 README 也从未被重读。bash 同参数重跑普遍但均发生在 edit 之后，属于合法行为，
且 duplicate-read 策略本来就不针对 bash。

## 结论与边界

1. **在 V4 真实任务轨迹上，duplicate-read 策略的干预机会为 0/19 腿。**
   与机制 Canary 三次真实执行（模型总是比提示少读一次）相互印证：该模型倾向于把已可见内容视为已知。
2. 该策略的**真实触发率上限**在此样本中为 0；继续为它做真实 Provider 机制验证（Canary V4+）
   缺乏实证需求支撑，除非诊断改为 harness 构造重复（被测对象将变为 Runtime 本身而非自然触发）。
3. 不能过度推广：样本仅 19 腿、2 个任务族、单一模型（step-3.7-flash）、单一 harness 形态；
   其他模型（更大上下文窗口或不同工具习惯的模型）、更长会话、跨 Session 记忆场景中
   重复读取可能真实存在。`argumentHash` 相等也可能漏掉序列化差异的同路径重读（如 `./README.md`），
   本分析已覆盖常见变体但无法穷举；V4 元数据无读取内容，内容相等性始终不可直接核验
   （read 重读组为 0 使该限制不影响主结论）。

## 附：V4 Runtime 臂真实 transition 决策分布

对 `decision-evidence.jsonl`（199 条）与 checkpoints receipts 的同步分析：

| 指标 | NATIVE（99 调用 / 9–10 腿） | RUNTIME（100 调用 / 9 腿） |
| --- | --- | --- |
| transition 决策 | 无（NATIVE_UNMANAGED） | 100/100 有决策，**仅 KEEP/ADD** |
| REMOVE / REPLACE / REHYDRATE | — | **0 次** |
| runtimeContextChanged | — | **False ×100** |
| lifecycleEligible | — | **False ×100**（V4 为观察模式，干预按设计关闭） |
| fallbackSent | — | False ×100 |

解读：V4 的 Runtime 臂在每一次真实请求上都完成了观察与归因（KEEP/ADD 全量记录），
但生命周期干预按设计未启用，因此 **Runtime 实际发送的上下文与 Native 逐调用相同**。
这意味着 V4 中两臂的任何结果差异都不可能归因于上下文差异——它验证的是
"观察/归因/重放链路在真实任务上成立"，而非"动态 Working Set 改变了上下文"。

## 对研究路线的建议

- duplicate-read 类策略优先级应**下调**：真实触发率未观察到，机制验证三次未能形成条件。
  保留其实现与测试作为防御性正确性资产即可，不再投入真实调用预算。
- **对 64-leg 正式实验（仍 NO_GO）的重要输入**：若未来实验同样在干预不触发或
  无干预机会的配置下运行，Native vs Runtime 测量的将不是上下文管理的价值。
  授权评审前应明确：实验配置中哪些干预路径是开启的、预期触发率依据是什么；
  本观察性结果（自然重复 0/19、V4 零干预）应作为触发率假设的基线证据。
- 机制 Canary 的后续（若需要"真实请求上的干预证据"）只剩 harness 构造重复一条路
  （被测对象纯化为 Runtime 上下文管理本身），且其必要性应排在上述配置问题之后。
- 样本边界：19 腿、2 个任务族、单一模型（step-3.7-flash）、单一 harness 形态；
  其他模型/更长会话/跨 Session 场景中重复读取可能真实存在。
