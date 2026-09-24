# Context Runtime v0.4 — Research Reset (R0)

> 文档性质：**方向合同**。由 owner 裁决、助手整理既有材料而成；不授权实现 Agent 自主修改项目方向。
> 日期：2026-09-23（Asia/Shanghai）
> 状态：`DIRECTION_FROZEN_FOR_V0.4`（不是执行授权）
> 篇幅约束：刻意保持短。历史细节见 current-state 与各 study 档案，不重复于此。

---

## 1. Why reset

v0.3 这条线把"Context Runtime 能否被可靠观察和干预"做得远超预期，但研究问题逐渐漂移：

```
最初：长任务不断产生上下文 → 窗口有上限 → 压缩不可避免 → 怎样避免丢掉重要状态？
后来：stale read 能否识别 → 能否删除 → 删没发出去 → 自然触发率 → Native 能否完成
      benchmark → 为什么没完成 → 失败怎么分类 → 更严格的治理……
```

每一步局部合理，累计起来已离最初的问题很远。当前 harness 仍明确 `compaction: { enabled: false }`，
任务每腿 4–13 请求、累计 usage 最高 66,190 tokens，从未进入长上下文压力区；`project.md` 从未实现。

**一句话诊断**：过去验证的是 **Context Manipulation Infrastructure**，不是 **Context Management Effectiveness**。

---

## 2. What v0.3 established

| 层 | 内容 | 状态 |
|---|---|---|
| Context Runtime Core | Universe / SourceVersion / WorkingSet / Transition / replay / provenance | ✅ 扎实，项目核心资产 |
| Intervention Instrumentation | action record / hash / metering / SENT 绑定 / 独立重放 | ✅ **已够强，停止过度增强** |
| C1 / eviction / superseded-version | 机制可达性基本证明；effectiveness 未证明 | 🟡 收口为历史研究线 |
| Long-context / compaction / durable state | 几乎未开始 | 🔴 现在成为主线 |

**最容易被低估的成果**：Q5 把 intervention 从 policy 变成了**通用测量协议**。
`REMOVED_PAIR` / `MASKED_RESULT` 可自然扩展为 `SUMMARIZED` / `HYDRATED` / `RECALLED` / `TRUNCATED` / `PRUNED` / `INJECTED` / `HANDED_OFF`；
原文指纹、replacement 指纹、字节/token delta、request binding、SENT proof、replay 全部直接复用。

**第二成果**：任务判定的公开可判定性。v0.3 第一/二代 pilot 中 19 个 oracle FAIL 有 11 个源于任务规范缺口而非模型能力；
把"公开穷尽词表 + 语义要素覆盖"推广后，同类任务从 6 腿全 FAIL 变成 36 腿全过。

---

## 3. What remains unproven

| 未证明 | 证据 |
|---|---|
| 压缩场景下的信息保持 | `live-runner.ts:805` `compaction:{enabled:false}`；harness 无 compaction 埋点 |
| 短窗口模型跑长任务时 Runtime 的价值 | 任务从未跨压缩阈值 |
| `project.md` / durable state 有效性 | 从未实现、从未测试 |
| 任何任务质量/效率效果 | 每 (task,arm) n=2、三臂 oracle 通过率完全相同 |
| 机制的自然触发率 | 触发是 harness 播种，非真实压力下自发 |

---

## 4. v0.4 North Star（owner 裁决）

> **让长任务 Agent 在压缩、裁剪、版本变化和上下文替换过程中，持续保有完成任务所需的关键状态。**

英文：

> Preserve task-critical state across context transitions in long-running agents.

**Primary Failure Mode**：Compaction / pruning / context replacement 导致 task-critical state 丢失。
**关键词不是"大上下文"，而是 `Context Pressure → Durable State → Selective Rehydration`。**

---

## 5. Architecture

### 5.1 项目边界（owner 裁决）

| 项目 | 定位 |
|---|---|
| **Canvas Agent** | Context Runtime 的**第一个 reference application**，不是 Runtime 本身 |
| **Context Runtime** | provider-neutral 的核心基础设施，可被 Pi/Codex/Claude Code/OpenCode/Java/政企 Agent 接入 |
| **Context Lab** | 研究/评估平台：任务、oracle、replay、统计、证据 |
| **Studies** | 具体实验。Lab 是设备，Study 是培养皿 |

