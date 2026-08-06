# Notes: Canvas Agent 项目发现与决策依据

## Local Sources

已完整审计 `canvas_agent_design_baseline_v1.1` 内的产品、领域、架构、流程、MVP、ADR、UI 基线、延期项、冲突处理说明与 4 张视觉参考图。主基线的普通文件名与 URL 编码副本内容哈希一致。

## Synthesized Findings

### 当前环境
- 工作目录：`/Users/v/Documents/V`
- Git：尚未初始化；完成最终门禁后建立 `main` 与首个基线提交
- 资料目录：`/Users/v/Documents/V/canvas_agent_design_baseline_v1.1`
- 视觉参考：4 张 1448×1086 PNG

### 产品语义
- Node 不等于 Task，Task 不等于 Run，Run 成功不等于 Task 完成，Task 完成不等于 Baseline 生效。
- Canvas 只是事实投影，不是事实源；审批记录与审批消费必须区分。
- MUSICDB 只作为 0→1→1.1 的演示数据，不能写死到核心模型。

### MVP 核心闭环
`Project/Node/Edge → Baseline → Task/TaskSpecVersion/AcceptanceCriterion → ContextSnapshot → Run/ExecutionRequest → 单 Worker 隔离 Git worktree → Diff/Test/Artifact 评审 → Task 完成 → Baseline Draft → 用户激活`

### 当前不实现
- 完整 Canvas、完整 Checkpoint/RunEvent/ToolInvocation 协议、多 Worker、多 Agent 自主协作、实时多人协作、向量化与企业能力。
- 这些属于增强或未来方向，均不是首版价值闭环的必要组成。

### 视觉结论
- 调性：中性、致密、桌面工作台；深墨色正文、克制靛蓝、边框优先于阴影、紧凑 badge、键盘优先。
- 主结构：约 260px 左导航 + 弹性中区 + 约 280px 右检查器；窄屏隐藏检查器并折叠导航。
- 参考图里的伪 2025 数据、Share 多用户、完整工具详情、完整图谱、Node/Task/Document 混合仅是视觉素材，不进入产品事实。

### 工程决策
- Electron + electron-vite + React 19 + TypeScript；Base UI/shadcn Rhea/Tailwind v4 建立组件和 token 基线。
- Renderer sandbox + context isolation + no Node；preload 只暴露窄接口；Main 校验 IPC 来源和 payload。
- SQLite 保存应用事实，SHA-256 内容寻址目录保存 Blob，Git 对代码保持权威。
- Worker 后续置于 Utility Process；一个 Run 只允许一个 Worker 与一个隔离 worktree。

### 协作与发布
- Luna 独占 Renderer UI 文件；DeepSeek 首波独占 persistence，次波独占 worker-runtime；领域、契约、Main/preload 与 ADR 由首席架构师持有。
- `gh auth status` 显示 `EchoTouch-moon` token 无效；远端仓库与可见性尚未建立。
- `.git` 在当前沙箱中只读，权限申请又因环境额度上限被拒绝，尚未完成 Git 初始化。

### 验证结果
- Node 24.14.0：`pnpm install --frozen-lockfile --offline` 通过。
- `pnpm check`：format、lint、typecheck、test、build 全部通过。
- 测试：domain 5、contracts 2、desktop 1，共 8 个通过。
- 构建：Electron main、preload、renderer 均成功；renderer 转换 1836 个模块。
- 视觉运行时：未通过也未失败；Playwright CLI 缺失且本地浏览器 URL 策略阻止访问产物，需在可运行桌面环境补截图验证。
