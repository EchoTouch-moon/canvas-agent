# Task Plan: Canvas Agent 首版核心闭环与开发基线

## Goal
从现有设计资料中收敛首版核心闭环，搭建可运行、可验证、可协作的工程基线，并形成 GPT-5.6 Luna 与 DeepSeek V4 Flash 可直接领取的任务包；初始化 Git 并在具备远端地址与权限时完成推送。

## Scope Classification
- 核心功能：项目资料审计、MVP 核心闭环、工程骨架、质量门禁、协作规范、首批任务分配、Git 初始化与远端发布。
- 增强功能：只记录候选，不在本轮实现。
- 未来方向：只保留在路线图或 backlog。
- 灵感仓库：不进入当前开发排期。

## Phases
- [x] Phase 1: 审计全部设计资料、视觉参考和当前环境
- [x] Phase 2: 决定首版核心闭环、技术栈与系统边界
- [x] Phase 3: 搭建可运行开发框架、工程约束与质量门禁
- [x] Phase 4: 编写 Luna/DeepSeek 分工与可执行工单
- [ ] Phase 5: 验证、初始化 Git、提交并推送远端
- [ ] Phase 6: 完成交付文档与复核

## Key Questions
1. 用户第一次完成的最短价值闭环是什么？
2. 哪些能力是首版必需，哪些必须延期？
3. 视觉基线如何转化为可复用设计 token 与组件约束？
4. 两个模型如何按“视觉/无视觉”边界分工并减少文件冲突？
5. 当前是否已有可用远端地址、GitHub 凭据和仓库创建权限？

## Decisions Made
- 使用现有 `canvas_agent_design_baseline_v1.1` 作为唯一产品事实源；新增想法先分类，不自动进入实现。
- GPT-5.6 Luna 负责视觉资料审计；DeepSeek V4 Flash 当前不可调用，改为输出仓库内可直接执行的任务包。
- 首版只实现可追溯闭环：`Project/Node/Edge → Baseline → Task/TaskSpecVersion/AcceptanceCriterion → ContextSnapshot → Run/ExecutionRequest → 单 Worker 隔离 worktree → Diff/Test/Artifact 评审 → Baseline Draft → 用户激活`。
- 技术基线为 pnpm TypeScript workspace、Electron + electron-vite + React、Zod、SQLite/Drizzle、内容寻址 Blob 目录与 Git。
- Renderer 无 Node 权限；Main 持有特权适配器；未来 Worker 进入 Utility Process，外部 CLI 禁用 shell 字符串调用。
- Wave 1 允许 Luna 与 DeepSeek 并行且文件独占；Wave 2 必须在第一波合并后开始。

## Errors Encountered
- `create_goal` 返回已有 active goal：沿用现有目标，不重复创建。
- 当前目录不是 Git 仓库：在完成资料审计与骨架搭建后初始化。
- `pnpm create @quick-start/electron` 首次停在交互式包名确认并退出，未生成文件：改用 PTY 完成交互。
- Electron 脚手架不会递归创建父目录，因缺少 `apps/` 返回 ENOENT：先创建父目录后重试。
- shadcn CLI 的 Rhea 参数是 `--preset rhea`，不是 `base-rhea`：组件底层通过 `--base base` 单独指定。
- Electron 项目不是标准 Vite 根目录，shadcn CLI 无法自动识别：按官方 manual installation 配置 `components.json`、Tailwind v4 与依赖。
- pnpm 11 移除了 `onlyBuiltDependencies` 并用 `allowBuilds`：显式允许 Electron/esbuild，拒绝当前不需要的 electron-winstaller 构建脚本。
- pnpm 配置变化后无 TTY 不允许自动重建 `node_modules`：在验证安装时使用 `CI=true` 进行确定性重建。
- pnpm 11 会在脚本前自动校验并尝试重装依赖，且继承本机失效镜像：设置 `verifyDepsBeforeRun: false`，团队统一显式运行 frozen install。
- pnpm 11 默认会联网复核整个 lockfile 的发布时间：保留 `minimumReleaseAge: 1440`，并对经审查提交的 frozen lockfile 设置 `trustLockfile: true`，避免离线/CI 重复联网。
- GitHub CLI 当前账号 `EchoTouch-moon` 的凭据失效；本地仓库与首个提交不受影响，但创建/推送远端需要重新登录。
- Playwright CLI 不在本机缓存，网络额度又无法下载；内置浏览器同时禁止本地端口与 `file://`，因此运行时视觉截图未执行，不能标记为已通过。
- 工作区策略把 `/Users/v/Documents/V/.git` 设为只读；`git init -b main` 的权限申请因当前额度上限被拒绝，不能绕过。源代码和验证产物已完成，但 Git 初始化/提交/推送仍待执行。

## Status
**Currently in Phase 5** - Node 24 下的 frozen install 与完整质量门禁已通过；真实浏览器视觉复核受运行环境限制，Git 初始化受 `.git` 写权限限制，远端发布还需要有效 GitHub 身份。
