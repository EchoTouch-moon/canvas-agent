# Canvas Agent 项目总设计基线

## Design Baseline v1.0

**文档状态：当前唯一主基线**  
**整理日期：2026 年 8 月 6 日**

---

# 1. 文档目的与适用范围

本文档统一描述 Canvas Agent 的产品定位、核心业务闭环、领域模型、上下文机制、执行边界、产品形态和 MVP 开发范围。

当历史材料与本文档冲突时，以本文档为准。具体字段、API、事件载荷和恢复算法尚未确认的部分，会明确标记为 `DEFERRED`，不得将早期报告中的示例自动视为最终实现规范。

---

# 2. 产品定义

## 2.1 正式定位【CONFIRMED】

Canvas Agent 是：

> **一个面向 AI 编程 Agent 用户的本地优先项目控制系统，陪伴软件项目从 Idea、初始规划和代码生成进入持续演化。系统通过结构化项目状态、版本化上下文、可追踪执行和可恢复任务，帮助独立开发者与小型团队在多轮 Agent 开发中保持项目意图、设计与代码的一致性。**

系统真正管理的不是一次聊天，也不是一张无限画布，而是一个长期演化的软件项目。

## 2.2 目标用户【CONFIRMED】

第一批目标用户为：

- 使用 Codex、Claude Code、Cursor 等 AI 编程工具的独立开发者；
- 1～5 人的小型开发团队；
- 从个人 Idea 出发，需要长期迭代项目，但不需要大型企业流程的用户。

产品优先本地使用、低维护成本和现有 Agent 协作，MVP 不建设复杂企业组织、细粒度团队权限或大规模协同体系。

## 2.3 核心问题【CONFIRMED】

产品解决五类问题：

1. **项目事实散落**：需求、设计、代码、文档和决定分散在聊天、Git、Issue 与个人记忆中；
2. **Agent 上下文不可控**：用户不知道本次执行读取了什么、遗漏了什么、使用了哪个版本；
3. **执行过程不可追踪**：生成结果只剩回复、文件变化和终端输出；
4. **长期任务难恢复**：Worker、进程或电脑中断后，需要重新解释任务；
5. **项目逐渐偏离**：多轮生成后，原始目标、设计决定、代码和测试逐渐失去一致性。

---

# 3. 核心原则

## 3.1 基础设施原则【CONFIRMED】

> **让执行者可替换，让状态可定位，让任务可恢复，让结果可追溯，让上下文可复现。**

进一步表达为：

```text
项目事实保存在 Node 与 NodeVersion 中。
阶段性正式状态保存在 ProjectBaseline 中。
一次执行的初始输入保存在 ContextSnapshot 中。
具体工作保存在 Task 中。
一次真实执行尝试保存在 Run 中。
恢复位置保存在 Checkpoint 中。
正式输出保存在 Artifact 中。
Worker 读取外部状态并产生新状态，不成为状态的唯一持有者。
```

整体架构原则：

> **无状态执行，有状态应用。**

## 3.2 产品原则【CONFIRMED】

1. 项目事实先于视图存在；
2. Canvas 不是项目本体，也不是项目数据容器；
3. 不是所有内容都要节点化；
4. Run 失败不等于 Task 失败；
5. Run 成功不等于 Task 完成；
6. Task 完成不等于项目正式接受变化；
7. Agent 可以提出事实、关系和修改，但不能静默将推测变成正式共识；
8. 所有历史版本和执行记录不得被静默覆盖；
9. 先验证任务闭环与上下文价值，再建设复杂 Canvas；
10. 任何视图都只是状态投影，不是权威状态本身。

---

# 4. 项目生命周期与 MVP 验证目标

## 4.1 生命周期【CONFIRMED】

```text
Project Genesis
Idea → 目标用户 → 核心场景 → 第一版范围 → 约束 → 验收标准

Project Bootstrap
形成初始设计 → 创建任务 → 创建或连接仓库 → 第一版 Run

Project Evolution
新增需求 → 事实产生新版本 → 重组上下文 → 新 Run → 验证 → 更新正式基线
```

