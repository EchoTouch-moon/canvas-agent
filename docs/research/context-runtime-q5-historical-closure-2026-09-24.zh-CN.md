# Q5 历史收口：三代执行、状态与资产归位

> 文档性质：**历史结论文档（R0 收尾）**。不授权任何新一轮执行，不修改代码、合同、身份或归档。
> 日期：2026-09-24（Asia/Shanghai）｜状态：`STUDY_CLOSED / MEASUREMENT_ASSETS_IDENTIFIED / EFFECTIVENESS_UNPROVEN`
> 篇幅约束：Q5 细节散落在研究分支的 40+ 份报告与数千个归档文件中，本文只做归位，不搬运。

---

## 1. 一句话结论

Q5（离线三臂 Context 机制机会 pilot）**已经关闭**：三代真实执行全部结束、执行身份全部消耗、
可以下的结论已下完、不能再往前推；它向 v0.4 贡献的是**测量资产**，不是一个待继续的 v0.3 实验对象。

它**没有**证明任何上下文机制的**有效性**——三代 pilot 的 oracle 通过率在三臂之间完全相同，且压缩从未发生。

---

## 2. 三代执行结果（统计分开，不合并）

| 代 | 执行提交 | probe | pilot | 主要发现 |
|---|---|---|---|---|
| 1 | `0c05387` | 6/6 oracle PASS | 30/36，oracle 17，6 终止 | P2 三臂 FAIL → 查出隐藏字面答案集 |
| 2 | `aae6156` | 6/6 PASS，33 请求 | 30/36，oracle 17，6 终止 | P2 已修；H1/H2/L1 全 FAIL → 11 处任务规范缺口 |
| 3 | `12d17e0` | 6/6 PASS，40 请求 | **36/36，oracle 36，0 终止**，268 请求 | 公开契约修订后同类任务全过，修订有效 |

累计真实 Provider 请求约 740 次、usage 约 140 万 tokens（计费 UNKNOWN，不可写为 0）。
第三代的离线资格链为 probe 6/6 + pilot 36/36 = **42/42**、oracle **42/42**、fake fetch **336**、真实 Provider **0**；
合同 canonical `49172d83357485ad86f492e38d21f93f9643d4e63293aa1e899b02079c80964f`，403/403 文件 hash 绑定 `12d17e0`。

---

## 3. 状态三件套的准确含义

```text
STUDY_CLOSED                  研究线关闭，不再有下一步执行
MEASUREMENT_ASSETS_IDENTIFIED 测量资产已识别，尚未合入 main（PR B 才会发生）
EFFECTIVENESS_UNPROVEN        任何机制有效性均未证明
```

**刻意不写 `MEASUREMENT_CORE_MERGED`**：将 Q5 的五类通用件（ActionRecord / Fingerprint / Metering /
RequestBinding / Replay）去 `c1-q5-*` 化并合入 `main` 是 **PR B** 的内容；在 PR B 发生之前，
测量层只存在于本地研究分支上，主线重复实现测量层的风险仍然存在。

**身份全部 `CONSUMED`**（三代执行身份 + 2026-09-19 两个历史身份），**无未消耗的执行身份**。
任何后续 pilot 必须：新合同 + 新身份 + 新资格链 + 新授权；旧身份不补跑、不换身份、不修复、不合并效果。

---

## 4. Q5 证明了什么 / 没证明什么

**证明了（窄）**
1. 上下文机制可按请求注入、可观测、可投递、可审计（`REMOVED_PAIR` 有结构化记录、reason code、可独立重放）。
2. 任务判定可以做到**公开可判定**：第一/二代 19 个 oracle FAIL 里有 11 个源于任务规范缺口而非模型能力。
3. 证据链、单次身份生命周期与归档体系可靠（7 个档案目录 manifest 全部校验通过）。

**没证明**
- 压缩场景下的信息保持：`live-runner.ts:805` `compaction: { enabled: false }`，harness 无 compaction 埋点。
- 短窗口模型长任务时 Runtime 的价值：每腿 4–13 次请求、累计最高 66,190 tokens，从未接近压缩阈值。
- `project.md` / durable state 有效性：从未实现、从未测试。
- 任何效果：每 (task, arm) n=2、三臂 oracle 通过率完全相同、控制臂机会按设计不处置，跨臂机会率不可比。
- 机制的自然触发率：触发由 harness 播种，不是真实上下文压力下的自发行为。

---

## 5. 资产怎么用（归位表）

| Q5 资产 | 归位 |
|---|---|
| 仪器层：ActionRecord / Fingerprint / Metering / RequestBinding / Replay | **进主线**（PR B，去 `c1-q5-*` 化），v0.4 R2/R3 复用 |
| 实验治理：合同冻结、身份、授权、oracle、manifest、归档体系 | **留研究侧**，不搬进 Runtime Core |
| 三代 claim root / raw JSONL / tar.gz / 恢复预检件 | **留分支**，未合入 `main` |

---

## 6. 档案在哪里（未合入 `main`）

本文档随 PR A 合入 `main`，但 Q5 的原始证据**不随本文档合入**。它们仍在未推送的研究工作分支
`codex/c1-offline-mechanism-opportunity-pilot` 本地工作副本上（领先 `origin/main` 57 个提交）：

```text
docs/verification/c1-q5-cd-2026-09-19/            24 个文件
docs/verification/c1-q5-cd-2026-09-21/             8 个文件
docs/verification/c1-q5-cd-2026-09-22/            17 个文件
docs/verification/c1-q5-cd-2026-09-22-v2/        576 个文件
docs/verification/c1-q5-cd-2026-09-23/           841 个文件
docs/verification/cspv-c1-q5-*                     各轮报告（probe / pilot / A/B / C/D / 异常复核）
docs/verification/cspv-c1-observation-qualify-*  零 Provider 观测资格与五轮独立复核
```

引用纪律：主线上任何引用 Q5 数字的文档，必须写清"档案在研究分支、未合入"，不得让读者以为这些
claim root 可在 `main` 上复核。PR B 只抽测量代码，**不**搬运归档。

---

## 7. 与 v0.4 的关系

Q5 **不是** v0.4 的研究对象。它回答的是"Context Manipulation Infrastructure 能不能被可靠观察和干预"，
v0.4 问的是"上下文被压缩、替换之后，关键状态能不能保住"。两者之间唯一的桥是**测量资产**——
所以 PR A 修事实源与结论文档，PR B 才搬测量核心。详见
[Context Runtime v0.4 方向](./context-runtime-v0.4-direction.zh-CN.md)。