**硬规则**：`Context Runtime` 绝不 import `research/*`。Runtime 负责生成事实，Lab 负责利用事实证明假设。

### 5.2 五层能力

| Layer | 解决的问题 | 成熟度 |
|---|---|---|
| Context Universe | 有哪些 context sources？来自哪里？什么版本？ | ★★★★★ |
| Context Observation | 模型每次实际看到了什么？改了什么？ | ★★★★★ |
| **Durable State** | **哪些事实不能随压缩消失？** | **★☆☆☆☆** |
| Working Set Planner | 当前这次调用需要哪些状态？ | ★★☆☆☆ |
| Rehydration / Reconstruction | 丢后何时、以何表示恢复？ | ★★☆☆☆ |

后三层决定产品价值，是 v0.4 的主战场。

### 5.3 v0.4 主问题链

```
Compaction → Critical State Loss → Durable State → Rehydration → Working Set
```

---

## 6. Research questions

按 R3 这个 gate 分成两段，**顺序不可颠倒**：

**第一段：问题是否存在**
- RQ1: Native compaction 在我们的任务设计下，到底发生了什么？可观测吗？
- RQ2: compaction 之后，关键事实**真的会丢**吗？丢的是什么、丢了多少？

**第二段：机制是否解决**
- RQ3: 一个静态的持久状态锚点（`project-state`）能否减少事实丢失？
- RQ4: 在静态锚点之上，动态选择与按需恢复还有额外价值吗？
- RQ5: 上述收益与 context/cost delta 的取舍如何？

> **纪律**：先证明问题存在，再证明机制解决。禁止"先造解决方案，再努力设计一个问题证明它有用"。

---

## 7. Roadmap（R0–R6）

| 步 | 任务 | 产出 | 明确不做 |
|--:|---|---|---|
| **R0** | Research Reset | 本文 + current-state + 边界规则（已完成） | 不跑 Provider、不改代码 |
| **R1** | **Measurement Asset Extraction** | 从 Q5 抽取 5 个通用件，**脱离 `c1-q5-*` 命名**，以 clean integration PR 进 main | 不带 study contracts / identities / oracle / authorization / 归档 |
| **R2** | **Compaction Observation** | 独立轻量 harness，让 compaction 真实发生且**看得见** | 不测任务效果 |
| **R3** | **Fact-Loss Qualification**（gate） | 关键事实保持探针；判定 Native compaction 是否产生 **observable information loss** | 不上 project.md |
| **R4** | Durable State | `project-state` schema + `HYDRATED` action（先静态版） | 不做 embedding/RAG |
| **R5** | Rehydration | 按需召回 pinned SourceVersion / durable facts（先笨规则） | 不做智能 Planner |
| **R6** | Comparative Study | A/B/C/R 四臂 + 主终点事实保持率 | 到这里才用全套治理 |

### 7.1 R3 是硬 gate

若 R2/R3 显示 Native compaction 在我们的任务设计下**没有产生可观测的信息丢失**，则 Durable State 无意义，R4–R6 不启动，项目转为重新设计任务或重新评估问题。**这是允许的结论，不是失败。**

### 7.2 R2 的完成标准（不测效果）

```
compactionEvents > 0
before context 可 pin
after context 可观察
SUMMARIZED action 可生成
originalFingerprint != replacementFingerprint
metering 可计算
对应模型请求可绑定
replay PASS
```

### 7.3 R6 手臂设计

| 臂 | 行为 | 回答 |
|---|---|---|
| **A — Native Compaction** | 原生压缩，无 Runtime 恢复 | Baseline |
| **B — Static Durable State** | + 固定前置 `project-state` | 持久状态**本身**有没有价值 |
| **C — Runtime Managed State** | + Runtime 自动维护 + selective recall | 动态选择恢复有没有**额外**价值 |
| **R — High-context Reference** | 提高阈值或关闭压缩 | 信息保留上界，不进主 effect estimate |

A→B → B→C → A→C，三段各答一问，避免"臂名不同但传输层一样"。