## 4.2 MVP 验证目标【CONFIRMED】

MVP 不只验证 `Idea → 生成项目`，而要验证：

```text
Idea
→ 建立项目基线
→ 完成初始实现
→ 发生第一次真实需求变化
→ 重新组装上下文
→ 完成第二次开发
→ 保持前后项目一致
```

即验证：

> **0 → 1 → 1.1**

## 4.3 唯一演示场景：MUSICDB【CONFIRMED】

初始项目是个人音乐资料、听歌笔记与创作工作台，第一版包含歌曲管理、歌曲详情、Markdown 笔记和基础搜索。

第一次演化加入：

- 原版、Live、Remix 等录音版本；
- 歌曲级共享笔记；
- 版本级专属笔记；
- 旧数据迁移；
- 对数据模型、API、页面、查询和测试的联动修改。

MUSICDB 用于验证 Canvas Agent 的通用项目管理和 Agent 执行能力，平台自身不绑定音乐领域。

---

# 5. 核心业务闭环

## 5.1 主循环【CONFIRMED】

```text
ProjectBaseline N
        ↓
提出新需求或变化
        ↓
创建 Task
        ↓
确认 TaskSpecVersion
        ↓
组装并冻结 ContextSnapshot
        ↓
创建 Run
        ↓
生成 ExecutionRequest
        ↓
Worker 执行并产生 Artifact / Evaluation
        ↓
用户评审，Task 完成
        ↓
生成 ProjectBaseline Draft
        ↓
用户确认
        ↓
ProjectBaseline N+1
```

## 5.2 三个必须区分的判断【CONFIRMED】

```text
Run.outcome = SUCCEEDED
不代表 Task = COMPLETED。

Task = COMPLETED
不代表新事实已进入 Active ProjectBaseline。

Approval = APPROVED
不代表被批准的动作已经执行；动作执行后才是 CONSUMED。
```

---

# 6. 产品形态与信息架构

## 6.1 Canvas 的定位【CONFIRMED】

Canvas 是高级关系视图，适合：

- 关系探索；
- 上下游依赖；
- 影响分析；
- 上下文来源可视化；
- 子图规划；
- 多 Agent 分工展示。

Canvas 不适合：

- 日常任务处理；
- 长文档编辑；
- 执行时间线；
- 高密度比较；
- 默认展示整个大型项目。

## 6.2 多视图结构【CONFIRMED】

```text
项目
├─ 工作台：现在发生了什么，下一步做什么
├─ 大纲：项目由什么组成
├─ 任务：工作如何推进
├─ 对象工作区：当前 Node 或 Task 的完整工作面板
├─ 上下文：Agent 本次应该看到什么
├─ 关系地图：对象之间如何关联、修改会影响什么
├─ 执行记录：Agent 做了什么
├─ 产物：产生了哪些正式结果
└─ 项目设置
```

MVP 的主要工作入口是工作台、项目大纲、对象工作区、Context Composer 和简化的 Run 结果视图。局部 Canvas 后置于核心闭环。

---

# 7. 核心领域模型

## 7.1 总体结构【CONFIRMED】

```text
Project
│
├─ Node
│  ├─ NodeDraft
│  └─ NodeVersion
├─ Edge
├─ ProjectBaseline
│  ├─ BaselineNodeItem
│  └─ BaselineEdgeItem
├─ Task
│  ├─ TaskDraft
│  ├─ TaskSpecVersion
│  ├─ TaskTarget
│  ├─ AcceptanceCriterion
│  ├─ AcceptanceEvaluation
│  └─ TaskDependency
├─ ContextSnapshot
│  ├─ ContextSnapshotItem
│  └─ ContentBlob
├─ Run
│  ├─ RunEvent          [DEFERRED 详细协议]
│  ├─ ToolInvocation    [DEFERRED 详细协议]
│  ├─ Checkpoint        [DEFERRED 详细协议]
│  ├─ Artifact          [DEFERRED 生命周期]
│  └─ Approval
├─ ExecutionRequest
└─ SavedView
```

