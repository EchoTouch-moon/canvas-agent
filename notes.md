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

## 2026-08-10 takeover and DS-006 audit

- 用户已将 DS-006、UI-003、DS-007 的剩余实现与门禁全权交给首席架构师；执行顺序保持 DS-006 → UI-003 → DS-007。
- `main@8ecb08f` 已包含 PR #9 / DS-005，Node 24 下 409 tests + build 连续两次通过。
- DS-006 不需要新 IPC、公共契约或数据库形状；现有 `workspace.*`、`agent.*`、Project/NodeVersion/Baseline/Task/TaskSpec 命令足够完成 PROPOSAL-029。
- Renderer 当前差距：`App.tsx` 默认 Fixture 且暴露切换器；`useWorkspace` 只做 Project 水合并会在错误时丢掉稳定视图；没有 workspace/agent 生命周期模型、无 seed onboarding、dirty revision overlay 或完整 dispatch prerequisites。
- 最小实现路线：新增纯 lifecycle/onboarding selectors + runtime reducer/hook；扩展 typed client；用现有 primitive 组成中性表单；只在 `live-workspace-view.tsx` 增加窄接线；API fake 覆盖状态、竞态和每个持久步骤的失败恢复。
- 视觉层不会提前启动。DS-006 合并并冻结 view-model seam 后，再接任 UI-003 并做真实 light/dark、1080×720、1440×960 QA。

## 2026-08-10 DS-006 merge gate

- PR #10 已在 `main@19c0690` 合并；功能提交 `d34366a`，Live restart 回归修复 `84c7d0e`。
- 最终 Node 24 `pnpm check`：469 tests + build 全绿；GitHub `check` 与 `macos-electron` 均通过。
- Live E2E 证实首次执行、验收、采纳，以及同 userData 重启后的 Run/证据/应用/候选 Baseline/显式激活全部持久。
- E2E 发现并修复“已有 ACTIVE Baseline 时把后续候选 DRAFT 当成首次引导 DRAFT”的 P1 selector 顺序问题。
- UI-003 现已解锁；其边界严格限制为视觉组件、语义文案、主题、无障碍和截图 QA，不得修改 DS-006 hooks/reducer/lib 状态逻辑。

## 2026-08-10 UI-003 merge gate

- PR #11 已在 `main@97b9c78` 合并；功能提交 `b2db993`，GitHub `check` 与 `macos-electron` 均通过。
- Node 24 `pnpm check`：470 tests + build 全绿；真实 Live E2E 完成 Run → Acceptance → Apply → DRAFT Candidate → 重启 → 显式激活。
- 视觉验收覆盖 18 个精确尺寸场景，包括 no-workspace/opening/error/ready/switch-blocked、Agent auth、First Project、First Task、TaskSpec、DRAFT Baseline 与 dirty/read-only；Luna QA 和独立代码复审均为 CLEAN。
- 键盘路径 `Choose repository → READY → Task title → Create task`、横向溢出、控件裁切和状态公告均由 Electron harness 自动断言。
- DS-007 现已解锁；预检确认剩余缺口只在确定性 RC 编排、采纳幂等证明、Agent smoke 报告、CI artifacts/audit 与发布文档，不需要修改生产架构。

## 2026-08-11 DS-007 merge and Product MVP decision

- PR #13 已在 `main@38820ec` 合并；功能提交 `28de779`，GitHub Actions run `31450943361` 的 `check` 与 `macos-electron` 均通过。
- 最终 Node 24 `pnpm check`：470 tests + build 全绿；credential-free `pnpm e2e:rc` 4/4 场景通过。
- 打包态验证覆盖原生仓库选择、Agent executable picker、`READY / USER_SELECTED / codex-cli 0.146.0`、隔离 userData 与 packaged migrations/cold start。
- 完整闭环验证覆盖 Run → Acceptance → Completion → Apply → DRAFT Candidate → 显式 Activate；exact-binding apply retry 不新增 Git commit 或 RepositoryRevision，激活后第三次启动仍保留 Run、Application 与 ACTIVE Baseline。
- 真实 Codex smoke 报告为 `executed=1`，六项非敏感 checks 全为 true；production dependency audit 无已知 high/critical 漏洞。
- 代码审查 CLEAN；最终 gate review 的 AC-9 已关闭，AC-2 由远端 macOS CI 关闭。所有 Product MVP v0.2 P0/P1 release gates 已关闭。
- 首席架构师决定：Product MVP v0.2 对 local/internal unsigned use 正式完成。外部签名/公证归为后续分发项，不阻断本次里程碑。
- 用户调整后的后续方向已在 PR #12 明确为 Context Runtime v0.3 研究。首席架构师将其归类为 Future direction：可以合并方向/实验/工单文档，但不得因文档合并自动启动实现。

## 2026-08-11 PR #12 Context Runtime direction review

- 方向基线：Pi 作为首个开放研究 harness，OpenCode 作为第二实现/原生上下文基线，Codex 作为较晚的兼容性目标；Context Runtime 核心保持 Agent/provider 中立。
- 首个候选工单 DS-008 仅做 model-call Shadow observation，不改写上下文、不改生产 SQLite/Desktop/Worker/冻结 v0.2 契约。
- 外部事实已按上游固定提交复核：Pi `cd6852a123f2c0cc646a41a2a52f3711a603b822`（`@earendil-works/pi-coding-agent` `0.84.1`），OpenCode `d041eee55c4b669f583fcbe0eb73e78d53393ae8`。
- 研究实现仍受用户范围门约束；PR #12 合并本身不等于授权 DS-008 开工。

## 2026-08-12 CR-005 Luna takeover

- PR #25 merged at `main@13d3b9087c980296e92eba91958d89c877cd40d8`; implementation branch `agent/luna-cr-005-native-shadow-corpus` is checked out.
- DS-013 is accepted/merged; CR-004 implementation and first Active experiment remain `NO_GO`.
- CR-005 scope is research-only: six deterministic Git-backed fixtures, manifests, objective oracles, Native/Shadow-safe orchestration metadata, telemetry aggregation and verification evidence.
- No renderer, provider payload rewrite, Dynamic/Active mode, Policy V0 change, production contract, persistence schema or OpenCode/Codex integration is authorized.
- Current local baseline has no benchmark/corpus directory. The first implementation phase is API inspection plus deterministic fixture/harness design.

## 2026-08-12 CR-005 implementation progress

- Added six versioned fixture/reference pairs under `research/context-benchmarks/corpus/` and six strict manifests with fixed Git commit/tree/state hashes.
- Added objective `node --test` oracles, deterministic fixture materialization, Native/Shadow metadata types, order-independent aggregation, false-removal candidate derivation, and explicit opt-in Pi live runner.
- Credential-free validator passes: all six known-bad fixtures fail, all six known-good references pass, and repeated identities reproduce exactly.
- Package typecheck passes; package tests pass (7 tests). Verification artifact is `docs/verification/context-runtime-cr-005-native-shadow-corpus.md` with verdict `HARNESS_ONLY` because no provider calls were made.
- One environment issue was encountered: the sandbox denied the `tsx` CLI temporary IPC pipe; direct Node 24 + tsx loader ran the validator successfully. Dependency installation required the approved escalated network retry after the sandbox registry DNS failure.
- Next step is final root checks and commit/handoff. No CR-004 authorization or Active evidence is inferred.
