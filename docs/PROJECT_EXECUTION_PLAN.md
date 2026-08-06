# Canvas Agent 首版执行计划

**状态：** 工程与协作基线已建立，等待远端发布后进入 Wave 1  
**日期：** 2026-08-06

## 1. 本轮结论

当前版本只围绕一个核心结果展开：用户能把项目事实冻结为可执行上下文，让一个 Worker 在隔离 Git worktree 中执行，并依据 Diff、Test 与 Artifact 决定任务和新 Baseline 是否成立。

完整 Canvas、多 Worker、多 Agent 自主协作、实时协作、Checkpoint 全协议和向量检索均不属于当前核心闭环，不进入首版实现。

## 2. 已建立的基线

- pnpm + TypeScript monorepo；Node 24.14.0、pnpm 11.9.0。
- Electron + React 桌面壳，安全的 Main/Preload/Renderer 边界。
- 独立的领域状态与转换约束，以及 Zod 校验的 IPC/ExecutionRequest 契约。
- Base UI + shadcn Rhea + Tailwind v4 设计 token 与代表性三栏工作台。
- SQLite/Blob/Git 持久化边界与 Utility Process Worker 边界。
- lint、format、typecheck、unit test、build 统一质量门禁。

架构详情见 `docs/architecture/implementation-baseline-v0.1.md` 和 `docs/architecture/decisions/ADR-018-desktop-runtime-and-storage.md`。

## 3. 分工

### Wave 1：远端 main 建立后并行

| 执行者 | 工单 | 独占范围 |
|---|---|---|
| DeepSeek V4 Flash | `DS-001-persistence-foundation.md` | `packages/persistence/**` |
| GPT-5.6 Luna | `UI-001-ui-foundation.md` | `apps/desktop/src/renderer/**` |

### Wave 2：Wave 1 评审合并后开始

| 执行者 | 工单 | 独占范围 |
|---|---|---|
| DeepSeek V4 Flash | `DS-002-worker-runtime.md` | `packages/worker-runtime/**` |
| GPT-5.6 Luna | `UI-002-core-flow-prototype.md` | `apps/desktop/src/renderer/**` |

执行者必须从远端 `main` 创建工单指定分支，提交完整验收证据并通过 PR 交付，不得跨越文件所有权修改领域或契约。

## 4. 开始开发

```bash
git clone <remote-url>
cd canvas-agent
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

随后阅读根目录 `AGENTS.md`、`CONTRIBUTING.md`、`docs/tasks/README.md` 与自己的工单，再创建工单指定分支。

## 5. 发布门槛

远端 `main` 必须包含首个基线提交，且新电脑上的 frozen install 与 `pnpm check` 必须通过。任何需要扩大 `ExecutionRequest`、改变领域状态或绕过 IPC 的实现都必须先提交架构变更请求，不能由执行者自行扩展。