## 7.2 不设置强制 Graph 容器【CONFIRMED】

Node 与 Edge 直接属于 Project：

```text
项目逻辑图 = Project 下的 Node + Project 下的 Edge
```

`Graph` 不作为 MVP 必需业务实体。Canvas、项目大纲、追踪矩阵和影响分析是对同一批数据的不同投影。

## 7.3 Node 与 NodeVersion【CONFIRMED】

`Node` 表示长期稳定的语义身份。MVP 类型为：

```text
IDEA
GOAL
REQUIREMENT
CONSTRAINT
DESIGN
DECISION
COMPONENT
```

Task、Run、Artifact、聊天、工具调用、测试日志和普通代码文件不作为 Node。

`NodeDraft` 保存可变工作稿；`NodeVersion` 保存正式、不可变内容。Baseline 和冻结 Snapshot 只能引用 NodeVersion。

同一核心语义变化时创建新 NodeVersion；出现可独立存在和演化的新语义时创建新 Node。

## 7.4 Edge【CONFIRMED】

Edge 是 Node 之间的长期语义关系，不是 Canvas 视觉连线。MVP 类型：

```text
PARENT_OF
DEPENDS_ON
IMPLEMENTS
CONSTRAINS
SUPERSEDES
DERIVED_FROM
RELATED_TO
```

Edge 只连接 Node，可选锚定具体 NodeVersion。MVP 不引入 EdgeVersion；语义变化时创建新 Edge 并替代旧 Edge。

生命周期：

```text
PROPOSED → ACTIVE → NEEDS_REVIEW / SUPERSEDED / ARCHIVED
```

## 7.5 ProjectBaseline【CONFIRMED】

ProjectBaseline 表示某个阶段正式确认的项目共识，冻结：

- NodeVersion 集合；
- 当时有效的 Edge 集合；
- 可选 RepositoryRevision；
- 正式范围和验收信息。

状态：

```text
DRAFT → ACTIVE → SUPERSEDED
```

同一 Project 同一时刻只有一个 Active Baseline。Baseline 激活后不可修改。

## 7.6 Task 与验收【CONFIRMED】

Task 是具有明确目标、范围和验收标准的工作单元，不是 Node。

Task 具有稳定身份，正式定义保存为不可变 `TaskSpecVersion`，Run 必须绑定具体任务版本。MVP Task 类型：

```text
BOOTSTRAP_PROJECT
IMPLEMENT_CHANGE
```

AcceptanceCriterion 属于 TaskSpecVersion，描述结果而不是步骤；每个 Run 使用 AcceptanceEvaluation 保存本次验证结果。

TaskDependency 表示工作计划依赖，与 Node 的语义依赖严格分离。MVP 类型：

```text
HARD_BLOCK
SOFT_ORDER
```

---

# 8. 状态机

## 8.1 Task【CONFIRMED】

```text
DRAFT
→ READY
→ IN_PROGRESS
→ WAITING_REVIEW
→ COMPLETED

任一未完成状态 → CANCELLED
COMPLETED / CANCELLED → ARCHIVED
```

`BLOCKED` 与 `NEEDS_CHANGES` 是派生状态，不进入主状态机。

## 8.2 Run【CONFIRMED】

Run 分为生命周期和最终结果：

```text
status:
CREATED, QUEUED, PREPARING, RUNNING,
WAITING_INPUT, WAITING_APPROVAL,
PAUSED, INTERRUPTED, FINISHED

outcome:
SUCCEEDED, PARTIAL, FAILED, CANCELLED, TIMED_OUT
```

只有 TaskSpecVersion、ContextSnapshot、基础 RepositoryRevision、Agent 配置和执行目标不变，且存在有效 Checkpoint 时，才允许继续原 Run。FINISHED Run 不得重开。

