# Canvas Agent — 首席架构师工作笔记

## 2026-08-09 verified project state

### What is genuinely complete

- Git 与远端已建立，主分支干净且同步。
- Domain、Contracts、SQLite persistence、isolated worker、Electron Main/Preload/Renderer 的工程核心链路已合并。
- 已实现且 live E2E 覆盖：任务创建、执行、事件/产物、验收、完成、幂等采纳、RepositoryRevision 前进、候选 Baseline 创建和显式激活。
- Renderer 无 Node/fs/db/git/process 能力；特权操作经 runtime-validated IPC；Worker 使用 immutable ExecutionRequest 与隔离 worktree。

### What is not product-ready

1. 生产 UI 仍默认 Fixture，Live/Fixture 是显眼切换项。
2. 真实工作区依赖 `CANVAS_AGENT_REPO`，没有产品级仓库选择和运行时切换。
3. 新仓库 SQLite 为空，而 Live UI 只能读取 seed 项目，不能创建首个 Project/charter/Baseline/Task。
4. Worker 固定使用 `FixtureAgentAdapter`，并不执行真实 Agent。
5. ExecutionRequest v1 只携带 Snapshot/TaskSpec ID，不携带冻结内容；真实 Agent 无法从 opaque ID 得知任务，且 Worker 按边界不能查询 SQLite。
6. 打包应用找不到 Drizzle migrations，冷启动报 `ENOENT`。
7. 两个 execution coordinator 测试因跨进程时钟来源不同失败，当前不能声称 `pnpm check` 绿色。
8. CI 只运行 `pnpm check`，没有 live Electron E2E 和 packaged-app smoke。

### Evidence snapshot

- HEAD：`26ef285`
- Unit tests：244/246
- Live Electron E2E：pass
- Production dependency audit：0 known vulnerabilities at configured threshold
- Packaged launch failure：`Contents/Resources/app.asar` 下不存在解析器期待的 `/drizzle`
- Large UI modules：`core-flow-workspace.tsx` 2401 lines；`live-workspace-view.tsx` 1384 lines

## Product judgment

- 当前是“工程核心闭环完成”，不是“产品 MVP 完成”。
- Phase 5 Checkpoint/Resume 暂停。真实 Workspace 和真实 Agent 是更早、更关键的验证门。
- Canvas/Graph 不进入 v0.2；当前产品价值可先用既有工作台验证。
- 大型 UI 重构是 Enhancement。只在阻塞 Live-first 接入时做局部提取，禁止先开展全量重写。

## Architecture direction

### Workspace

- Main 通过原生文件夹选择器取得路径，Renderer 不提交任意绝对路径。
- Canonicalize 并验证目录是可访问的 Git worktree/repository，再创建运行时。
- v0.2 同时只允许一个 active workspace。
- dirty repository 可打开查看，但 execution/初始可执行 Baseline 必须阻断；应用不自动 stash/reset/commit。
- SQLite state 按 canonical repository identity 隔离，避免两个仓库共用应用状态。
- 切换必须按顺序停止 dispatch、dispose worker/coordinator/persistence，再原子打开新 workspace；失败时返回可诊断状态，不留下半初始化运行时。

### Real Agent CLI

- 先实现品牌无关 Runner，再实现第一个具体 Adapter。
- 新 dispatch 使用 ExecutionRequest v2：Main 将 FROZEN Snapshot 的有序 items 物化成 4 MiB/256 items 上限的 Context Bundle；Main 与 Worker 都验证逐项 hash、bundle hash 和 outer request hash。
- Finder 启动不能依赖终端 PATH。Main 负责 saved/PATH/known-location discovery，失败时用原生文件选择器；只持久化 launcher path，不做登录、不保存 secret。
- 进程调用必须 `shell: false`，参数数组化；限制 stdout/stderr 大小；支持 deadline、AbortSignal/cancel 和稳定错误码。
- 密钥只从进程环境或系统安全设施读取，SQLite、日志和 ExecutionRequest 不保存 secret。
- Agent 输出先在 Worker 信任边界解析为结构化结果；未经验证的 stdout 不能直接变成领域事件或命令。
- 移除生产环境硬编码的 `docs/phase2.md` 检查；v0.2 只运行 Worker-owned `git diff --cached --check`。仓库自定义命令在独立沙箱/授权设计前归类为 Enhancement。
- Fixture Adapter 只保留给测试和显式开发模式。

## Assignment principle

- DeepSeek 承担绝大多数实现，具体见 DS-003 至 DS-007。
- Luna 只在 DS-006 合并后领取 UI-003，一个工单完成视觉实现和 QA，避免多轮等待和重复返工。
- 公共契约、领域状态、数据库形状或安全边界变更必须先由首席架构师接受 Proposal/ADR。

## Decisions still requiring a factual answer

- 首个真实 Agent CLI：必须基于本机实际可用命令、版本与非交互接口确认，不能凭品牌名猜测。
- macOS 分发范围：内部可运行产物可以暂不签名；外部分发需要 Developer ID 与 notarization，二者验收不同。

## Source of truth

- Master plan：`docs/PRODUCT_MVP_V0.2_PLAN.md`
- Scope：`docs/product/scope-register.md`
- Work board：`docs/tasks/README.md`
- Task packets：`docs/tasks/deepseek/DS-003...DS-007` 与 `docs/tasks/luna/UI-003...`
