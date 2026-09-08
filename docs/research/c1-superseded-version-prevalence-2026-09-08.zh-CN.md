# SUPERSEDED_VERSION 干预机会：V4 真实轨迹 Prevalence Study

日期：2026-09-08（同日按评审意见修订统计口径与措辞边界）。
数据：V4 真实 Provider 证据（未改动）+ 冻结任务 manifest `c1-effectiveness-v1.json`。
性质：离线观察性研究，**零 Provider 调用**。承接
[duplicate-read 观察报告](c1-duplicate-read-observability-2026-09-08.zh-CN.md)（出现率 0/19）。
复现：`python3 research/context-benchmarks/scripts/c1_superseded_version_prevalence.py <checkpoints.jsonl> <manifest> <repo_root>`；
完整输出存档于 `reports/c1-v4-20260906/superseded-version-prevalence-20260908.json`（ignored）。

## 语义定义（冻结）

**SUPERSEDED_VERSION**：模型读取文件 P（版本 v1 进入 Working Set）后，P 被 edit 修改（→v2），
而 v1 的读取证据仍留在模型可见上下文中——它不再描述当前文件状态。
判定：read(P)@call i，其后 call j>i 出现 edit，且 P ∈ 该 leg 实际 `changedPaths`（sandbox 差异核定）。
Refresh：call k>j 重读 P（旧证据被新证据接替；旧副本仍留在上下文中）。

## 结果

样本：19 腿（NATIVE 10 / RUNTIME 9），223 响应，137 read / 103 bash / 39 edit。

### 出现率（区分精确证据与上界估计）

| 口径 | 值 |
| --- | --- |
| **精确下界**（单文件任务 t1，edit→file 可精确归因） | **≥16 / 19 腿（84.2%）** |
| 含多文件腿级上界归因（t2） | 17 / 19 腿（89.5%） |

### Intervention Dose 四个指标（严格区分）

| 指标 | 值 | 说明 |
| --- | --- | --- |
| staleEvents | 26 | 陈旧读取证据事件 |
| staleElementCallExposures | 169 | 元素×调用暴露量（**不是**唯一调用数） |
| uniqueCallsWithStaleEvidence | 66 / 223（29.6%） | 至少携带 1 个陈旧元素的调用 |
| maxConcurrentStaleElements | 10 | 单一调用同时背负的陈旧元素峰值（t2 RUNTIME 腿） |

改后刷新重读：**仅 1 次**——模型改完几乎从不重读（与 duplicate-read 结论互证）。
陈旧源内容规模代理：21,252 fixture bytes（≈5.3K token-equivalent 粗估，bytes/4）。
**注意**：这是 stale source-byte proxy，不是 Actual Intervention Dose；
真实 Dose（removedElements / removedTokens / tokenRatio / tokensBefore/After composition）
只能在组合时测量，属下一阶段指标落地。

典型形态：

- **t1（单文件修复，16 腿，精确归因）**：read `paginator.js` → edit → 旧读取证据残留至 leg 结束。
- **t2（多文件迁移，RUNTIME 腿，腿级上界）**：call 4 批量读取 9 个文件 → call 9 起连续 11 次 edit →
  在上界归因下最多 10 份读取证据进入 stale 区间、最长持续约 12 次调用（9.4KB 代理），
  其中 12 个调用各同时背负 10 个陈旧元素——**单请求级 context pressure** 的直观样本。

## 结论与边界

1. **SUPERSEDED_VERSION 是该 workload 中自然高发的生命周期事件**（精确下界 84.2%），
   与 duplicate-read（0/19）形成鲜明对比。它满足"语义成立 → 自然出现率高"前置条件，
   是目前唯一有实证触发率支撑的干预候选。
2. 与 duplicate-read 的语义差异值得注意：后者要求模型"犯错式"重读；本事件由正常 workflow
   （读→改→继续验证）自然产生，**不依赖任何模型冗余行为**。
3. 措辞边界：陈旧证据**形成了与当前仓库状态不一致的陈旧表示，存在误导后续推理的风险**
   （version-inconsistent / potentially misleading）。模型同时看到了 edit 请求与结果，
   可能自行维护 v1+Δ 的心智模型；**是否真的被误导是 effectiveness 问题，本研究不作此断言**。
4. 边界与近似：
   - t2 的 edit→file 为腿级上界归因（首个后续 edit 记为 stale 起点，具体文件的变陈旧时点可能更晚，
     其 persistence 与并发数均为上界）；t1 单文件任务为精确归因。
   - 24 / 137 次 read 未归因（路径清单外或序列化变体）；token 为粗估代理；
     会话长度有限（8–20 调用），更长会话中残留预计更久。
   - 本研究度量**机会**，不证明移除一定改善结果。

## 证据梯度

| 结论 | 强度 |
| --- | --- |
| duplicate-read 自然机会 | 0 / 19 |
| SUPERSEDED_VERSION 精确下界 | **≥16 / 19（84.2%）** |
| 含多文件上界 | 17 / 19（89.5%） |
| stale events | 26 |
| stale element-call exposure | 169 |
| unique calls with stale | 66 / 223（29.6%） |
| refresh | 1 |
| stale source-byte proxy | ~21KB |

选择 SUPERSEDED_VERSION 的三层依据：语义客观失效（读到的版本被修改）→ 自然出现率至少 84% →
模型几乎不主动 refresh（持续性强）。

## 对授权 Gate 的直接输入

按"C1 Intervention Configuration & Trigger-Rate Report"框架，SUPERSEDED_VERSION 目前状态：

- [x] 语义定义显式（本报告）
- [x] 离线 replay 自然出现率（精确下界 84.2%，Dose 四指标已量化）
- [ ] **SUPERSEDED_VERSION Lifecycle Contract**（状态语义、触发合同、无 ground-truth 泄漏、
  纯 evict 不注入新版本、协议连续性、protected evidence 规则）
- [ ] 假源机制验证（沿用 canary 通路，候选替换为 SUPERSEDED_VERSION）
- [ ] 安全不变量与 REHYDRATE 语义评审
- [ ] Actual Intervention Dose 指标落地（组合时测量）
- [ ] Effectiveness 设计：只在预选存在机会的 task 上做 Native/Runtime 配对（A/B 拆分）

**维持 64-leg NO_GO**：在生命周期语义与机制验证完成前，任何 Native vs Runtime 对比都无法测量上下文管理价值。
