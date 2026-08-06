# Canvas Agent 产品定义与 MVP

## 1. 产品一句话

> 面向独立开发者和 1～5 人小团队的本地优先 AI 编程项目控制系统，通过结构化项目事实、版本化上下文和可追踪执行，保持长期演化项目的意图、设计与代码一致。

## 2. 产品不是什麽

- 不是一个以无限 Canvas 为中心的 Agent 拖拽编排工具；
- 不是普通聊天记录管理器；
- 不是 Jira、Linear 等通用项目管理工具的简单替代；
- 不是一次性从提示词生成代码的脚手架；
- 不是要求用户手工维护完整知识图谱的负担。

## 3. 核心用户

- 频繁使用 Codex、Claude Code、Cursor 等编程 Agent；
- 经常从个人 Idea 发起项目；
- 在多轮修改中遇到上下文丢失和项目偏移；
- 希望知道 Agent 看过什么、做过什么、为什么这样做；
- 需要长期迭代，但不需要复杂企业流程。

## 4. 关键价值

### 4.1 项目事实显式化

把 Idea、Goal、Requirement、Constraint、Design、Decision、Component 转化为可引用、可版本化的项目事实。

### 4.2 上下文选择权

用户可以查看系统推荐、手动加入或排除内容，冻结一次执行所用的 ContextSnapshot。

### 4.3 项目演化一致性

通过 Baseline N → Task → Snapshot → Run → Artifact → Baseline N+1，保持需求、设计、代码和测试的可追踪关系。

### 4.4 执行可恢复和可审计

Worker 可以替换，任务定义、上下文、代码基础、执行结果和审批均由外部状态系统持有。

## 5. 项目生命周期

```text
Genesis：从 Idea 形成目标、范围、约束和验收标准
Bootstrap：形成初始设计、仓库和第一次实现
Evolution：新增需求、重组上下文、执行变更、形成新基线
```

## 6. MVP 验证问题

MVP 要回答：

1. 用户是否愿意把关键项目事实组织为少量 Node；
2. Context Composer 是否比直接向 Agent 提交任务更可控；
3. Snapshot 是否能支持复现和对比；
4. Agent 修改是否能追溯到任务、事实和代码版本；
5. 项目从 1.0 演化到 1.1 时，旧目标和约束是否仍被保留；
6. 用户是否能在不过度维护系统的情况下完成闭环。

## 7. MUSICDB 演示

### 7.1 第一版

- Song、Note、Tag；
- 歌曲列表、详情、Markdown 笔记、搜索；
- 建立初始 Baseline；
- Worker 生成第一版代码和测试结果。

### 7.2 第一次演化

新增 RecordingVersion，并将 Note 分为：

- `SONG_SCOPE`：所有录音版本共享；
- `VERSION_SCOPE`：仅属于某个录音版本。

这次变化必须联动数据模型、迁移、API、UI、查询和测试，用于验证影响分析、上下文推荐和基线更新。

## 8. MVP 成功标准

- 可以从 Idea 形成结构化初始项目事实；
- 可以冻结可预览的 ContextSnapshot；
- 可以用一个 Worker 在隔离工作区完成第一版和一次变更；
- 可以查看 Diff、测试结果和 Agent Summary；
- 可以将被接受的变化形成新 Baseline Draft；
- 可以回答某次 Run 使用了什么需求、上下文和代码版本；
- 整个流程无需依赖全局 Canvas。
