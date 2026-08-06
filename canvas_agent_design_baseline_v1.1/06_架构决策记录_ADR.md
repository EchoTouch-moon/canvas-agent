# Canvas Agent 架构决策记录（ADR）

## ADR-001：产品不是 Canvas 编排器

**状态：ACCEPTED**

决定：产品定义为本地优先 AI 编程项目控制系统；Canvas 是高级关系视图。

原因：无限画布不适合日常任务、时间线、长文档和高密度比较，容易让用户管理画布而不是管理项目。

后果：主要界面使用工作台、大纲、对象工作区、Context Composer 和 Run 视图。

---

## ADR-002：Project 不拥有强制 Graph 容器

**状态：ACCEPTED**

决定：Node、Edge 直接属于 Project；逻辑图由项目内 Node + Edge 构成。

原因：Node 应能脱离某张 Canvas 独立存在，同一批事实需要被多个视图复用。

后果：SavedView 只保存显示配置，删除视图不删除事实。

---

## ADR-003：不是所有对象都节点化

**状态：ACCEPTED**

决定：MVP Node 类型限定为 IDEA、GOAL、REQUIREMENT、CONSTRAINT、DESIGN、DECISION、COMPONENT。

原因：Task、Run、代码文件和事件有自己的权威系统，全部节点化会制造重复事实和图谱噪声。

---

## ADR-004：Node 身份与不可变版本分离

**状态：ACCEPTED**

决定：Node 表示稳定身份，NodeDraft 表示工作稿，NodeVersion 表示不可变正式内容。

原因：需要还原历史 Baseline 和 Snapshot，同时避免每次输入字符产生版本。

---

## ADR-005：Edge 是不可变语义断言

**状态：ACCEPTED**

决定：Edge 连接 Node，可选锚定 NodeVersion；MVP 不设置 EdgeVersion。

原因：仅连接 NodeVersion 会造成关系爆炸；建立 EdgeVersion 会过早复杂化模型。

---

## ADR-006：Baseline 与 Snapshot 分离

**状态：ACCEPTED**

决定：Baseline 表示阶段性项目共识；Snapshot 表示一次执行的冻结初始输入。

原因：正式项目状态与某个任务实际需要的局部信息具有不同生命周期、权威和范围。

---

## ADR-007：Task 与 Run 分离

**状态：ACCEPTED**

决定：Task 是工作目标，Run 是一次执行尝试。Run 失败不会自动使 Task 失败。

原因：同一个任务可以有多次失败、重试、对比或重做。

---

## ADR-008：Task 定义也需要不可变版本

**状态：ACCEPTED**

决定：Run 绑定 TaskSpecVersion，而不是只绑定 Task。

原因：任务范围和验收条件可能在多次执行间变化，必须知道每次 Run 当时完成的具体任务定义。

---

## ADR-009：Snapshot 只保存初始上下文

**状态：ACCEPTED**

决定：运行中动态读取的文件和工具结果不修改 Snapshot。

原因：Snapshot 必须保持不可变；完整执行视野由 Snapshot + Run 事件共同还原。

---

## ADR-010：Snapshot 保存内容副本和 Hash

**状态：ACCEPTED**

决定：冻结时除来源引用外，还保存解析内容与内容 Hash，使用 ContentBlob 去重。

原因：路径、Git 对象或外部文件可能失效，单纯引用不足以保证复现。

---

## ADR-011：Run 使用 status 与 outcome 两个维度

**状态：ACCEPTED**

决定：status 表达执行生命周期，outcome 表达执行结果。

原因：Worker 正常完成但测试失败时，执行生命周期已结束，但结果没有达到目标。

---

## ADR-012：Approval 与输入、验收分离

**状态：ACCEPTED**

决定：普通问题使用 Input Request，结果判断使用 AcceptanceEvaluation，高风险动作授权使用 Approval。

原因：三者语义、风险和生命周期不同。

---

## ADR-013：ExecutionRequest 是不可变执行合同

**状态：ACCEPTED**

决定：Worker 不直接读取整个应用数据库自行推断任务，而只执行标准化 ExecutionRequest。

原因：保证执行可校验、可重放、可切换 Worker，并减少 Worker 对应用内部模型的耦合。

---

## ADR-014：Capability 与 ToolPolicy 分离

**状态：ACCEPTED**

决定：Worker 声明自身能力，本次请求通过 ToolPolicy 限定实际权限。

原因：环境能够执行某项操作，不代表每个 Run 都应拥有该权限。

---

## ADR-015：默认使用隔离工作区

**状态：ACCEPTED / MVP**

决定：Worker 默认在 Git Worktree 或独立副本中修改，结果以 Diff / Patch 形式评审。

原因：避免 Agent 直接破坏用户工作区和未提交修改。

---

## ADR-016：停止继续穷举底层设计

**状态：ACCEPTED**

决定：RunEvent、ToolInvocation、Checkpoint 和 Artifact 详细协议，等开发到对应模块并获得真实数据后再定。

原因：这些结构高度依赖实际 Agent CLI、工具调用方式和用户评审体验，过早定死会增加返工。

---

## ADR-017：采用 shadcn/ui 作为 UI 基础体系

**状态：ACCEPTED / MVP**

决定：Canvas Agent 使用 shadcn/ui + Base UI + Rhea 作为基础组件和视觉基线，使用 Tailwind CSS / CSS Variables 管理 Token，Lucide 作为统一图标，TanStack Table 提供复杂表格逻辑，React Flow 用于局部关系图。

原因：该组合同时提供成熟默认审美、组件源码所有权、可访问交互原语、AI 编码友好度和深度领域定制能力，且不会将产品锁定为传统企业后台或强品牌化组件库。

约束：shadcn/ui 只提供组件与视觉基础，不能替代 Canvas Agent 的信息架构和用户流程。业务页面必须通过领域组件层复用状态与交互规则，Canvas 只用于关系探索、上下文来源和影响分析。
