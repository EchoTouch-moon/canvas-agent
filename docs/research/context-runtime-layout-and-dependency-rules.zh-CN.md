# Context Runtime 项目边界与依赖规则

> 文档性质：**架构边界约定**。不是新实验授权，不修改任何现有代码、合同、证据或身份状态。
> 日期：2026-09-23（Asia/Shanghai）
> 依据：`context1-拆分问题.md`、`context0-方向问题.md` §12–13、Q5 三代实测规模
> 目标：**先拆职责与依赖，不动仓库**。目录重组按需分批，依赖方向立即生效。

---

## 1. 为什么现在必须拆

现在真正的问题不是代码量大，而是 **Product、Runtime、Research、Experiment Harness 已在互相污染彼此的目标**。

硬信号（本次规划时实测）：

| 指标 | 实测值 |
|---|---|
| `research/context-benchmarks/src/` 模块数 | **50** |
| Q5 专项测试文件 | **10** |
| 单轮 pilot 的证据归档文件 | **864**（7 个档案目录、7 道 manifest） |
| 一个 pilot 从设计到跑完的关卡数 | 规范修订→夹具→回归→合同→42 腿资格→独立重放→批准请求→预检→执行→独立审计→归档，**十余个** |
| 本地分支领先远端 `main` | **57 个提交**，Q5 仪器资产不在远端 |

一个 Agent 产品仓库里出现 50 个实验 src 模块，就是明确的拆分信号。

---

## 2. 三个项目（概念先行，仓库不动）

| 项目 | 核心问题 | 生命周期 |
|---|---|---|
| **Canvas Agent** | 用户最终使用什么 Agent 产品？ | 产品 |
| **Context Runtime** | Agent 如何管理、保存、选择、恢复 Context？ | 基础设施 |
| **Context Lab** | 我们怎么证明某种 Context 机制有没有用？ | 研究平台 |

三者**客观已存在**，只是还揉在一个项目叙事里。

### 2.1 Canvas Agent 的定位改变

> **Canvas Agent 应该变成 Context Runtime 的第一个 reference application，而不是 Context Runtime 本身。**

它不应该知道：`F0` `F1` `Q5` `SV2` `E0` `C1` `Clopper-Pearson` `single-use identity` `experiment authorization`。

它只应看到：

```ts
const runtime = new ContextRuntime(...)
await runtime.observe(...)
await runtime.compose(...)
await runtime.commit(...)
```

未来换成 Pi / Codex / Claude Code / OpenCode / Java Agent / 政企 Agent，都只是不同 Adapter。

### 2.2 Context Runtime 的定位

自己应有清晰 API，**内部不出现**：`c1-q5` `f0-v2` `f1-32` `pilot3` `authorization record` `experiment oracle`。

只有 Runtime 可独立推广，才可能出现：

```
Pi ────────────┐
Codex ─────────┤
Claude Code ───┤
OpenCode ──────┼── Context Runtime
Java Agent ────┤
Enterprise ────┘
```

而不是 `Canvas Agent └── 内部有个 Context Runtime`。

### 2.3 Context Lab 的定位

过去一个月实际已做出一个相当复杂的研究 harness：frozen contract / provider binding / ActionRecord / replay / oracle / fixture / manifest / dose / intervention auditing / statistics / single-use execution / evidence archive。

**它已经不是 Runtime 的普通测试代码，而是一个实验平台。** 正式命名为 **Context Lab**（或 ContextBench）。

职责：`Runtime Mechanism → Context Lab → Task → Provider → Evidence → Oracle → Effect Estimate`。以后研究 Compaction / Durable Memory / Working Set / RAG / Rehydration / Multi-agent handoff / Prompt caching 都不用重造框架。

---

## 3. 依赖方向硬规则（立即生效）

```
               Context Lab
                    │ tests
                    ▼
Canvas Agent ──→ Context Runtime
```

**允许**：`Lab → Runtime`、`Canvas Agent → Runtime`
**禁止**：`Runtime → research/*`（任何形式，包括 devDependency 之外的类型引用）

```
@canvas/context-runtime  ✗ NEVER imports  research/context-benchmarks
```

这是架构硬规则，不是风格建议。违反即阻断合入。

---

## 4. `research/context-benchmarks` 的两层拆分

它现在混了**可复用的研究基础设施**与**一次性实验实现**。应拆为：

```text
research/context-lab/          ← 实验室设备
  action-record/                 逐请求干预记录 + 四阶段状态机
  fingerprint/                   原文/replacement sha256
  metering/                      字节/token delta
  provider-binding/              真实 Provider 绑定与 receipt
  replay/                        独立重放与 recordHash 复算
  oracle-framework/              判定器框架（不含具体假设）
  fact-probe/                    事实保持探针（R2 主终点）
  study-runner/                  Exploration → Qualification → Formal Study
  statistics/                    效果估计（R5 才用）

research/studies/             ← 实验（培养皿）
  c1/        superseded-version 研究（RESEARCH_COMPLETE / VALUE_UNPROVEN）
  f0/
  f1/
  q5/        ← 仪器与标尺的原始实现，含全套实验治理
  compaction-retention/   ← v0.4 新主线
```

