# Canvas Agent — Product MVP v0.2 收口计划

## Goal

把已经跑通的工程核心闭环收口为可交付的产品 MVP：用户无需环境变量即可选择本地 Git 仓库，在默认 Live 工作区中创建并执行任务，至少通过一个真实本地 Agent CLI 产出变更，完成验收、采纳、候选 Baseline 创建与显式激活，并且打包后的 macOS 应用能冷启动完成同一条主链路。

详细执行基线：`docs/PRODUCT_MVP_V0.2_PLAN.md`

## Scope decision

- **Core**：确定性时钟、打包迁移资源、真实仓库选择与运行时切换、真实 Agent CLI、Live-first UI、发布候选质量门。
- **Enhancement**：大文件拆分、前端包体优化、开发者诊断面板、第二个 Agent Provider。
- **Future direction**：Checkpoint/Resume、Canvas/Graph、多 Provider 编排、远程协作。
- **Idea repository**：自治多 Agent 团队、云端执行、插件市场。

## Architecture decisions required before implementation

1. Workspace Runtime Manager 与单活动仓库生命周期。
2. 工作区路径信任边界、持久化与仓库隔离的 SQLite 目录策略。
3. Provider-agnostic Local CLI Adapter v1 的进程、超时、取消、输出和错误契约。
4. ExecutionRequest v2 必须携带由 FROZEN Snapshot 物化、逐项和整体哈希绑定的 Context Bundle。
5. Agent 可执行文件由 Main 自动探测或原生选择器选择；Renderer 不提交路径，应用不保存凭据。
6. Fixture 模式只允许在测试或显式开发开关中启用。

## Execution waves

### Wave 0 — 首席架构师冻结接口

- [x] 写并接受 Workspace Runtime Proposal。
- [x] 冻结 Workspace path-free Command/Zod 契约附录。
- [x] 写并接受 Local CLI Adapter Proposal。
- [x] 冻结 ExecutionRequest v2 Context Bundle 契约附录。
- [x] 冻结打包态 Agent executable discovery / readiness 契约。
- [x] 冻结 Workspace 与 Agent readiness 新增 Command 的意图、Zod shape 和错误语义；实现若需新增字段必须停下复审。
- [x] 确认首个真实 CLI：本机 `codex-cli 0.146.0`，支持 `codex exec`/JSONL/output schema；具体 argv fixture 仍须评审。

### Wave 1 — DeepSeek：P0 发布可靠性

- [x] DS-003：修复跨进程时钟不一致导致的 2 个单测失败。
- [x] DS-003：将 Drizzle migrations 纳入打包资源并使用 production-safe 路径解析。
- [x] DS-003：增加 packaged-app 冷启动 smoke 与 CI 质量门。

退出条件：`pnpm check` 全绿；unpacked 应用在隔离 userData 下启动无 migration ENOENT。

### Wave 2 — DeepSeek：真实工作区与真实 Agent

- [x] DS-004：实现 Main-owned 仓库选择、校验、最近工作区与 Workspace Runtime Manager。
- [x] DS-005A：实现 Provider-agnostic Local CLI Runner，不绑定具体品牌。
- [x] DS-005A：实现 ExecutionRequest v2 Context Bundle 的 Main 物化与 Worker 双重验证。
- [x] DS-005B：在 Codex argv/schema fixture 评审后实现真实 Provider 绑定和端到端用例。

退出条件：不设置 `CANVAS_AGENT_REPO` 也能选择仓库；真实 CLI 能在隔离 worktree 中完成一次任务并返回结构化结果。

### Wave 3 — DeepSeek 先接数据，Luna 后做视觉

- [x] DS-006：完成 renderer 非视觉 client/state、loading/empty/error/disabled/read-only 状态与测试。
- [x] DS-006：用既有命令完成无 seed 的 Project/charter/初始 DRAFT Baseline/显式激活/Task/TaskSpec 功能表单与断点续做。
- [ ] UI-003：Luna 只负责 Live-first 壳层、工作区入口、文案、主题与视觉验收。

退出条件：生产构建默认 Live；Fixture 不出现在普通用户主界面；主链路不依赖内部 ID 或 schema 命令名才能操作。

### Wave 4 — DeepSeek：RC 收口

- [ ] DS-007：补齐 real CLI、重启恢复、采纳、Baseline 激活、packaged smoke 的自动化门。
- [ ] 同步 README、PROGRESS、运行手册和发布清单。
- [ ] 明确签名/公证是 RC 阻断项还是后续分发项。

退出条件：产品 MVP 验收矩阵全绿，且没有 P0/P1 未关闭项。

## Ownership strategy

- **DeepSeek 主力（约 80–85%）**：可靠性、Main 运行时、Worker/CLI、非视觉 renderer 状态层、自动化与文档。
- **Luna 精简（约 15–20%）**：仅在后端契约冻结并合并后，完成一个整合视觉工单。
- **首席架构师**：实体/状态/公共契约、Main/Preload 安全边界、ADR 与最终门禁；不把未经评审的契约设计下放。
- DeepSeek 跨越原所有权边界，只能依据本计划列出的具体工单与文件白名单执行。