## 8.3 Approval【CONFIRMED】

```text
PENDING
→ APPROVED → CONSUMED
→ REJECTED
→ EXPIRED
→ CANCELLED
```

Approval 必须绑定精确 Run、动作、参数 Hash 和 RepositoryRevision，默认单次使用。

---

# 9. ContextSnapshot

## 9.1 定义【CONFIRMED】

ContextSnapshot 是面向某个 TaskSpecVersion，从明确 Baseline 和 RepositoryRevision 出发，冻结的模型无关初始上下文包。

它只描述 Run 启动时看到的初始内容。运行中通过工具动态读取的文件和测试结果属于 ToolInvocation、RunEvent 或 Artifact，不回写旧 Snapshot。

## 9.2 强制绑定【CONFIRMED】

```text
project_id
task_id
task_spec_version_id
base_baseline_id
expected_repository_revision_id
```

RepositoryRevision 必须能表示基础 Commit 与未提交工作区 Diff，保证本地执行状态可复现。

## 9.3 Item 类型【CONFIRMED】

```text
NODE_VERSION
EDGE
REPOSITORY_CONTENT
ARTIFACT
USER_INPUT
PROJECT_RULE
```

冻结时同时保存来源引用、解析内容副本和内容 Hash，并通过 ContentBlob 去重。

## 9.4 上下文规则【CONFIRMED】

- Snapshot 模型无关，Run 保存针对具体模型的渲染结果；
- 内容具有权威层级：ProjectRule > TaskInstruction > ProjectFact > Evidence > Reference > UntrustedContent；
- 使用 P0～P3 Token 优先级；关键内容不能因预算不足被静默删除；
- 代码内容支持 FULL_FILE、SYMBOL、LINE_RANGE、DIFF、SUMMARY、METADATA；
- Primary Base 代码必须来自同一 RepositoryRevision；
- 冻结后不可修改，只能派生；
- 当前适用性为 CURRENT、STALE、DIVERGED、ARCHIVED。

---

# 10. ExecutionRequest 与 Worker

## 10.1 ExecutionRequest【CONFIRMED】

ExecutionRequest 是调度器交给 Worker 的不可变执行合同。

```text
Task = 要完成什么工作
Run = 一次执行尝试
ExecutionRequest = 本次交给 Worker 的执行合同
Worker Attempt = Worker 对该合同的一次领取和执行片段
```

一个 Run 可以因恢复、Approval 或 Worker 更换产生多个 ExecutionRequest。

请求必须绑定：

- Run；
- TaskSpecVersion；
- ContextSnapshot；
- RepositoryRevision；
- 可选 Checkpoint；
- Worker 能力要求；
- Agent 与模型配置；
- ToolPolicy；
- 工作区策略；
- 资源预算；
- Schema Version 与 Request Hash。

## 10.2 Worker 边界【CONFIRMED】

Worker Capability 表示环境能做什么；ToolPolicy 表示本次 Run 被允许做什么，二者必须分离。

MVP 默认使用隔离工作区，不允许 Agent 默认为用户原始工作区直接写入。ContextSnapshot 通过 Manifest 与 Blob 引用传递，Worker 必须校验请求完整性、代码版本、Schema、过期时间和领取状态。

## 10.3 尚未定稿【DEFERRED】

以下内容等实际开发对应模块时再设计：

- RunEvent 标准事件目录和载荷；
- ToolInvocation 幂等、输入输出与副作用协议；
- Checkpoint 的恢复粒度和持久化内容；
- Artifact 类型、接受、应用和回写流程；
- Worker 与 Codex、Claude Code 等具体适配协议。

---

# 11. MVP 范围

## 11.1 第一版闭环【MVP】

```text
创建 Project
→ 创建和编辑 Node / NodeVersion
→ 创建 Edge
→ 形成 ProjectBaseline
→ 创建 Task / TaskSpecVersion / AcceptanceCriterion
→ 组装 ContextSnapshot
→ 创建 Run 与 ExecutionRequest
→ 调用一个简单 Worker
→ 在隔离工作区产生 Diff 与测试结果
→ 查看并接受结果
→ 生成新的 Baseline Draft
```