> **Lab 是实验室设备，Study 是实验。** 过去我们把显微镜和某一次培养皿实验装在一起了。

---

## 5. 什么进 Runtime Core、什么留 Lab

### 进 Runtime Core（含轻量可观测接口）

| 组件 | 理由 |
|---|---|
| **SourceVersion / Universe / Provenance** | Runtime 核心，不是研究设施。它负责 **pin 被压缩掉的信息** |
| **Transition / Replayable State** | Runtime 自身工程能力，不能因 Q5 拿它做实验就归进 Lab |
| **轻量 instrumentation**：`originalFingerprint` / `replacementFingerprint` / `deltaBytes` / `associatedModelCallId` | 属于 Runtime Core 的可观测接口 |

### 留 Lab

| 组件 | 理由 |
|---|---|
| experimental hypothesis | 研究假设 |
| oracle（具体判定） | 判定具体任务 |
| effect estimator | 效果估计 |
| study authorization | 实验授权 |
| statistical gate | 统计门禁 |
| manifest / 单次身份 / 归档体系 | Q5 那套治理，**不要搬进 Runtime Core** |

**边界一句话**：

> **Runtime 负责生成事实。Lab 负责利用事实证明假设。**

Q5 只向 Runtime 贡献 5 个通用件：`ActionRecord` `Fingerprint` `Metering` `RequestBinding` `Replay`。manifest、authorization、single-use identity、几百个归档文件继续属于研究。

---

## 6. Evidence 单独归位

当前 `docs/verification/` `docs/plan/` `*.jsonl` `manifest` `execution report` `authorization` 实际上已形成一套 Evidence System，但和项目文档混在一起。

目标形态：

```text
research/evidence/
  studies/
    c1/
    f0/
    f1/
    q5/
    compaction/
```

并逐步统一 schema：

```text
StudyManifest
ExperimentRun
ActionRecord
Observation
Outcome
EvidenceBundle
```

这样 Q5 / F1 / Compaction / Memory 只是不同 Study，而不是每次新建 `c1-f0-v2-final-bound-contract...` 这类专有结构。

> 注：本节是**目标形态**。现有历史归档不得为此迁移或改写，新 study 起按新结构落。

---

## 7. 目录重组的目标形态（分批执行，不是一次搬完）

```text
apps/
  canvas-agent/

packages/
  context-runtime-core/           ← universe / versions / durable-state / rehydration
  context-runtime-observation/    ← Context Observation + 轻量 instrumentation
  context-runtime-pi/             ← 第一个 adapter
  ...

research/
  context-lab/                    ← 设备
    core/ oracle/ replay/ instrumentation/
  studies/                        ← 实验
    archived/   c1/ f0/ f1/ q5/
    compaction-retention/          ← v0.4 主线
      benchmark/ harness/ experiments/
  evidence/                       ← 证据
    studies/
```

---

## 8. 什么时候才真正拆 GitHub 仓库

满足以下 **≥3 条**时才拆：

1. Canvas Agent 之外出现**第二个真实 consumer**（Pi / Codex / OpenCode 直接接 Runtime）；
2. `ContextRuntime` public API 稳定到连续几个迭代基本不变；
3. Runtime 可独立 build / test / release；
4. Context Lab 已能把 Runtime 当**黑盒**测试，而不是访问内部实现。

拆分后的目标：

```text
EchoTouch-moon/context-runtime    ← 可能最终最有价值的仓库
EchoTouch-moon/context-lab
EchoTouch-moon/canvas-agent
```

**现在拆仓库会立刻进入**：runtime 改接口 → lab 升级 → canvas-agent 升级 → 三仓发版本 → compatibility matrix → CI coordination。**这里没有一毛钱研究价值。**

---

## 9. 落地顺序建议（不授权，仅排序）

| 步 | 动作 | 风险 |
|---|---|---|
| 1 | **依赖方向规则生效**（§3）+ 在 CI/评审里加检查 | 零代码改动 |
| 2 | 新建 study 按 `studies/` + `evidence/` 新结构落；旧归档不动 | 零风险 |
| 3 | `context-lab/` 从 `context-benchmarks/` 抽通用件（§5 左表） | 需保证 Q5 可重放性 |
| 4 | Runtime Core 抽出 `packages/context-runtime-*` | 需第二个 consumer 信号 |

---

## 10. 一句话总结

> **先拆职责，再拆代码，最后才拆仓库。**
> 当前这一刀拆的是"产品 / 核心技术 / 研究基础设施 / 历史与当前实验"这四件事，
> 不是三个 GitHub repo。
