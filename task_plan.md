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
- [ ] DS-005A：实现 Provider-agnostic Local CLI Runner，不绑定具体品牌。
- [ ] DS-005A：实现 ExecutionRequest v2 Context Bundle 的 Main 物化与 Worker 双重验证。
- [ ] DS-005B：在 Codex argv/schema fixture 评审后实现真实 Provider 绑定和端到端用例。

退出条件：不设置 `CANVAS_AGENT_REPO` 也能选择仓库；真实 CLI 能在隔离 worktree 中完成一次任务并返回结构化结果。

### Wave 3 — DeepSeek 先接数据，Luna 后做视觉

- [ ] DS-006：完成 renderer 非视觉 client/state、loading/empty/error/disabled/read-only 状态与测试。
- [ ] DS-006：用既有命令完成无 seed 的 Project/charter/初始 DRAFT Baseline/显式激活/Task/TaskSpec 功能表单与断点续做。
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

## Current verified baseline — 2026-08-09

- Git：`main` 与 `origin/main` 同步，HEAD `7cbaf18`（PR #8），工作树干净。
- 工程闭环：Task → Run → Acceptance → Apply → Revision → Candidate Baseline → Activate 已实现。
- DS-003：确定性时钟、packaged migrations、unsigned/package smoke 与 macOS CI gate 已合并。
- DS-004：原生仓库选择、单活动 Workspace Runtime、仓库隔离存储与 reopen/switch 已合并。
- 检查：Node 24 下 format、lint、typecheck、304 tests、build 与 workspace/live/packaged E2E 通过。
- 当前产品缺口：Worker 仍使用 Fixture Adapter；ExecutionRequest v2 Context Bundle、真实 Codex CLI、无 seed onboarding、Live-first UI 与 RC gates 尚未完成。

## Blockers

| Blocker | Owner | Resolution |
|---|---|---|
| Codex argv/schema fixture 尚未评审 | 首席架构师 + DeepSeek | DS-005A 先做通用 Runner；DS-005B 只在 exact argv/schema fixture 通过架构评审后开工 |
| macOS 签名行为会等待本机钥匙串 | 首席架构师 | 本地 smoke 使用禁用签名的隔离构建；分发签名另立发布决策 |

## Completion rule

只有用户可从打包应用完成“选择仓库 → 创建任务 → 真实 Agent 执行 → 验收 → 采纳 → 新 Baseline 激活”，并且对应自动化门全部通过，Product MVP v0.2 才算完成。
