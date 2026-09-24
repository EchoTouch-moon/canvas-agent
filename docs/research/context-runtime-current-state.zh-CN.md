# Context Runtime 当前状态索引

更新时间：2026-09-24（Asia/Shanghai）。本次更新随 PR A（分支 `research/v0.4-truth-source-reset`，基线为远端 `main`
`16a5a53b109e6aebbb59eb082d5bcd82fe89b74d`）提交，主要内容：**研究方向正式切换为 Context Runtime v0.4（Durable Context Runtime）**，Q5 第三代执行结果与范围界定归位为 v0.3 历史线的收尾，并修订项目边界与依赖规则。以下“当前”表优先于底部历史快照；历史合同与原始裁决不变。

> **阅读指引**：只想看"现在该做什么"→ 读本表 + [v0.4 方向](context-runtime-v0.4-direction.zh-CN.md)。
> 想看 Q5 三代到底证明/没证明什么 → 读本页“2026-09-23 第三代执行与实验线范围界定”。
> 想看仪器与标尺的后续价值 → 读[仪器与标尺价值评估](context-runtime-instrument-and-ruler-value-2026-09-23.zh-CN.md)（未合入）。
> 想看项目怎么拆 → 读[边界与依赖规则](context-runtime-layout-and-dependency-rules.zh-CN.md)。

> **引用位置约定**：本文标 `（未合入）` 的资产尚未进入 `main`，目前只存在于未推送的研究工作副本
> `codex/c1-offline-mechanism-opportunity-pilot`（本地分支领先 `origin/main` 57 个提交）。PR A 只修事实源，
> 不搬运这些资产；未标注的链接在 `main` 上均可解析。Q5 归档位置见
> [Q5 历史收口](context-runtime-q5-historical-closure-2026-09-24.zh-CN.md)。

## 当前事实与唯一近端任务