## 11.2 第一版视图【MVP】

- 项目工作台的简化版；
- 项目大纲；
- Node / Task 对象工作区；
- Context Composer；
- Run 结果与最小时间线；
- Artifact 结果视图；
- Baseline Draft 评审；
- 局部关系展示可延后到闭环稳定之后。

## 11.3 暂不实现【OUT OF SCOPE】

- 完整无限 Canvas；
- 多人实时协作；
- 多 Worker 分布式调度；
- 完整 Checkpoint 恢复；
- 复杂企业权限；
- 自动关系推理；
- 全仓库向量化；
- 多 Agent 自主协作；
- 高级上下文实验与自动优化。

---

# 12. 当前开发策略

## 12.1 停止继续穷举设计【CONFIRMED】

核心语义和边界已经足以支持原型开发。后续采用：

> **高成本决策提前确定，依赖真实体验的实现细节在开发到相应步骤时再确认。**

## 12.2 开发前最后收口【NEXT】

1. 确定 MVP 核心用户流程；
2. 画出低保真页面骨架；
3. 确定最小技术架构；
4. 实现两个风险原型：
   - Context Composer：验证上下文选择是否真正提高 Agent 结果；
   - Worker Execution Loop：验证 ExecutionRequest → 隔离修改 → Diff/Test → Artifact 的闭环。

原型通过后，再根据真实执行数据设计 RunEvent、ToolInvocation、Checkpoint 与 Artifact。

---

# 13. 权威数据源

```text
产品与设计事实 → NodeVersion + Active ProjectBaseline
项目语义关系   → Edge + Active ProjectBaseline
代码事实       → Git / RepositoryRevision
任务定义       → TaskSpecVersion
任务状态       → Task
执行状态       → Run
初始上下文     → ContextSnapshot
执行请求       → ExecutionRequest
执行历史       → RunEvent
工具调用       → ToolInvocation
恢复位置       → Checkpoint
执行结果       → Artifact
显示配置       → SavedView
```

---

# 14. 当前设计不变量

1. 不允许用 Canvas 坐标表达业务关系；
2. 不允许历史 Run 自动读取“当前最新内容”；
3. 不允许覆盖已经被 Baseline、Snapshot 或 Run 引用的版本；
4. 不允许 Worker 自行选择未声明的任务版本、上下文或代码版本；
5. 不允许 Agent 静默把建议写成正式项目事实；
6. 不允许把工具动态读取内容写回旧 Snapshot；
7. 不允许将 Approval 的批准重复用于其他动作；
8. 不允许将一个失败 Run 等同于失败 Task；
9. 不允许在核心闭环未验证前优先开发复杂 Canvas；
10. 不允许早期示例字段覆盖本文档中已经确认的边界。

---

# 15. UI 设计与开发基线【CONFIRMED】

Canvas Agent 采用以下 UI 技术与设计组合：

```text
shadcn/ui
+ Base UI
+ Rhea
+ Tailwind CSS / CSS Variables
+ Lucide
+ TanStack Table
+ React Flow
+ Canvas Agent 领域组件
```

产品视觉定位为克制、紧凑、结构清晰的桌面生产力工作台。Canvas 不作为唯一主界面，默认采用 Sidebar、中央工作区和可收起 Inspector 组成的多面板布局。

UI 代码必须分为设计 Token、通用 UI 原语、应用级组合组件、领域组件和页面流程五层。业务页面不得绕开已有组件随意创建重复 Button、Badge、Dialog、状态色和间距规则。

首批 UI Foundation 使用 MUSICDB 数据验证 Project Dashboard、Outline、Node Workspace、Task Workspace、Context Composer、Run Timeline、Artifact Review 和 Baseline Review。完整规则见《10_UI设计与开发基线.md》。