### 7.4 Planner 后置链

```
Durable State → Compaction Awareness → Deterministic Rehydration
   → Simple Selection（笨规则）→ Adaptive Planner
```

**禁止**在证明"这些状态压缩后保留下来真能改善长任务"之前做：embedding / learned importance / salience / LLM planner / graph selection / predictive retrieval。

---

## 8. Explicitly stopped work

| 项 | 处置 |
|---|---|
| C1 superseded-version | `RESEARCH_COMPLETE / VALUE_UNPROVEN`。已证明"观察→识别→决策→改写→SENT→replay"管线能跑 |
| F1-40 / F1-48 | **HOLD**。F1-32 已得 `FRONTIER_INCONCLUSIVE_NON_BUDGET`，继续加 calls 无信息量 |
| R0 Runtime rescue | **HOLD**。不让 superseded-version rescue 占主线 |
| PR #144（Native Mechanism Codebook） | **不作为 v0.4 blocker**。可轻量 review 后归档或留 research branch |
| Native execution feasibility | 不再是主线 |
| 更严格的实验治理 / 更细的失败分类 | 不再是主线。**属于 Lab，不属于 Runtime Core** |
| Q5 | `STUDY_CLOSED / MEASUREMENT_ASSETS_EXTRACTED / EFFECTIVENESS_UNPROVEN`。仪器层毕业进主线，治理层留研究侧 |

---

## 9. Owner decisions recorded（2026-09-23）

**Decision 1 — Q5 integration**
不推送本地 57 个提交的原始历史作为巨型 PR。先修事实源，再从 Q5 抽取 provider/mechanism-neutral 的 measurement primitives，以独立 clean integration PR 合入 `main`。Q5-specific study contracts、identities、oracle、authorization 与 execution artifacts 保留为历史研究资产。**Q5 measurement assets 必须先于 v0.4 compaction implementation 进入主线**，避免新线重复实现测量层。

拆两个 PR：
- **PR A — Q5 historical closure**：Q5 final report / current-state update / commit-provenance references / historical study status。修事实源分裂。
- **PR B — Measurement Core extraction**：重组通用代码并**去 `c1-q5-*` 化**（如 `context-action-record.ts` / `context-action-replay.ts` / `context-metering.ts` / `context-request-binding.ts`），保留 Git 历史中的 Q5，代码语义上让 measurement layer 脱离 Q5。

**Decision 2 — R0 authorship**
North Star、项目边界、旧研究线状态与研究优先级由 owner 决定；R0 文档据此整理，不授权实现 Agent 自主改变项目方向。R0 保持短而明确，是方向合同而非大型研究报告。

**Decision 3 — Compaction harness**
新建独立 lightweight **Compaction Exploration Harness**。不得修改 Q5 frozen study harness，不迁移 Q5 全套治理。第一阶段仅复用 ActionRecord / Fingerprinting / Metering / Request Binding / Replay 五类通用能力。先验证真实 compaction 可观察，再验证 fact loss，随后才引入 Durable State / Rehydration。

---

## 10. 新工作准入规则

此后每个新 PR / 任务必须能回答：

> **它和"长任务中的 Critical State Preservation"是什么关系？**

属于主线，当且仅当满足至少一条：

1. 产生或改进 **Durable State** 的表示、判定或投递；
2. 产生或改进 **Rehydration / Reconstruction**；
3. **观测**压缩/裁剪/替换事件本身（R2）；
4. **测量**状态在上下文变换后的保持（R3）；
5. 是上述四项的必要基础设施，且能说明为什么必要。

不属于的例子：更严格的治理、更细的失败分类、新合同门禁、更多 manifest 校验。

---

## 11. 待决策（本文不授权）

1. 本地 57 个提交中 PR A / PR B 的具体切分与推送时机（需明确是否/何时开 GitHub PR）。
2. R2 的 harness 落点（新建 `research/studies/compaction-retention/harness/` 还是 `research/context-lab/measurement/`）。
3. R3 探针的任务形态（约束声明式/问答式/错误覆盖检测式）与主终点定义细节。
4. R6 的统计设计（重复数、配对/分层、预注册终点与停止规则）。