| 项                    | 当前状态及证据                                                                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **研究方向（2026-09-23 起）** | **Context Runtime v0.4：Durable Context Runtime**。核心问题从“Runtime 能不能可靠删一段上下文”转变为“**上下文被压缩、截断、替换之后，Agent 能不能持续保有完成长期任务所需的关键状态**”。见 [v0.4 方向](context-runtime-v0.4-direction.zh-CN.md) |
| 主终点                | **Critical Fact Retention Rate after context transition**（+ task correctness + context/cost delta）。task success 不再单独作为主终点 |
| 主机制                | **Durable State**（★☆☆☆☆，新建）+ Rehydration + Working Set；Planner 明确后置 |
| 版本断点              | v0.3 = Observation/Lifecycle/Intervention（C1·CR-004·CR-005·E0·F0·F1·Q5·SV2），**整体封存为历史研究线**；v0.4 = R0–R6 |
| 任务序列              | **R0 Reset → R1 Measurement Extraction → R2 Compaction Observation → R3 Fact-Loss Qualification（gate）→ R4 Durable State → R5 Rehydration → R6 Comparative Study**。R1 计划见[R1 实施计划](context-runtime-r1-measurement-extraction-plan.zh-CN.md)（未合入） |
| 方法刚性              | `Exploration → Qualification → Formal Study`；**禁止**一上来就重治理 |
| 项目边界              | Canvas Agent（产品）/ Context Runtime（基础设施）/ Context Lab（研究平台）三项目；**硬规则：Runtime 绝不 import research/***。见[边界与依赖规则](context-runtime-layout-and-dependency-rules.zh-CN.md) |
| 事实源状态            | ✅ **已随 PR A 修正**：本页现为 `main` 上的当前状态。本地研究副本仍领先远端 57 个提交，Q5 仪器资产（`c1-q5-three-arm.ts` / `c1-q5-action-replay.ts` 等）仍未推送；**测量资产以 `MEASUREMENT_ASSETS_IDENTIFIED` 计，未合入**（PR B 才会合入）|
| Q5 归位              | **测量资产**：仪器层（ActionRecord/Fingerprint/Metering/RequestBinding/Replay）供 v0.4 复用；实验治理层留在研究侧。**不是 v0.4 的研究对象** |
| Q5 第三代执行        | `12d17e0`：probe 6/6 oracle PASS、40/72 请求；pilot **36/36 oracle PASS**、268/864 请求、0 终止。identity 均已 `CONSUMED` |
| 本研究最硬结论        | **公开契约修订使任务可判定**：v0.3 第一/二代 pilot 中 H1/H2/L1 共 6 腿全 FAIL（11 处隐藏字面答案集），推广“公开穷尽词表 + 语义要素”后同类任务 36 腿全过 |
| 实验线范围边界        | **v0.3 这条线不能回答“压缩场景下上下文机制是否有价值”**：`live-runner.ts:805` `compaction:{enabled:false}`；每腿最高 66,190 tokens 未跨阈值；`project.md` 从未实现测试。详见下方范围界定节 |
| 已证明（窄）          | ① 上下文机制可按请求注入、可观测、可投递、可审计；② 任务判定可做到公开可判定；③ 证据链与身份生命周期可靠 |
| 未证明                | 压缩下的信息保持、短窗口模型长任务价值、`project.md` 有效性、任何效果（每 task×arm n=2、三臂通过率相同） |
| 历史线处置            | C1 superseded-version = `RESEARCH_COMPLETE / VALUE_UNPROVEN`；F1-40/F1-48 **HOLD**；R0 rescue **HOLD**；PR #144 不作为 v0.4 blocker |
| 新工作准入            | 每个新 PR 必须能回答“**它和长任务中的 Critical State Preservation 是什么关系**”；答不了不当当前优先级 |
| 身份状态              | 三代执行身份全部 `CONSUMED`（`fbb758da`/`6dcf4faa`/`41a50847`/`3412aa51`/`c56781ae`）+ 2026-09-19 两个历史身份。**无未消耗的执行身份**；下一轮必须新合同+新身份+新资格链+新授权 |
| 环境事实              | ChatGPT（Luna）与 Grok 4.6 额度耗尽；Cursor `grok-4.7-high` 可用但 MCP 启动连续挂起已停用。v0.3 全部执行/审查由 `stepfun-plan/step-5-preview` 完成 |
| 本地未合入进展        | **main 的实现状态仍未前移**：R1 = `LOCAL_EXTRACTION_COMPLETE` @ `b42eab5`（未合入）；**R2 = `NOT_QUALIFIED`**（首次 live = `R2_OBSERVATION_GAP`，诊断 = `R2_NO_TRIGGER`）；**PR B = `BLOCKED_BY_R2_QUALIFICATION`** |

本轮证据见 [观测资格报告](../verification/cspv-c1-observation-qualify-zero-provider-2026-09-18.zh-CN.md)（未合入） 及第一至 [第五轮独立复核](../verification/cspv-c1-observation-qualify-round5-review-2026-09-18.zh-CN.md)（未合入）。只读pilot与条件化三臂设计见 [离线pilot报告](../verification/cspv-c1-offline-mechanism-opportunity-pilot-2026-09-18.zh-CN.md)（未合入）。完整方向与任务表见 [2026-09-18规划](context-runtime-direction-review-and-next-plan-2026-09-18.zh-CN.md)（未合入）。

Q5-A/B 审查修复见 [Q5-A/B 报告](../verification/cspv-c1-q5-ab-fixtures-masking-2026-09-18.zh-CN.md)（未合入）；独立复核原文未改。Q5-A/B/C/D 已完成限定范围的本地交付，READY_FOR_AUTHORIZATION，不等于获得真实执行授权。实施顺序见 [规划 §21](context-runtime-direction-review-and-next-plan-2026-09-18.zh-CN.md#21-q5-离线设计包-v12026-09-18)（未合入）。

## 验证边界

第三代 `12d17e0`（Node 24.15.0、固定本地 tokenizer、deny-network）：
- 实现回归：16 files / 30 suites / **141/141 tests**、0 failed、0 skipped，typecheck exit 0（本地，非 CI）。
- V2 fake qualification：probe 6/6 + pilot 36/36 = **42/42**，oracle **42/42**，fake fetch **336**，真实 Provider **0**；
  合同 canonical `49172d83357485ad86f492e38d21f93f9643d4e63293aa1e899b02079c80964f`、文件 `3a9ebfba2634a16f544ac45bd304c760873c57aeca4a73f5bbf6bdc60cd1e881`，403/403 source/task hash 绑定 `12d17e0`。
- 真实 probe：6/6 腿、oracle 6/6、40/72 请求、usage 103,664 tokens；**有 fresh 独立审计（`judged`）**。
- 真实 pilot：36/36 腿、oracle 36/36、268/864 请求、usage 620,089 tokens；**按用户决定未派独立审计**，数字为父级从 claim root 原始文件直读的初核。
- `budget.pilot.calls=24`，每腿实测请求 4–13、无一腿 ≥15。
- Provider 计费/credits、`cacheWriteTokens`、wire 精确字节、服务端 model id 漂移均 **UNKNOWN**。
- 归档（未合入 `main`）：`docs/verification/c1-q5-cd-2026-09-23/`（资格链 408 文件 + probe 60 + pilot 346），7 个档案目录 manifest 共 864 项全部校验通过。位置与引用纪律见 [Q5 历史收口](context-runtime-q5-historical-closure-2026-09-24.zh-CN.md)。

---

## 2026-09-23 Context Runtime v0.4 方向切换（当前）

 三份方向文档已落定，研究主线正式切换：

- [v0.4 方向（R0 Research Reset）](context-runtime-v0.4-direction.zh-CN.md)：North Star / Primary Failure Mode / Primary Mechanisms / Primary Evidence 四件定名的事 + R0–R6 任务序列 + 手臂设计 + Planner 后置 + v0.3 历史线处置 + 新工作准入规则
- [项目边界与依赖规则](context-runtime-layout-and-dependency-rules.zh-CN.md)：Canvas Agent / Context Runtime / Context Lab 三项目 + “Runtime 绝不 import research/*”硬规则 + `context-benchmarks` 拆 Lab/Studies + 什么进 Runtime Core 什么留 Lab + 拆仓库的四个触发条件
- [仪器与标尺价值评估](context-runtime-instrument-and-ruler-value-2026-09-23.zh-CN.md)（未合入）：Q5 沉淀的两层资产在 v0.4 中的应用面、机制无关的 action record 结构、诚实清单与仪器自身成本

**owner 三项裁决已记录**（2026-09-23，详见 [v0.4 方向 §9](context-runtime-v0.4-direction.zh-CN.md)）：
1. **Q5 integration**：不推 57 个原始提交；先修事实源，再抽取 measurement primitives，以 clean integration PR 进 main；Q5 治理/身份/oracle/归档留研究侧。**测量资产必须先于 v0.4 compaction 实现进主线。** 拆为 PR A（historical closure，纯文档）+ PR B（measurement core extraction，去 `c1-q5-*` 化）。
2. **R0 authorship**：North Star / 边界 / 旧线状态 / 优先级由 owner 定，文档据此整理；实现 Agent 不得自主改方向；R0 保持短。
3. **Compaction harness**：新建独立 lightweight **Compaction Exploration Harness**；不改 Q5 frozen harness、不迁全套治理；第一阶段只用 5 个通用件。

**路线图已重排为 R0–R6**（新增 R1 抽取与 **R3 Fact-Loss Qualification 硬 gate**）：
`R0 Reset → R1 Measurement Extraction → R2 Compaction Observation → R3 Fact-Loss Qualification → R4 Durable State → R5 Rehydration → R6 Comparative Study`

**R3 是硬 gate**：若 Native compaction 在任务设计下未产生可观测信息丢失，R4–R6 不启动，转为重设计任务或重估问题。**这是允许的结论。**

下一步实施计划见 [R1 Measurement Asset Extraction](context-runtime-r1-measurement-extraction-plan.zh-CN.md)（未合入）（含通用/专用切分表、两个 PR 的验收标准）。

R1 与 R2 已在本地推进但**尚未合入 main**，因此 main 的实现状态仍未前移：

- **R1** `LOCAL_EXTRACTION_COMPLETE` @ `b42eab5`：6 个机制中立测量模块 + 16/16 测试，Q5 frozen 实现 byte-for-byte 未动。PR B 未开。
**R2 qualification = `NOT_QUALIFIED`**（两次 live 运行，结果不同，不可互相压扁）：

- **initial live run → `R2_OBSERVATION_GAP`**：native compaction **真实发生了**（`reason=threshold`，`CompactionResult` 给出 `summary` / `firstKeptEntryId` / `tokensBefore=19447`），压缩前的外发上下文也抓到了；但 harness 未能捕获 compaction **之后**的外发上下文，因此 attribution/replay 的验收条件 3 与 6 不满足。Fail-closed 正确工作：未伪造 `SUMMARIZED`。
- **diagnostic run @ `4dbf7d7` → `R2_NO_TRIGGER`**：session 在 2 次 Provider 请求后自行结束，无错误。诊断为 **pressure generator 必须重构**——harness 把"上下文长起来"依赖在模型行为上，而它应是实验输入。
- **PR B = `BLOCKED_BY_R2_QUALIFICATION`**：只有在真正观察到可归因、可 replay 的 native compaction 之后才开。

---

## 2026-09-23 第三代执行与实验线范围界定（v0.3 收尾）

### 三代真实执行对比（统计分开，不合并）

| 代 | 版本 | probe | pilot | 主要发现 |
|---|---|---|---|---|
| 1 | `0c05387` | 6/6 oracle PASS | 30/36，oracle 17，6 终止 | P2 三臂 FAIL → 查出隐藏字面答案集 |
| 2 | `aae6156` | 6/6 PASS，33 请求 | 30/36，oracle 17，6 终止 | P2 已修；H1/H2/L1 全 FAIL → 11 处规范缺口 |
| 3 | `12d17e0` | 6/6 PASS，40 请求 | **36/36，oracle 36，0 终止**，268 请求 | 同类任务全过，修订有效 |

累计真实 Provider 请求约 740 次；usage tokens 约 140 万（计费 UNKNOWN）。

### 范围界定：本实验线不能证明什么（任何后续引用必须带）

1. **压缩被主动关闭**：`src/live-runner.ts:805` `compaction: { enabled: false }`。三个被测机制（NATIVE / MASK_RECENT_READ / VERSION_AWARE）都是在“永不压缩”前提下的上下文卫生操作。
2. **任务从未跨过压缩阈值**：每腿 4–13 次请求、累计 usage 最高 66,190 tokens，对 128K 级模型连警戒线都没到；harness 也没有任何 compaction 事件的埋点或计数。
3. **`project.md` 前置状态注入从未实现、从未测试**：Q5 的 prompt 只含任务说明，bootstrap 只读 `package.json`。因此“前置加载项目关键运行信息能否抵消压缩损失”这一构想**无任何证据支持或反对**。
4. **机制方向与初衷不完全对齐**：MASK 是“隐藏较早读取结果”，VERSION_AWARE 是“驱逐旧版本”——两者都是**减少**上下文；而“防止压缩丢失关键信息”需要的是**保留/恢复**能力。二者不是同一个问题的正反两面。
5. **干预有效性未建立**：只证明通路运行 + VERSION_AWARE 移除已投递。每 (task,arm) n=2、三臂 oracle 通过率完全相同、控制臂同形机会按设计不处置（`NOT_EVALUATED`/`SHADOW`）→ 跨臂机会率不可比。
6. 2026-09-18 方向复核已预先标记过这一边界：“#110 SV2 受控真实调用 = harness-seeded pure eviction 的机制可达性；不是自然触发率和任务有效性”。

### 这两件事的价值体现在哪里

（详细版另见 [仪器与标尺：后续 Context 机制研究的价值与应用面](context-runtime-instrument-and-ruler-value-2026-09-23.zh-CN.md)（未合入）：含仪器能力清单、机制无关的 action record 结构与新机制映射表、六个应用面、诚实清单、三代量化数据、仪器自身成本与可伸缩用法、以及回到初衷的三臂设计与统计设计必要改动。）

**(a) 机制可投递性与可观测性（VERSION_AWARE 每轮都真的移除了内容）**
- 价值：证明了“在每次模型调用前改写上下文”这件事在真实 Provider 链路上**工程上能做到**——有结构化决策、有 reason code、有 recordHash、可独立重放。没有这个，任何关于上下文机制的讨论都只是设想。
- 局限：可达性 ≠ 自然触发率 ≠ 任务有效性。它是必要条件，不是充分条件。

**(b) 任务判定的公开可判定性（36/36 PASS 是靠修订公开契约换来的）**
- 价值：这是**方法论资产**，可迁移到任何后续实验。它把“模型失败”从“oracle 说不过就不过”变成“公开要求 → 判定 → 产物”三方可核对；顺带发现并修掉了一个真缺陷（reference 在 `require` 时写输出文件，使资格链覆盖率虚高）。
- 局限：判定可解释不等于机制有效。它只保证“没过就是真没过”，不保证“过了就是机制起了作用”。

### 若要回到初衷，最小改动清单

| 现状 | 需要 |
|---|---|
| `compaction: { enabled: false }` | 打开，并设定低于模型窗口的触发阈值，使压缩真实发生且**可计数** |
| 4–13 请求/腿、≤66K tokens | 设计跨压缩阈值的长任务：多文件、多轮次、累计远超阈值 |
| 无前置状态注入 | 实现 `project.md`（用户+LLM 维护）作为**一个臂**：NATIVE / COMPACT-ONLY / COMPACT+project.md |
| oracle 判“代码对不对” | 增加“**压缩后是否仍知道关键事实**”的探针（问答式，或任务依赖早期读取的信息） |
| 三臂 = 遮罩/驱逐 | 三臂应改为**压缩管理策略**的对比——遮罩和驱逐在压缩场景下语义完全不同 |

关键设计难点：压缩一旦发生，被压缩掉的内容就不可观测——除非保留 pinned 原文做对照，这正是项目已有的 `SourceVersion` / pinned Git blob 物化能力，可能是最自然的抓手。

## 2026-09-22 Q5 V2 离线收口（历史快照）

离线收口阶段状态曾为 **`PARENT_REVIEW_PENDING / NOT_AUTHORIZED`**；随后同一批准 tuple 的 probe 已恢复并完成，详见下方恢复执行记录。准确执行 SHA `0c0538705b55f2e8cbec23eee6e301af84e3da99` 的实现已完成V2 identity分离、Node24固定tokenizer下16 files/30 suites/130/130 tests、0 skip、typecheck exit 0；新V2 fake qualification与独立重放仍与 live probe 分开归档。

合同 canonical SHA `f6b82f0beab962c6eaf4e13617a8eb8b43f02e56fdc4e0795d1e22b3aabb1504`，合同文件 SHA `60a8127726bc57acce64c1c118f764b7359025a981042975623b576d101a806f`。V2四identity状态：qualification probe/pilot 已CONSUMED；execution probe `c1-q5-probe-20260922-fbb758da` 与 execution pilot `c1-q5-pilot-20260922-640c5cd9` 未claim。fake qualification实际42/42完成、0终止、0未执行，oracle42、audit42、336 fake、real0；403/403 source/task hash一致，独立replay原始SHA `386ca719f243199d3d95e713a6a7bae68385ed71cea8cf7b0c467be5e1a73db1`。

probe批准请求及其完整tuple见[Q5 V2 probe批准请求](../verification/c1-q5-cd-2026-09-22-v2/q5-probe-authorization-request-0c05387.md)（未合入），授权文件和原始预检/入口记录已归档于[real-probe目录](../verification/c1-q5-cd-2026-09-22-v2/real-probe-20260922/c1-q5-probe-20260922-fbb758da/)（未合入）。参数为Stepfun Plan/`step-3.7-flash`、6腿、最多72请求、并发1、0重试；实际正式入口仅启动一次，因 `tsx` `ERR_MODULE_NOT_FOUND` 在 adapter 初始化前退出，完成0、终止0、未执行6、请求0、real Provider 0、oracle `NOT_RUN`。这不是自然机会、干预、损害或效果结论；usage 保持未知。独立审计为 `AUDITED`，仅建议未来另行请求 pilot，不构成批准；pilot identity 仍未claim。V2完整收口及历史边界见[Q5 V2收口报告](../verification/c1-q5-cd-2026-09-22-v2/q5-v2-closure-0c05387.md)（未合入）。旧80574b2e目录和报告仅保留历史阻断，不覆写、不重评分、不与V2合并。

### 2026-09-22 Q5 V2 probe 恢复执行与独立审计（历史快照）

用户批准覆盖 canonical contract `f6b82f0beab962c6eaf4e13617a8eb8b43f02e56fdc4e0795d1e22b3aabb1504` 的 `phase=probe` tuple：Stepfun Plan/`step-3.7-flash`、6 legs、每腿最多12 requests、总最多72、并发1、0 retry、无 fallback、`UNBOUNDED_BY_USER`；pilot 不在范围。授权 provenance 是对话批准记录，不是加密签名。先前 `ERR_MODULE_NOT_FOUND` 的 setup-failure 原件保持独立且不可变；恢复证据、raw 机器结果、脚本、日志、secret scan、来源 hash 与独立报告均在 [real-probe recovery archive](../verification/c1-q5-cd-2026-09-22-v2/real-probe-20260922/c1-q5-probe-20260922-fbb758da/recovery-preflight-20260922/)（未合入），完整文件路径见 [recovery archive manifest](../verification/c1-q5-cd-2026-09-22-v2/real-probe-20260922/c1-q5-probe-20260922-fbb758da/recovery-archive-manifest-0c05387.json)（未合入）。

| 口径 | 计划 | 已开始 | 已完成 | 已终止 | 未执行 | requests | real Provider | oracle |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| authorized probe | 6 legs | 6 | 6 | 0 | 0 | 33 | 33 | `3 PASS / 3 FAIL` |
| pilot | 未授权 | 0 | 0 | 0 | — | 0 | 0 | `NOT_RUN` |

恢复仅修复 exact execution checkout 中 ignored 的 `node_modules/tsx` 链接，指向锁定的 `tsx@4.23.7`；未改源码、任务、测试、package、lockfile、冻结合同、身份或预算，也未安装网络依赖。重新预检确认403/403 source files匹配、0 mismatch；正式入口只启动一次。原正式入口记录仍准确表示当时 `NOT_STARTED`、未claim、0 Provider 请求；恢复入口随后 claim 同一 execution identity，6/6 legs `COMPLETE`，terminal `CONSUMED`，33次真实 Provider 请求，adapter receipt total tokens 为44,782。3个Q5-P2腿 oracle FAIL（01 `originalWindowField` allowed set；02–03 `failureReason` hidden equivalence set）保留在原始 `result.jsonl`，纳入分母；Q5-P1三腿 PASS。retry=0、fallback未执行；Provider billing/cost/credits 保持 `UNKNOWN`，不可写为0。

独立离线审计 verdict 为 **`AUDITED`**，确认授权绑定、来源 hash、身份边界、恢复 provenance 与 raw report 可核对；它不是成功效果结论，也不是独立 live rerun。自然机会、harm rate、机会质量、Runtime效果和Provider成本均不宣称。审计观察到8个已发送 `REMOVED_PAIR`（VERSION_AWARE 实验动作），不把它们转为自然机会或政策效果；sample为单次6腿，3个 oracle FAIL 要求 reviewer 按冻结合同解释。execution identity 已 `CONSUMED`，不得重试、换身份、补跑或修复；pilot 仍未claim、未运行，任何后续 pilot 需另行明确授权。

## 历史快照（保留，不代表当前状态或授权）

以下保留2026-09-13及更早记录。旧main SHA、F1 `NO_IDENTITY/NO_PROVIDER`、当时的下一步均已由上方当前表取代，不可用于判断最新进度。

更新时间：2026-09-13（Asia/Shanghai）。前次更新在 `codex/qwen-sv1-response-evidence`（基于 `0120932`），
记录机制 Canary V1–V3 与生命周期 Canary SV1 的**真实执行结果**和一项本地证据闭环修复；本次增补在
`codex/sv2-harness-seeded-implementation`（PR #110，head `52abc10`），记录 SV2 harness-seeded 真实执行结果。
本次进一步在 `codex/c1-effectiveness-e0-design` 起草 E0 合同；SV1/V1–V4 历史数字与结论保留原貌，不改写既有报告。

## 历史结论（下列为2026-09-13快照）

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
F0 contract structure    MERGED / ACCEPTED
F0 numerical freeze      MERGED / ACCEPTED
F0 executable contract   FROZEN / LIVE_STUDY_CONSUMED
F0 implementation        IMPLEMENTED / LIVE_PROVIDER_COMPLETED / NO_GO
F0 owner authorization   CONSUMED / RETIRED
F0-RCA hardening         MERGED / PROSPECTIVE / ZERO_PROVIDER / SEMANTICS_REVISION_PENDING
F0-v2 contract design    PASS / FROZEN_FOR_IMPLEMENTATION / NO_PROVIDER
F0-v2 machine contract  FROZEN / FROZEN_FOR_IMPLEMENTATION / NO_PROVIDER
F0-v2 runner integration IMPLEMENTED / CREDENTIAL_FREE_E2E_PASS / LIVE_BINDING_READY / NO_PROVIDER
F0-v2 live binding       IMPLEMENTED / FAKE_FETCH_E2E_PASS / RUNNER_FIX_REBOUND / BINDING_REVIEW_PASS / NO_PROVIDER
F0-v2 final-bound contract FINAL_BOUND_LIVE_REBOUND / RUNNER_FIX_REBOUND / BINDING_REVIEW_PASS / PR_#132_MERGED / NO_PROVIDER
F0-v2 live attempt      VALID / F0_V2_FEASIBILITY_NO_GO / CONSUMED
F0-v2 owner authorization V2 CONSUMED / RETIRED
F0-v2 failure anatomy  CLOSED / ZERO_PROVIDER / DESCRIPTIVE
F1-32 final binding    FINAL_BOUND / READY_FOR_INDEPENDENT_BINDING_REVIEW / NO_IDENTITY / NO_PROVIDER
R0 Runtime rescue       NOT_STARTED / DESIGN_ONLY
Old study resume/reuse    FORBIDDEN
Wave B / productization   NO_GO
```

当前正式研究口径见[研究立场与阶段性复盘](./context-runtime-research-stance-2026-09-11.zh-CN.md)。
它将 mechanism、execution feasibility、natural triggerability、treatment exposure 和 causal effectiveness
分开计量，并进一步区分 semantic lifecycle opportunity、formal policy eligibility 与 actual intervention/dose；
当前真实 E0 仍没有可识别的 Native-vs-Runtime treatment effect。

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

## 历史已执行与当时下一步

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
- F0 Native-only runner 已实现并冻结为独立 headless surface：32 个唯一 run identity 按两个 task 交替执行，普通
  task failure 与 per-run budget exhaustion 保留在分母并继续后续 run；oracle 在执行 sandbox 清理后由独立副本执行，
  checkpoint、response ledger、task adjudication 与 feasibility summary 均为 metadata-only。credential-free 集成回归
  已覆盖完整 32-run 编排、oracle firewall、单次失败继续和单侧 95% Clopper–Pearson 裁决；该替身不读取 credential、
  不访问 Provider，也不构成 F0 可行性结果。F0 executable binding 为 `codeRevision=c38785ada3573c2cc7a3927fd53c6670142eb537`、
  `executionSurfaceHash=587e4ec6cd7532ff405cb18214215f15d8cd7b0e90a8a58a6220336e82f5eeff`，合同 hash 为
  `a564ae3f3102678142d7a67c3e0a33f238c22d3221784d7926cc2b44d8349122`；live binding review 与新 binding 的 owner reauthorization 仍待完成。
- F0 authorized live binding 已接入同一 Native-only 编排：真实 response source、provider-reported usage、network
  request 计数和 memory-only credential seam 已完成；fake-fetch 32-run 回归通过，旧 binding 会在 identity claim 和
  credential read 前拒绝。新 live binding 的 exact revision 为 `c38785ada3573c2cc7a3927fd53c6670142eb537`，surface hash 为
  `587e4ec6cd7532ff405cb18214215f15d8cd7b0e90a8a58a6220336e82f5eeff`，合同 hash 为
  `a564ae3f3102678142d7a67c3e0a33f238c22d3221784d7926cc2b44d8349122`；真实 F0 仍等待 live binding review 和重新授权。
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
[F0 Execution Feasibility Contract 设计](../plan/c1-f0-execution-feasibility-contract-2026-09-11.zh-CN.md) ·
[F0 Numerical Freeze 提案](../plan/c1-f0-numerical-freeze-proposal-2026-09-12.zh-CN.md) ·
[F0 Execution Feasibility Contract 冻结准备](../verification/cspv-c1-f0-execution-feasibility-contract-2026-09-12.zh-CN.md) ·
[F0 Native-only Runner 验证](../verification/cspv-c1-f0-execution-runner-2026-09-12.zh-CN.md) ·
[F0 Authorized Live Binding 验证](../verification/cspv-c1-f0-live-binding-2026-09-12.zh-CN.md) ·
[F0-RCA Hardening 验证](../verification/cspv-c1-f0-rca-hardening-2026-09-13.zh-CN.md) ·
[F0-v2 Recovery Validation 设计](../plan/c1-f0-v2-recovery-validation-design-2026-09-13.zh-CN.md) ·
[F0-v2 Contract Freeze Review 准备](../verification/cspv-c1-f0-v2-contract-freeze-review-2026-09-13.zh-CN.md) ·
[F0-v2 Runner Integration 验证](../verification/cspv-c1-f0-v2-runner-integration-2026-09-13.zh-CN.md) ·
[F0-v2 Live Binding 验证](../verification/cspv-c1-f0-v2-live-binding-2026-09-13.zh-CN.md) ·
[F0-v2 Live Execution 报告](../verification/cspv-c1-f0-v2-live-execution-2026-09-13.zh-CN.md) ·
[F0-v2 Live Execution V2 报告](../verification/cspv-c1-f0-v2-live-execution-v2-2026-09-13.zh-CN.md) ·
[F0-v2 Failure Anatomy](../verification/cspv-c1-f0-v2-failure-anatomy-2026-09-13.zh-CN.md) ·
[F1 Native Feasibility Frontier 设计](../plan/c1-f1-native-feasibility-frontier-design-2026-09-13.zh-CN.md) ·
[F1-32 Final-bound Binding 验证](../verification/cspv-c1-f1-32-final-binding-2026-09-15.zh-CN.md) ·
[F0-v2 Final-bound Contract 验证](../verification/cspv-c1-f0-v2-final-binding-2026-09-13.zh-CN.md) ·
[F0-v2 Owner Authorization V2](../plan/cspv-c1-f0-v2-owner-authorization-v2-2026-09-13.zh-CN.md) ·
[后续实施验证](../verification/cspv-c1-followup-execution-2026-09-08.zh-CN.md) ·
[机制 Canary 计划](../plan/cspv-mechanism-canary-2026-09-08.zh-CN.md) ·
[本轮执行计划](../plan/cspv-c1-next-execution-2026-09-08.zh-CN.md) ·
[本轮验证报告](../verification/cspv-c1-v4-offline-followup-2026-09-08.zh-CN.md) ·
[机器对账结果](../verification/cspv-c1-v4-reconciliation-2026-09-08.json)

以下保留已有工程与合同绑定；历史 CI 结果是既有记录，本轮只核验最新 Git 基线和离线证据。

## 历史事实与绑定

| 项目                             | 当前状态                                                                                             | 绑定或解释                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 远端 `main`                      | `cf4b7ea61be784a92bcefec895b2d36888b91172`                                                           | 2026-09-08 fetch 核验；PR #104 已合并。本轮未核对该提交 CI                                                                                                                                                                                                                                                                                                                                                                 |
| PR #98                           | `MERGED / CI_GREEN / IMPLEMENTATION_ACCEPTED`                                                        | implementation `55d834483ba044099e0be8d64b95028becabb014`；merge commit `583ecb74623b77dce2238f67faba1b2e046aaa9b`；实现 usage amendment 的 adapter/validator/serialization 兼容层                                                                                                                                                                                                                                         |
| PR #100                          | `MERGED / CI_GREEN / ZERO_PROVIDER_CLOSURE_ACCEPTED`                                                 | merge commit `816c13c15ef8247ec9f27c981e025283be4e366b`；补齐 usage source map、正式 treatment 入口审计和离线 adjudicator 证据闭环                                                                                                                                                                                                                                                                                         |
| PR #102                          | `MERGED / CI_GREEN / LIVE_ENTRYPOINT_ACCEPTED`                                                       | merge commit `4d5e39a9b337d6cabdc84d450680bc54ad85561b`；实现正式 C1 live entrypoint 的授权、ground-truth-free bootstrap、scope gate 与 execution provenance                                                                                                                                                                                                                                                               |
| `C1_USAGE_CONTRACT_AMENDMENT_V1` | `FROZEN / MERGED`                                                                                    | 只调整 provider cache split 的可用性语义；原 `C1_RUN_CONTRACT_V1` 保持不变                                                                                                                                                                                                                                                                                                                                                 |
| `C1_PROTOCOL_V1`                 | `FROZEN`                                                                                             | 比较问题、对照/处理臂、指标与裁决边界                                                                                                                                                                                                                                                                                                                                                                                      |
| `C1_A_MANIFEST_V1`               | `FROZEN`                                                                                             | 4 个任务层、fixture、oracle、anchors 与身份绑定                                                                                                                                                                                                                                                                                                                                                                            |
| `C1_RUN_CONTRACT_V1`             | `FROZEN`                                                                                             | 32 matched pairs / 64 legs、AB/BA、主终点、预算与统计规则                                                                                                                                                                                                                                                                                                                                                                  |
| C1 treatment readiness           | `FROZEN / PASS`                                                                                      | provider-bound Native fidelity、Runtime treatment 与 T4 cold/restored 证据已通过零 Provider readiness                                                                                                                                                                                                                                                                                                                      |
| C1 study orchestration           | `MERGED / ACCEPTED`                                                                                  | 64-leg 顺序执行、隔离 sandbox、七类 metadata-only evidence、terminal/kill-switch                                                                                                                                                                                                                                                                                                                                           |
| 首次 C1 Live attempt             | `TERMINAL / NOT ADMISSIBLE`                                                                          | study `c1-20260905-c1-feasibility-v1-35359a74`；1 次 provider/network attempt、0 个 completed leg、usage capability mismatch                                                                                                                                                                                                                                                                                               |
| 首次 study identity              | `CONSUMED / RETIRED`                                                                                 | 永不 resume、reuse 或 rebind；不能用 #98 或后续修复继续该 identity                                                                                                                                                                                                                                                                                                                                                         |
| 机制 Canary V1–V3                | `TERMINAL / CANARY_STOP ×3`                                                                          | study `c1-mechanism-20260908-312fad65` / `-2d05cb78` / `-4fa2ce0e`；真实调用 2+2+1；三次均停在 Native 门（模型读 1/1/0 次），Runtime 臂未执行；三个身份均 consumed/retired                                                                                                                                                                                                                                                 |
| 生命周期 Canary SV1              | `TERMINAL / CANARY_STOP`                                                                             | study `c1-lifecycle-20260908-d4b4f5dc`；执行提交 `012093274da742eddd8178b4448d105e6b27c4ac`、合同 SHA `7c4577a25499ad512883c006f773bc87d538ae5528e8692da87990158b21c7e5`；1 次真实调用、`finalStage=EXPECT_READ_A`。`toolResults=[]`/`changedCalls=[]`/`answerMatched=false` 均为抛错跳过赋值留下的**默认值、非观测**；响应的 `outcome` 类型（`COMPLETE`/`FAILED`）、内容与 tool-request 数**未知**；身份 consumed/retired |
| 生命周期 Canary SV2              | `PASS / CLOSED / MECHANISM_ONLY`                                                                     | study `c1-lifecycle-sv2-20260909-ef4d90a2`；执行提交 `69d9dfc923b64a293aac4eae2dd510178c8f34b4`、合同 SHA `87bd74f1caea0a80cee8c4c85da6d3768a52ef950548de630516c3e8f4abb613`；1 次 Runtime 请求、0 tool request；read v1 对被 adjudicate 为 `SUPERSEDED` 并在 provider-bound 边界缺席；身份 consumed/retired；[执行报告](../verification/cspv-c1-lifecycle-canary-sv2-live-execution-2026-09-09.zh-CN.md)                  |
| E0 Effectiveness Contract        | `DESIGN_REVISION_2 / ACCEPTED`                                                                       | [E0 合同草案](../plan/c1-superseded-version-effectiveness-e0-contract-2026-09-09.zh-CN.md)；固定 4 matched pairs、enriched cohort、unique/exposure Dose schema、双 distinct-task qualification gate 和 providerConfigHash                                                                                                                                                                                                  |
| E0 freeze-prep implementation    | `PASS / READY_FOR_INDEPENDENT_REVIEW / NO_PROVIDER`                                                  | [冻结准备验收](../verification/cspv-c1-e0-freeze-prep-2026-09-09.zh-CN.md)；manifest、run contract、Dose schema 和 readiness hardening 已通过远端 Node 24 CI；E0 live 仍为 `NO_GO`                                                                                                                                                                                                                                         |
| E0 execution runner              | `IMPLEMENTED / FAKE_STATE_MACHINE_PASS / LIVE_NO_GO`                                                 | [E0 runner 验收](../verification/cspv-c1-e0-execution-runner-2026-09-10.zh-CN.md)；4 pairs / 8 legs fake study、A/B/C/D qualification、终止和 isolated-failure counterpart 场景已覆盖；exact live binding 和 owner authorization 仍待独立 review                                                                                                                                                                           |
| E0 final live binding            | `CLOSED / BINDING_VERIFIED`                                                                          | [E0 final live binding 验证](../verification/cspv-c1-e0-live-binding-2026-09-11.zh-CN.md) 与[独立技术复核](../verification/cspv-c1-e0-live-binding-independent-review-2026-09-11.zh-CN.md)；neutral bootstrap、共享 fake/authorized 8-leg runner、headless execution surface hash、`codeRevision == executionRevision` 与最终 run-contract SHA 已验证；真实 E0 结果仍需按新研究立场解释                                    |
| PR #115                          | `MERGED / CI_GREEN`                                                                                  | merge commit `f433524610bd79fa86b6dddc5c683a585c0092ec`；PR-head CI run `34553083218` 与 post-merge CI run `34554609142` 均 success；完成 final live binding 实现与首次授权运行前置                                                                                                                                                                                                                                        |
| PR #116                          | `MERGED / CI_GREEN`                                                                                  | merge commit `7b33e75249c8cb864cf4b41819e69ba9cd3694e5`；Node 24 post-merge CI run `34567191785` success；完成失败 leg partial checkpoint、计数和 cleanup truth hardening                                                                                                                                                                                                                                                  |
| E0 live attempt `9cb656f5`       | `TERMINAL / NO_GO / CONSUMED`                                                                        | 新绑定一次性授权运行；2/8 legs attempted、1 Native completed、1 Runtime budget exhausted、6 blocked；37 response、78 tool executions、0 lifecycle eligibility、0 dose；不输出 treatment effect                                                                                                                                                                                                                             |
| F0 numerical freeze              | `MERGED / ACCEPTED`                                                                                  | #119 数值提案已合并；两个 frozen task、16 runs/task、32 runs/study、单侧 95% Clopper–Pearson 和 per-task feasibility lines 已固定；不代表 F0 已执行                                                                                                                                                                                                                                                                        |
| F0 executable contract           | `FROZEN / CONSUMED`                                                                                  | [F0 合同冻结准备记录](../verification/cspv-c1-f0-execution-feasibility-contract-2026-09-12.zh-CN.md)；机器可读合同 hash `a564ae3f3102678142d7a67c3e0a33f238c22d3221784d7926cc2b44d8349122`；`codeRevision=c38785ada3573c2cc7a3927fd53c6670142eb537`，`executionSurfaceHash=587e4ec6cd7532ff405cb18214215f15d8cd7b0e90a8a58a6220336e82f5eeff`；该绑定已用于一次性 F0-v1 study，不可复用                                     |
| F0 live study `41753674`         | `VALID / F0_FEASIBILITY_NO_GO / CONSUMED`                                                            | 32/32 runs started，两个 task 各 16 次；VALIDITY/PRECISION pass，FEASIBILITY fail；t1=14/16、t2=4/16；study identity 已 consumed，报告记录在 PR #123                                                                                                                                                                                                                                                                       |
| F0 implementation                | `IMPLEMENTED / LIVE_PROVIDER_COMPLETED / NO_GO`                                                      | Native-only live binding 已完成一次真实执行；不产生 Runtime effect、Dose、T0 或 E1 结论                                                                                                                                                                                                                                                                                                                                    |
| F0 owner authorization           | `CONSUMED / RETIRED`                                                                                 | 仅覆盖 F0-v1 的 exact contract、execution revision、provider config、预算和 study identity；不构成 F0-v2 授权                                                                                                                                                                                                                                                                                                              |
| F0-RCA hardening                 | `MERGED / PROSPECTIVE / ZERO_PROVIDER`                                                               | 独立 hardening 模块提供逐 tool changed-path provenance、safe command hash/class、failure taxonomy 和重复失败 recovery guard；本 PR 补齐 canonical signature、连续 streak 与 recovery linkage，默认仍不启用；[验证记录](../verification/cspv-c1-f0-rca-hardening-2026-09-13.zh-CN.md)                                                                                                                                       |
| F0-v2 contract design            | `PASS / FROZEN_FOR_IMPLEMENTATION / NO_PROVIDER`                                                     | 保持 F0-v1 task、prompt、Provider、24-call 预算和分层 gate；post-run snapshot→adjudication→cleanup、UNKNOWN 分层与 hardening recovery 语义均已闭合；[设计提案](../plan/c1-f0-v2-recovery-validation-design-2026-09-13.zh-CN.md)                                                                                                                                                                                            |
| F0-v2 machine contract           | `FROZEN / FROZEN_FOR_IMPLEMENTATION / NO_PROVIDER`                                                   | `C1_F0_EXECUTION_FEASIBILITY_V2` 的 freeze-candidate hash 为 `31663b2833ea8ecf46fdc1165dd69b87e12c4ce1999fd595307368448d0606a7`；完整 evidence/outcome/firewall/artifact semantics 已 exact-bind；phase-aware candidate/final-bound validator 已冻结；execution binding 仅允许在实现后重绑，study identity 未创建；[冻结准备记录](../verification/cspv-c1-f0-v2-contract-freeze-review-2026-09-13.zh-CN.md)                |
| F0-v2 runner integration         | `IMPLEMENTED / CREDENTIAL_FREE_E2E_PASS / LIVE_BINDING_READY / NO_PROVIDER`                          | 独立 Native-only fake runner 已接入 hardening adapter、逐工具 provenance、post-run snapshot→pre-cleanup adjudication→cleanup→final disposition、UNKNOWN 与 ordinary/shared failure 场景；live adapter 已在同一 surface 接线；[验证记录](../verification/cspv-c1-f0-v2-runner-integration-2026-09-13.zh-CN.md)                                                                                                              |
| F0-v2 live binding               | `IMPLEMENTED / FAKE_FETCH_E2E_PASS / RUNNER_FIX_REBOUND / BINDING_REVIEW_PASS / NO_PROVIDER`         | authorized-provider response source、真实 usage 解析、memory-only credential seam 已接入；maxCalls 分类修复后重新绑定 executionRevision=`6d0189a998772e8d9e379f8ec56bc7f429546a2a`、surfaceHash=`583f6c974c207eb3e338b89aa345ab1aadd894fb25d83455b06ee59af13fbe0a`；旧 live attempt 已按 invalid study 记录；[验证记录](../verification/cspv-c1-f0-v2-live-binding-2026-09-13.zh-CN.md)                                    |
| F0-v2 final-bound contract       | `FINAL_BOUND_LIVE_REBOUND / RUNNER_FIX_REBOUND / BINDING_REVIEW_PASS / PR_#132_MERGED / NO_PROVIDER` | maxCalls 分类修复后已重新绑定 exact revision/surface；candidate hash=`31663b…`，final hash=`4120e8d4c5c029ce224fb1341989cdc208d96799f1c399e736ee77aa36ea0611`；PR #132 review/merge 与合并后 CI 已通过；[验证记录](../verification/cspv-c1-f0-v2-final-binding-2026-09-13.zh-CN.md)                                                                                                                                        |
| F0-v2 live attempt `de68f062`    | `TERMINAL / STUDY_INVALID / CONSUMED`                                                                | 4/32 legs started，68 Provider calls，88 tool executions；第 4 leg 的 `maxCalls=24` 被错误升级为 shared invalidator，28 legs blocked；identity 与 artifacts 保留，不解释为 feasibility 结果，不得 retry/reuse；[执行报告](../verification/cspv-c1-f0-v2-live-execution-2026-09-13.zh-CN.md)                                                                                                                                |
| F0-v2 owner authorization V2     | `CONSUMED / RETIRED`                                                                                 | 授权 identity=`c1-f0-v2-20260913-341fbab9` 已完成一次完整 study，授权记录为 immutable historical binding；不得再次使用；[授权记录](../plan/cspv-c1-f0-v2-owner-authorization-v2-2026-09-13.zh-CN.md)                                                                                                                                                                                                                       |
| F0-v2 live attempt V2 `341fbab9` | `VALID / F0_V2_FEASIBILITY_NO_GO / CONSUMED`                                                         | 32/32 runs started/completed，510 Provider/network requests，725 tool executions，validity/precision pass；t1=16/16 success 但 4/16 unrecovered tool-failure，t2=7/16 success、8/16 budget exhaustion；不输出 Runtime effect 或 T0/E1 结论；[执行报告](../verification/cspv-c1-f0-v2-live-execution-v2-2026-09-13.zh-CN.md)                                                                                                |
| F0-v2 failure anatomy            | `CLOSED / ZERO_PROVIDER / DESCRIPTIVE`                                                               | 基于 immutable F0-v2 artifacts 完成 t1 unrecovered 与 t2 budget/tool/oracle 轨迹拆解；不修改 F0-v2 结果，不生成新 executable contract；F1 Native calibration 与 R0 Runtime rescue 仅作为后续候选问题；[离线分析](../verification/cspv-c1-f0-v2-failure-anatomy-2026-09-13.zh-CN.md)                                                                                                                                        |
| F1 Native Feasibility Frontier   | `REVIEWED / FROZEN_FOR_CONTRACT_IMPLEMENTATION / NO_PROVIDER`                                        | 固定 task/prompt/provider/tool/recovery/oracle，只改变 Provider-call budget；24-call F0-v2 作为历史锚点，32/40/48 顺序停止规则与 `(L,B]` bracket 定义已审核；不创建 identity，不执行 Provider；[设计提案](../plan/c1-f1-native-feasibility-frontier-design-2026-09-13.zh-CN.md)                                                                                                                                            |
| F1-32 machine contract           | `FROZEN_FOR_IMPLEMENTATION / NO_PROVIDER / NO_IDENTITY`                                              | freeze candidate hash=`053fa42d...`；只冻结 32-call point，study ceiling=`1024`，继承 F0-v2 task/evidence/firewall/recovery/gate 语义；final binding 不改变候选研究语义；[合同候选 Freeze Review](../verification/cspv-c1-f1-32-contract-freeze-review-2026-09-13.zh-CN.md)                                                                                                                                                |
| F1-32 credential-free runner     | `IMPLEMENTED / CREDENTIAL_FREE_E2E_PASS / BINDING_READY / NO_PROVIDER`                               | Native-only 32/run、1024/study 调度、evidence、oracle、snapshot 与 cleanup 通过假 Provider 验证；历史 F0-v2 anchor 不变；[runner integration](../verification/cspv-c1-f1-32-runner-integration-2026-09-14.zh-CN.md)                                                                                                                                                                                                        |
| F1-32 authorized runner          | `IMPLEMENTED / FAKE_PROVIDER_E2E_PASS / NO_IDENTITY / NO_OWNER_AUTHORIZATION / NO_PROVIDER`          | commit `0e55a36f...` 增加单独 authorized Provider 入口；auth 精确绑定合同、checkout、surface、budget 与单次 identity；真实入口延迟读取内存 credential，fake-fetch 端到端 network=0；32/run 与 1024/study caps 仍由冻结合同驱动；[重新绑定记录](../verification/cspv-c1-f1-32-authorized-runner-rebinding-2026-09-15.zh-CN.md)                                                                                              |
| F1-32 final-bound binding        | `FINAL_BOUND / READY_FOR_INDEPENDENT_BINDING_REVIEW / NO_IDENTITY / NO_PROVIDER`                     | execution revision=`0e55a36f...`；execution hash=`f5b5f10c...`，control hash=`8ac49f85...`；freeze candidate=`053fa42d...` 不变，final run-contract hash=`bbb7db4f...`；282+4 inventories 和 281-file F0-v2 anchor 已重新校验；[重新绑定记录](../verification/cspv-c1-f1-32-authorized-runner-rebinding-2026-09-15.zh-CN.md)                                                                                               |
| SV1 响应证据缺口                 | `ADJUDICATED / FIXED (local)`                                                                        | 原件仅 1×`OUTBOUND_PERMITTED`、`permitsWithoutRecordedResponse=1`、`responseStatus=NOT_RECORDED`；根因是 canary 在 `responseSource.next` 内抛错早于驱动落盘；修复 `cf0d45b47ffb1d35f1630e993675b50c53777455`；历史原件不回填，该次 usage 与 tool-request 数保持未知                                                                                                                                                        |
| PR #105                          | `OPEN / CI_GREEN / REVIEW_REQUIRED`                                                                  | head `012093274da742eddd8178b4448d105e6b27c4ac`，base `main`；CI run `34240182684` 的 `check` 与 `macos-electron` 均 success；尚无独立 review，CI 绿不替代内容审查                                                                                                                                                                                                                                                         |
| 远端 `main`                      | `STABLE / POST_MERGE_CI_PASS`                                                                        | `main @ aac6a58c1149cb41d51d38d6511629b604514dd4`；#140 已合并，Context Runtime CI `34923842658` completed/success；此前 `51a409cb...` binding 作为上一阶段历史快照保留                                                                                                                                                                                                                                                    |
| CR-005                           | `CLOSED_AS_STOPPED_EXPERIMENT`                                                                       | Run 1/Run 2 保留；没有把 C5/C6 伪装成补跑结果                                                                                                                                                                                                                                                                                                                                                                              |
| CSPV-B0/B1                       | `POLICY_CAPABILITY_GAP → PASS`                                                                       | 原 oracle 先暴露缺口，B1 在不改 frozen suite 的条件下修复并通过                                                                                                                                                                                                                                                                                                                                                            |

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


### 2026-09-19 Q5 日志修复补记

第三轮指出的全局顺序与整调用缺失已本地修复：schema v2 绑定 runId，原序连续性校验；完整 PASS 要求外部独立运行清单，否则为 PARTIAL。增加整块删除、尾块删除、倒序与跨运行拼接回归。未提交，Q5-A/B 仍待完整验收，Q5-C/D 未执行，LIVE_NO_GO。细节见 Q5-A/B 验证报告末节。


### 2026-09-19 Q5 收口当前进度（优先于上方早期补记）

A/B 已提交 `0543152` 并在干净版本复验19/19；C 离线调度、独立清单和停止规则已实现，连同 Q5 测试28/28及类型检查通过。D 仍缺 Step Plan 研究 Credits/付费约束及实际输入上限等执行绑定条件，尚未 READY_FOR_AUTHORIZATION。进度证据见 [C/D报告](../verification/cspv-c1-q5-cd-progress-2026-09-19.zh-CN.md)（未合入）。Provider=0，LIVE_NO_GO。


### 2026-09-19 Credits 阻塞解除

用户允许本研究现有 Stepfun Plan Credits 不设上限。Q5-D 不再等待账户额度数值；剩余为输入/在途时长执行边界与最终三臂版本/身份绑定。真实运行尚未启动，旧 identity/HOLD 不变。


### 2026-09-19 Q5 输入限制与整链准确提交复验

`afff01b81dffa7e08a280e14016b67de22fba0cf` 干净工作树：55/55（无跳过），tsc通过；探针计划6、完成6、终止0、未执行0；pilot计划36、完成36、终止0、未执行0。42个本地oracle PASS与42个文件重放PASS仅为已知参考答案脚本的协议验收。336条固定本地模板token计量已落盘；并非Provider计费token。新probe/pilot字符串仅为PROPOSED_UNCLAIMED，不构成身份登记或授权。证据与剩余事项见 [C/D报告](../verification/cspv-c1-q5-cd-progress-2026-09-19.zh-CN.md)（未合入）。


### 2026-09-20 Q5最终收口（当前结论）

Q5-A/B/C/D的请求范围已完成。最终候选执行提交 `f51055a8fe949aade9f3e1e9a9f9db762022da14`，合同hash `f6a19835256ab172f751538acca9fd8f767ad78430e1c9de100440ccc14565ec`。116/116与类型检查通过；6+36注入HTTP资格腿、42腿/336请求独立重放通过；重复资格identity拒绝。真实Provider=0，真实probe/pilot身份UNCLAIMED。完整候选预算、身份、授权范围和证据见 [最终待批准包](../verification/cspv-c1-q5-cd-progress-2026-09-19.zh-CN.md#最终待批准包2026-09-20)（未合入）。READY_FOR_AUTHORIZATION仅指Q5准备完成，Q6尚未批准；下一步优先单独决定probe，pilot另批。


### 2026-09-21 异常落盘、离线复现与 restore-then-compose 修复

PROPOSED 截断判 FAIL 合理，不放宽审计。`failure.jsonl` 只补追查性。用归档工具序离线复现到 `RUNTIME_CONTEXT_UNCHANGED`（文件恢复后下一轮无 context change）；live 原异常文本仍未知。L1 公开材料未点名 `diagnosis.json`，缺口只留在复核文档，公开 prompt 未改。执行修复已提交 `75863bee0be0a90b4ccd13ff0e7c820ed8d14d4d`。详见 [复核与修复记录](../verification/cspv-c1-q5-pilot-exception-review-2026-09-21.zh-CN.md)（未合入）。该提交上的候选合同已被任务规范修订取代。当前候选见 [q5-run-contract.03f9db3.proposed.json](../verification/c1-q5-cd-2026-09-21/q5-run-contract.03f9db3.proposed.json)（未合入）。

### 2026-09-21 探索 pilot 已执行（身份已消耗，证据不完整）

单独批准后在 `f51055a` 执行 `c1-q5-pilot-20260919-70a10531`。完成 8、终止 1、未执行 27；真实 Provider 38 次。`Q5-L2/1/VERSION_AWARE` 第 5 次调用只留下 PROPOSED，独立重放 FAIL，全局停止。账本该腿 usage=null。不作机制或效果判断。报告：[pilot 执行报告](../verification/cspv-c1-q5-pilot-live-2026-09-21.zh-CN.md)（未合入）。身份 CONSUMED。

### 2026-09-21 自然探针已执行（身份已消耗）

已获覆盖 `f51055a` / 合同 `f6a19835256ab172f751538acca9fd8f767ad78430e1c9de100440ccc14565ec` / `c1-q5-probe-20260919-a32ff7a4` / probe 6腿72请求的明确授权，并在独立 checkout `.pr-worktrees/c1-q5-probe-f51055a` 一次性执行。完成 6、终止 0、未执行 0；真实 Provider 41 次。独立落盘重放 PASS。Q5-P1 与 Q5-P2 的 VERSION_AWARE 均有收到响应的实际 `REMOVED_PAIR`；MASK 因干净 read 未超过 K=4 而 sent mask=0。六腿任务 oracle 均 FAIL，不作为效果或损害结论。probe 身份 CONSUMED。完整表与计量见 [探针报告](../verification/cspv-c1-q5-probe-live-2026-09-21.zh-CN.md)（未合入）。未启动 pilot。

### 2026-09-21 自然探针本地准备（授权前记录）

已核对交付包未漂移：文档 HEAD `60464d0`，执行源码仍为干净 `f51055a`；二者之间仅文档与资格证据，执行面文件哈希与合同一致。因 `verifyQ5RunContract` 绑定 `HEAD==executionRevision`，已另建独立 checkout `.pr-worktrees/c1-q5-probe-f51055a`，在该树上合同 SHA `f6a19835256ab172f751538acca9fd8f767ad78430e1c9de100440ccc14565ec` 核验通过；在文档 HEAD 上核验失败，符合“报告提交不能替代执行提交”。

真实身份目录当时不存在，probe/pilot 均 UNCLAIMED。`STEP_PLAN_API_KEY` 可从仓库 `.env` 加载（未输出）。tokenizer 固定资产哈希与 `tokenizer-manifest.json` 一致。未重复 116 项测试。此段是授权前核对；随后 probe 已执行并消耗身份，见上一节。


### 2026-09-21 pilot异常落盘本地修复

保留pilot原终态与身份。runner已本地补异常阶段/name/message/stack落盘，并覆盖首请求及第5请求compose前失败；19/19与类型检查通过，未提交，本轮新增真实调用0。审计仍拒绝无终止证据的PROPOSED截断；历史具体异常根因仍未知。见[复核与修复记录](../verification/cspv-c1-q5-pilot-exception-review-2026-09-21.zh-CN.md)（未合入）。下一步先离线复现根因和核对公开任务要求，不能直接重跑pilot。

### 2026-09-22 Q5 步骤 1-3 收口更正

**当前状态：`BLOCKED_PENDING_IDENTITY_REBIND / PARENT_REVIEW_PENDING`；真实执行 `NOT_AUTHORIZED`。** 准确执行 SHA `80574b2ae9f67d74602d2dad549d077f6fdc2caf`、合同 canonical SHA `dfdc5b73bc7cbfe47deb742672c754b5a7fe84ab51502539bf28eeba503e07c7`、合同文件 SHA `84cdc2afcfff7bffd668675a0e3ad105b996042b6e38459b3b7f9b3f19c83249` 和既有证据归档 SHA `98991fecf8f93e31b953edc40f30f18be2678c0badb11b64290cffd4942fa032` 保持绑定事实；归档资格实际仍为42腿、336 fake fetch、真实Provider 0。

更正原因及后续证据：早先59项 JSON的 `numTotalTestSuites=9` 不是9个文件，`testResults`仅5个文件。随后已在准确80574b2e、Node24、固定tokenizer、拒绝网络通路下完成计划16文件及新增适用回归：30 suites、128/128 tests、0 skip、typecheck exit 0（非CI）。原始 JSON/log、准确16文件清单见[父级更正说明](../verification/c1-q5-cd-2026-09-22/q5-parent-correction.80574b2e.md)（未合入）。

另已核对 identity 绑定：`verifyQ5RunContract` 将 `stages.probe.studyId` 纳入 canonical contract hash，`assertQ5Authorization` 要求 authorization studyId 与合同内 identity 完全相等。当前合同内 identity `c1-q5-probe-20260921-91ccc8cd` 已作为 fake qualification CONSUMED；先前草案 `c1-q5-probe-20260922-80574b2e` 被正式校验拒绝，不能仅改批准文案。批准请求仍不可执行；须由父级审核后决定是否在最终版本上重新生成全新 identity/合同/hash，再另行请求批准。pilot 不自动启动，旧身份不补跑，新旧版本不合并效果。