## Current verified baseline — 2026-08-10

- Git：`main` 与 `origin/main` 同步，HEAD `19c0690`；DS-006 已通过 PR #10 合并。
- 工程闭环：Task → Run → Acceptance → Apply → Revision → Candidate Baseline → Activate 已实现。
- DS-003：确定性时钟、packaged migrations、unsigned/package smoke 与 macOS CI gate 已合并。
- DS-004：原生仓库选择、单活动 Workspace Runtime、仓库隔离存储与 reopen/switch 已合并。
- DS-005：ExecutionRequest v2、真实 Codex CLI、Agent discovery/readiness 与隔离执行已通过 PR #9 合并。
- DS-006：生产默认 Live、typed workspace/Agent 生命周期、无 seed onboarding、dirty 门禁和断点续做已合并。
- 检查：Node 24 下 `pnpm check` 通过（469 tests + build）；PR #10 的 Linux check 与 macOS live/workspace/packaged Electron gates 全绿。
- 当前产品缺口：UI-003 视觉发布 pass 与 DS-007 RC gates；严格按 UI-003 → DS-007 推进。

## Blockers

| Blocker                        | Owner      | Resolution                                              |
| ------------------------------ | ---------- | ------------------------------------------------------- |
| macOS 签名行为会等待本机钥匙串 | 首席架构师 | 本地 smoke 使用禁用签名的隔离构建；分发签名另立发布决策 |

## Active execution status

- **当前阶段：Wave 3 / UI-003 准备开工。**
- DS-006 的 Renderer 生命周期、onboarding 恢复语义和 UI-003 view-model seam 已冻结并合并。
- UI-003 已解除 BLOCKED；DS-007 继续等待 UI-003 合并。

## Errors encountered

- DS-006 首次增补 lifecycle client 测试时用不完整 `{}` 伪造联合响应，严格 typecheck 正确拒绝；改为类型安全的 rejecting recording client，仅记录 path-free command/payload，不伪造契约数据。
- Runtime 子任务误用默认 Node 23 跑仓库级检查，触发已知 `node:sqlite`/Drizzle 假失败；未采信该结果，所有正式验证统一使用 `/opt/homebrew/opt/node@24/bin`。
- 根工作区没有直接暴露 `prettier` 可执行文件，首次 `pnpm exec prettier` 未运行；改用 Desktop workspace 自己的已安装 formatter 执行限定文件格式化。
- 清理 onboarding 测试中的泛型命令断言后，TypeScript 揭示默认 `CommandRequest` 联合会丢失泛型相关性；测试 helper 改为显式接受完整命令/输出联合，避免恢复 unchecked cast。
- Runtime hook 竞态测试发现 workspace 操作在 reducer 重渲染前的同一 tick 仍可启动 Agent 变更；Agent gate 增加同步 `workspaceOperationRef` 检查，保证跨操作原子互斥。
- 首轮 Renderer lint 拒绝 render 中写 ref、effect 中同步触发本地 state，以及一个对象依赖；状态 ref 改为 effect 同步，初始 Agent busy 直接来自初值，revision 初载改为带卸载保护的 Promise 回调，并稳定解构只读回调依赖。
- ProductOnboarding 多场景测试首次运行暴露 Vitest 未自动清理 jsdom，后一个场景读到了前一个 READY DOM；所有新增组件测试显式 `afterEach(cleanup)`，并等待当前场景专属的 Agent action。
- Agent 非就绪组件场景中 lifecycle header 先于 Project hydration 完成，测试曾过早断言；改为分别等待 Agent action 与异步 Project 水合信号。
- 第二轮仓库检查发现两个新增 API-fake `WorkspaceRuntimeStatus.lastError` 漏了契约要求的 `message`；补全冻结 shape。定向 Vitest 只转译测试，不能替代 TypeScript 门禁。
- 一次限定文件检索从 `apps/desktop` 工作目录重复写入 `apps/desktop/...` 前缀而返回路径不存在；改为相对 `src/renderer/src` 重新核对所有新增表单调用点，无代码影响。
- DS-006 推送后预检 macOS CI，发现既有 `e2e:live` 仍点击已被工单明确移除的生产 Live/Fixture 切换按钮；作为核心回归门窄修正，改为直接等待 Live 项目水合，不更改测试业务步骤。
- 首次沙箱外复跑 Live E2E 后，`MUSICDB Demo` 同时出现在新增 Project selector 与水合详情，Playwright strict locator 正确报出歧义；将两处等待限定为 exact + last，业务断言不变。
- Live E2E 首次启动全链路通过、重启失败，暴露 selector 把“任务采纳后候选 DRAFT Baseline”误判为“首次引导 DRAFT”；改为仅在无 ACTIVE Baseline 时进入初始草稿审阅，并补持久化回归用例。

## Completion rule

只有用户可从打包应用完成“选择仓库 → 创建任务 → 真实 Agent 执行 → 验收 → 采纳 → 新 Baseline 激活”，并且对应自动化门全部通过，Product MVP v0.2 才算完成。
