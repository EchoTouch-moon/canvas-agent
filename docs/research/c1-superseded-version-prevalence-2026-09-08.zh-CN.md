# SUPERSEDED_VERSION 干预机会：V4 真实轨迹 Prevalence Study

日期：2026-09-08。数据：V4 真实 Provider 证据（未改动）+ 冻结任务 manifest `c1-effectiveness-v1.json`。
性质：离线观察性研究，**零 Provider 调用**。承接
[duplicate-read 观察报告](c1-duplicate-read-observability-2026-09-08.zh-CN.md)（出现率 0/19）
与评审意见：下一阶段先证 intervention opportunity 与 treatment integrity，再谈 live effectiveness。

## 语义定义（冻结）

**SUPERSEDED_VERSION**：模型读取文件 P（版本 v1 进入 Working Set）后，P 被 edit 修改（→v2），
而 v1 的读取证据仍留在模型可见上下文中——它不再描述当前文件状态。
判定：read(P)@call i，其后 call j>i 出现 edit，且 P ∈ 该 leg 实际 `changedPaths`（sandbox 差异核定）。
Refresh：call k>j 重读 P（旧证据被新证据接替）。

## 结果

样本同前：19 腿（NATIVE 10 / RUNTIME 9），223 响应，137 read / 103 bash / 39 edit。

| 指标 | 值 |
| --- | --- |
| 含陈旧读取证据的腿 | **17 / 19（89%）** |
| 陈旧事件总数 | 26 |
| 陈旧证据持续的调用总数 | 169（约占全部 223 调用的 76%） |
| 改后刷新重读 | **仅 1 次**（模型改完几乎从不重读，与 duplicate-read 结论互证） |
| 陈旧内容剂量 | 21,252 字节（≈5.3K tokens，bytes/4 粗估） |
| 未能归因路径的 read | 24 / 137（17.5%，路径清单外或序列化变体） |

典型形态：

- **t1（单文件修复，16 腿）**：每腿都是 read `paginator.js` → edit → 旧读取证据残留 3–4 次调用直至 leg 结束。
- **t2（多文件迁移，RUNTIME 腿）**：call 4 批量读取 9 个文件 → call 9 起连续 11 次 edit →
  **10 份读取证据同时变陈旧并持续 12 次调用**（约 9.4KB）。

## 结论与边界

1. **SUPERSEDED_VERSION 是该 workload 中自然高发的生命周期事件**（89% 腿、76% 调用），
   与 duplicate-read（0/19）形成鲜明对比。它满足评审要求的"语义成立 → 自然出现率高"前置条件，
   是目前唯一有实证触发率支撑的干预候选。
2. 与 duplicate-read 的语义差异值得注意：后者要求模型"犯错式"重读；本事件由正常 workflow
   （读→改→继续验证）自然产生，**不依赖任何模型冗余行为**。
3. 陈旧证据不是无害残留：后续调用（重跑测试、二次修复）在旧文件版本上推理，
   属于 actively misleading context。这为"为什么该移除"提供了语义依据，而非"为了触发而触发"。
4. 边界与近似：
   - 多文件腿（t2）的 edit→file 归因为腿级上界（`changedPaths` 确认这些文件确实被改，
     但 `staleFromCall` 取该 read 之后的首个 edit，具体文件的变陈旧时点可能更晚，persistence 为上界）。
   - 24 次 read 未归因；token 为 bytes/4 粗估；会话长度有限（8–20 调用），
     更长会话中残留时间预计更长。
   - 本研究度量**机会**，不证明移除一定改善结果（那是 effectiveness 问题）。

## 对授权 Gate 的直接输入

按评审建议的"C1 Intervention Configuration & Trigger-Rate Report"框架，SUPERSEDED_VERSION 目前状态：

- [x] 语义定义显式（本报告）
- [x] 离线 replay 自然出现率（17/19 腿，剂量与持续分布已量化）
- [ ] Lifecycle 语义设计（REMOVE vs REPLACE-with-marker；协议连续性；protected evidence 规则）
- [ ] 假源机制验证（沿用 canary 通路，候选替换为 SUPERSEDED_VERSION）
- [ ] 无 ground-truth 泄漏与安全不变量评审
- [ ] Intervention Dose 指标落地（eligible/selected/removed elements、tokensBefore/After、持续长度）
- [ ] Effectiveness 设计：只在预选存在机会的 task 上做 Native/Runtime 配对（评审的 A/B 拆分）

**维持 64-leg NO_GO**：在生命周期语义与机制验证完成前，任何 Native vs Runtime 对比都无法测量上下文管理价值。
