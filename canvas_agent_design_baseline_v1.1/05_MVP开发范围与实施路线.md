# Canvas Agent MVP 开发范围与实施路线

## 1. 当前开发判断

核心领域边界、状态机、ContextSnapshot 和 ExecutionRequest 已经足够支持原型开发。现在不继续一次性设计所有执行细节。

开发方法：

```text
固定高成本边界
→ 实现最薄闭环
→ 获取真实数据
→ 在对应模块开发前完成细节设计
```

## 2. MVP 必须验证的闭环

```text
Project / Node / Edge
→ Baseline
→ Task / TaskSpecVersion / AcceptanceCriterion
→ ContextSnapshot
→ Run / ExecutionRequest
→ 单一 Worker
→ 隔离工作区 Diff + Test
→ Artifact Review
→ Baseline Draft
```

## 3. MVP 功能范围

### 3.1 项目知识

- 创建 Project；
- 创建和编辑七种 Node；
- NodeDraft 与手动保存 NodeVersion；
- 创建七种 Edge；
- 项目大纲；
- 创建和激活 Baseline。

### 3.2 任务规划

- TaskDraft；
- BOOTSTRAP_PROJECT、IMPLEMENT_CHANGE；
- TaskTarget；
- AcceptanceCriterion；
- Task 状态和简单依赖。

### 3.3 Context Composer

- 从 TaskTarget、Baseline、Edge 和代码路径生成候选；
- 用户增删、固定和查看理由；
- NodeVersion / Revision 锁定；
- Token 估算和基础冲突检查；
- Snapshot 预览与冻结。

### 3.4 执行

- 创建 Run；
- 构建 ExecutionRequest；
- 一个本地 Worker 适配器；
- 隔离 Git Worktree；
- 最小 ToolPolicy；
- 生成 Patch、测试结果和 Agent Summary。

### 3.5 评审

- 查看 Diff；
- 查看测试报告；
- 手工评估 AcceptanceCriterion；
- 接受或拒绝结果；
- 完成 Task；
- 生成 Baseline Draft。

## 4. 风险原型

### 原型 A：Context Composer

目标：证明结构化项目事实和可控上下文能提高 Agent 执行质量。

最小测试：

- 同一 Task；
- 同一代码 Revision；
- 对比直接提示、系统推荐 Snapshot、用户调整 Snapshot；
- 比较结果完整性、测试通过率、人工修正次数和 Token。

### 原型 B：Worker 执行闭环

目标：证明应用可以用不可变请求驱动可替换 Worker。

```text
ExecutionRequest
→ 创建 Worktree
→ 启动一个 Agent CLI
→ 修改代码
→ 运行测试
→ 导出 Patch / Summary
→ 应用层保存结果
```

第一版不要求真正实现跨进程 Checkpoint 恢复。

## 5. 推荐阶段

### 阶段 0：页面骨架和技术 ADR

- 画核心流程；
- 完成低保真界面；
- 确定桌面/本地服务形态、数据库、Git 工作区和 Worker 接入方式。

### 阶段 1：项目事实与任务

- Project、Node、NodeVersion、Edge；
- Baseline；
- Task、TaskSpecVersion、AcceptanceCriterion；
- 大纲和对象工作区。

### 阶段 2：Context Composer 原型

- 候选推荐；
- 手动选择；
- Snapshot 冻结；
- Snapshot 对比和预览。

### 阶段 3：单 Worker 执行闭环

- Run、ExecutionRequest；
- 隔离 Worktree；
- Patch 和测试；
- 最小 Artifact Review。

### 阶段 4：MUSICDB 0 → 1 → 1.1

完整演示初始生成和第一次需求演化。

### 阶段 5：根据数据补齐执行协议

再设计 RunEvent、ToolInvocation、Checkpoint、Artifact 生命周期和完整 Approval。

### 阶段 6：局部关系图

闭环稳定后实现一跳关系、影响分析和关系过滤。

## 6. MVP 不做

- 无限全局 Canvas；
- 图数据库；
- 全仓库向量化；
- 多人实时编辑；
- 多 Agent 自主分工；
- 分布式 Worker 集群；
- 完整恢复引擎；
- 企业权限、计费和审计后台；
- 自动激活 Baseline；
- 自动接受 Agent 提出的 Edge 和 NodeVersion。

## 7. 开发门槛

进入正式开发前只需再确认：

1. 最小技术架构；
2. MVP 页面线框；
3. 第一个 Worker 适配对象；
4. MUSICDB 演示仓库的初始技术栈；
5. 本地数据和 Blob 存储位置。

其余细节不作为开工阻塞条件。
