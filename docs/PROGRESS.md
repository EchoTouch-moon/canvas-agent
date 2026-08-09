# Canvas Agent — 项目进度文档

- **日期：** 2026-08-09
- **里程碑：** `ENGINEERING CORE LOOP COMPLETE / PRODUCT MVP v0.2 CLOSEOUT PLANNED`
- **仓库：** https://github.com/EchoTouch-moon/canvas-agent（私有）
- **分支：** `main`（当前 HEAD `26ef285`，89 commits）

> **2026-08-09 audit correction:** 工程闭环已经完成，但产品 MVP 尚未完成。format、lint、typecheck、build 和 production audit 通过；单测当前为 **244/246**，两个失败来自 Main 固定时钟与 Worker 实时时钟不一致；真实 Electron live E2E 通过；unpacked 应用因 migration 资源路径错误而无法冷启动。新的权威执行顺序见 `docs/PRODUCT_MVP_V0.2_PLAN.md`。下文的阶段历史保留，但任何“`pnpm check` 全绿”或立即进入旧 Phase 5 的表述均被本段取代。

---

## 1. 项目定位

**Canvas Agent 是一个本地优先（local-first）的 AI 编码 Agent 项目控制系统。**

目标不是“一个执行 Agent 任务的桌面壳”，而是：让一个 Agent 的工作能够从**冻结的项目共识**出发，经过**执行 → 证据 → 人类验收 → 显式副作用授权**，最终演化为**下一版正式项目共识**——并让这个过程每一步都有 durable identity、版本绑定、审计证据和失败语义。

当前已跑通的核心产品闭环：

```text
ProjectBaseline N
  → Task
  → TaskSpecVersion
  → ContextSnapshot
  → Run
  → ExecutionRequest
  → Utility Process
  → RunEvent / Artifact
  → AcceptanceEvaluation
  → Task COMPLETED
  → ArtifactApplication
  → recoverable Git adoption
  → RepositoryRevision N+1
  → Baseline N+1 DRAFT
  → explicit activation
  → Baseline N SUPERSEDED / Baseline N+1 ACTIVE
```

三个关键边界始终成立：

```text
Run success    ≠ Task completion
Task completion ≠ Result adoption
Result adoption ≠ Baseline activation
```

---

## 2. 技术栈与仓库结构

**monorepo（pnpm workspace，pnpm 11.9.0，Node ≥24 <25）：**

| 包 | 职责 |
|---|---|
| `packages/domain` | 领域模型 + 权威状态机（Task / Run / Baseline 转移矩阵，`assertTaskTransition` 等） |
| `packages/contracts` | IPC 命令面：Zod schema、`CommandMap`、SourceReference、运行历史/验收/采纳协议契约 |
| `packages/persistence` | SQLite（drizzle）持久化层：项目事实、上下文快照、Run 历史、验收、采纳、Baseline 溯源 |
| `packages/worker-runtime` | 隔离 Worker 执行循环：不可变 ExecutionRequest、worktree、验证、artifact 输出、取消 |
| `apps/desktop` | Electron 桌面端：Main（路由/协调器/Git 读写/采纳协议）、preload bridge、Renderer（CoreFlow + Live workspace） |

**当前测试审计（246 个，244 通过 / 2 失败）：**

```text
domain            5
contracts        41
persistence      68
worker-runtime   19
desktop         113
-------------------
total           246（当前 244 ✅ / 2 ❌）
```

**CI：** `.github/workflows/ci.yml` 当前只覆盖 Node 24 + pnpm 的 format / lint / typecheck / test / build；Electron live E2E 与 packaged smoke 是 v0.2 必补门禁。

**E2E：** `pnpm --filter @canvas-agent/desktop e2e:live`（Playwright `_electron` 驱动真实 Electron，隔离 userData + 真实 Git 仓库，含**跨重启持久化**验证）。

---

## 3. 核心架构与信任边界

### 3.1 关键架构决策（ADR / PROPOSAL）

| 文档 | 内容 |
|---|---|
| PROPOSAL-019 | IPC 命令面，把 fixture 驱动的 UI 换成真实命令 |
| PROPOSAL-020 | Phase 1 Main 命令路由 + WorkspaceService |
| PROPOSAL-021 | Phase 2 UtilityProcess Worker Host（真实执行边界） |
| PROPOSAL-022 | Phase 3 Renderer WorkspaceClient 集成 |
| PROPOSAL-023 | Phase 4 #1 Context Resolver / Materialization（可信上下文冻结） |
| PROPOSAL-024 | Phase 4 #3 Run + RunEvent + Artifact 持久化 |
| PROPOSAL-025 | Phase 4 #4 AcceptanceEvaluation + Task 生命周期 + 完成 |
| PROPOSAL-026 | Phase 4 #5 Result Adoption + Baseline Promotion（durable side-effect protocol） |
| PROPOSAL-027 | Product Workspace Runtime + Main-owned repository selection |
| PROPOSAL-027A | path-free workspace command/Zod contract |
| PROPOSAL-028 | Provider-neutral Local CLI + Codex Adapter v1 |
| PROPOSAL-028A | ExecutionRequest v2 immutable Context Bundle |
| PROPOSAL-028B | packaged-safe local Agent executable discovery/readiness |
| PROPOSAL-028C | path-free Agent readiness command/Zod contract |
| PROPOSAL-029 | fresh workspace Project/Baseline/Task bootstrap without demo seed |

### 3.2 信任边界（逐步建立）

- **Renderer 只选择“来源”，Main 决定“来源实际冻结成什么”。** `snapshot.freeze` 只接收 `SourceReference` selections；content / authority / priority / tokenEstimate / contentHash 全部由 Main 权威物化（PROPOSAL-023）。
- **`context.resolve` 预览永远不能成为 freeze 的信任输入。** Freeze 必须重新从 SourceReference 权威物化（invariant A）。
- **dirty RepositoryRevision 不能用 baseCommit 内容冒充完整 pinned revision。** RepositoryContent 仅支持 clean committed revision。
- **Git 与 SQLite 无法原子。** 采纳（adoption）被建模为 **可识别、可重试、可对账** 的外部副作用协议：`AUTHORIZED → APPLYING → APPLIED / FAILED / INTERRUPTED`，带 crash-gap 对账（HEAD inspect → reapply / finalize-matching-commit / conflict）。
- **状态机单一真源在 `packages/domain`。** persistence 只做同态 no-op 与错误转换，不复制矩阵。

---

## 4. 当前功能状态

### 已实现（后端 → 前端全链）

- 项目 / 节点 / NodeDraft / NodeVersion / 边 / 任务 / TaskSpec / 验收标准 / Baseline / RepositoryRevision / ContextSnapshot 的 SQLite 持久化与跨项目引用不变量。
- Context：`project.state` / `context.resolve` / `snapshot.freeze`（selection-based）/ canonical `repo://` codec / byte-safe Git 内容读取。
- 执行：`execution.dispatch / cancel` → UtilityProcess 隔离 worktree → DispatchResult；`Run`（1:N ExecutionRequestRecord）+ `RunEvent`（DISPATCHED/FINISHED/INTERRUPTED）+ `Artifact`（byte/hash 校验的持久化）。
- 验收：`acceptance.evaluate`（append-only 不可变历史）+ `acceptance.list`；Task 生命周期（publish→READY / dispatch→IN_PROGRESS / evaluate→WAITING_REVIEW / complete→COMPLETED）。
- 采纳：`artifact.apply`（22 guards + 幂等 + crash 对账）+ `artifactApplication.list` + `baseline.createCandidateFromTask` + 强化 `baseline.activate`（parent-stale guard + real-repo guard）；`GitRepositoryWriter`（受控 commit，trailers 绑定 application/run/artifact/hash）。
- 产品面：Live Workspace 视图（hydration / composer / repository resolve / freeze / run / acceptance / adoption / runs history）+ CoreFlow 流程原型（APPLY/ACTIVATE 已解锁为真实命令，旧 session-only ArtifactReview 退休）。

### 尚未实现（按新的产品优先级）

- Product MVP v0.2 Core：确定性时钟、packaged migrations、原生仓库选择/切换、真实 Codex CLI Adapter、Live-first Product Workbench、RC 自动化门。
- Future：Checkpoint / Resume、ToolInvocation、Approval、多 ExecutionRequest continuation；触发条件见 scope register。
- Future：Canvas / Graph Intelligence。
- BaselineEdgeItem（关系快照）——MVP 明确冻结为 NodeVersions + RepositoryRevision。

---

## 5. 版本改进清单

> 按时间顺序，列出每个版本（commit/阶段）到底改进了什么。

### v0.1 引导（`f7cdc3e`）

- 初始化 canvas-agent workspace，pnpm monorepo 骨架，v0.1 基础。

### Wave 1 — 持久化与 Worker 运行时

- **`ef5e3a9`（DS-001）SQLite 持久化基础**：Project / Node / NodeVersion / NodeDraft / Edge / Task / TaskSpec / Baseline / RepositoryRevision / ContextSnapshot 表；审计日志；迁移机制。这是“项目事实”第一次进数据库。
- **`270714d`（DS-002）隔离 Worker 执行循环**：worker-runtime 在隔离 worktree 中执行不可变 ExecutionRequest，产出 patch / verification / artifacts；claim 去重；预算与超时；取消。引入“执行即隔离副作用”的核心思想。

### Wave 1+2 — UI 基础与核心流程原型（Luna）

- **`ed1cbcd`（UI-001）UI foundation**：桌面壳、侧栏、基础组件。
- **`60e5ec8`（UI-002）核心流程原型**：CoreFlow 单动作流程，fixture 驱动的 dashboard / task / context / run / artifact / baseline 界面。这是产品叙事的第一版。
- **`0f27007`**：修复构建——把 workspace TS 打包进 main/preload，pin `@electron/get`。
- **`80acecf`**：中英双语 i18n、onboarding 引导、flow progress rail（`d71ba10` 记录）。

### Phase 1 — 真实核心循环（Main 路由 + WorkspaceService）

- **`a80540a`**：IPC 命令面（真实核心循环），`revision.current` 进入、公开 `revision.upsert` 移出（`ff01abc`）。
- **`b8aa24d`**：真实 Main 命令路由 + WorkspaceService，把 fixture 数据换成真实 persistence 读写。
- **`9b9a94c`**：Phase 1 复核修复（close-out）。
- **交付：** 第一个“UI → SQLite”可跑的循环（`eb661a2` / `d9446d1`）。

### Phase 2 — UtilityProcess Worker Host（真实执行边界）

- **`659fda8`**：UtilityProcess Worker Host——真实进程边界，worker 与 Main 分离。
- **`ac45023`**：加固 UtilityProcess 协议与生命周期（init/dispose 走校验过的 postFrame 路径，`125addb`）。
- **交付：** `execution.dispatch` 真正在隔离 UtilityProcess 中执行（`64b647c` / `f043c79`）。

### Phase 3 — Renderer WorkspaceClient 集成 + 真实执行

- **`6b131f4`**：Phase 3 project state / execution coordination 契约；跨项目引用不变量（`3867c64`）；env-gated demo seed（`5c8ce6c`）。
- **`d1717bd`**：**CI workflow** + Phase 3 后端验证包（demo seed、execution profile、phase3 smoke）。
- **`6cda1f2`**：**取消竞态修复**——任一阶段（revision/worktree/agent/verification/patch）收到取消都收敛到 `CANCELLED`；worktree 取消做 best-effort cleanup。用 BarrierAgent 替换 300ms 定时 flaky 测试。
- **`c00457d` / `08077ce` / `c23fb30`（Luna）+ `2d021bc`**：Renderer 接入真实 WorkspaceClient（对齐真实契约、错误按 `error.name` 处理、stale hydration generation guard）。
- **`01476a7`**：**preload 修复**——sandbox preload 打包 zod（否则 `window.canvasAgent` 在运行时根本不存在）。
- **`6cab305`**：**Live Workspace 视图** + 真实 Electron E2E（hydration → composer → freeze → dispatch → SUCCEEDED evidence）。E2E 由此成为可复现门禁。

### Phase 4 #1 — Context Resolver / Materialization（可信上下文）

- **`5a22291`**：`SourceReference`（TASK_SPEC_VERSION / NODE_VERSION）+ selection-based `snapshot.freeze`（B1，破坏性替换内容型 items）；canonical-only 编解码。
- **`789048c`**：Main `ContextResolver`——pinned TaskSpec 自动物化、baseline membership、canonical content、hash 审计。
- **`e4cb6bd`**：Freeze selections 结构上仅 NODE_VERSION；exact pinned binding；hash 等值断言。
- **交付：** Renderer 从此无法控制 resolvedContent / contentHash / authority / priority / itemType / tokenEstimate（`e53bd99`）。

### Phase 4 #2 — RepositoryContent + `context.resolve`

- **`1fdcbdb`**：`REPOSITORY_CONTENT` 源 + `repo://` segment codec + `context.resolve` 预览命令。
- **`99f3f1e`**：byte-safe Git 内容读取（512 KiB cap、fatal UTF-8、fail-closed）；dirty revision 拒绝。
- **`44fd11e`**：project-scoped preview（统一 scope 校验）、编码路径 round-trip、Git 错误分离、路径边界锁。
- **交付：** 真实仓库文件可被预览并作为可信上下文冻结（`d58e37b`）。

### Phase 4 #3 — Run + RunEvent + Artifact 持久化

- **`5bf44d6`**：共享 runtime-safe `executionRequestIdSchema`；`execution.dispatch` 返回 `{runId, executionRequestId, result}`；`run.list / run.get`。
- **`48d0bd5`**：Run（1:N ExecutionRequestRecord）、run_event、artifact 表 + 事务化命令；`mapDispatchToRunOutcome`；worker 启动前 Run+Record+DISPATCHED 原子落盘。
- **`b9e6fab`**：coordinator 持久化 wiring + `ArtifactIngestor`（realpath containment、symlink 拒绝、bounded read、size/hash 校验）+ renderer runs history。
- **`5a9335d`**：跨平台 containment、字面 symlink 拒绝、bounded read、Run↔Request 归属、recoveryJson、完整 Run 视图、**字节级重启证据**。
- **交付：** “Agent 做过什么不会消失”（`0f9e7d9`）。

### Phase 4 #4 — AcceptanceEvaluation + Task 生命周期 + 完成

- **`693a558`**：acceptance_evaluation（append-only，sequence N+1）+ acceptance.list；Task 状态机（publish DRAFT→READY 同事务、dispatch→IN_PROGRESS 同事务、迁移 backfill）；`task.complete({taskId, evaluationId})` 8 guards。
- **`905f641`**：Main/渲染接线 + Live acceptance 流（逐 criterion verdict → evaluate → complete）。
- **`db0c7de` / `69826f7`**：状态机单一真源回归 domain；publish 终态守卫；usable-outcome 语义；Live 绑定到 Run（run.get）；CoreFlow 接真实命令；repeatable smoke/E2E（`CANVAS_AGENT_USER_DATA` 隔离）。
- **交付：** “人是否接受、任务是否完成”成为正式持久事实（`a43cdc2`）。

### Phase 4 #5 — Result Adoption + Baseline Promotion（durable side-effect protocol）

- **`f4b248e`**：artifact_application + artifact_application_event + baseline_candidate_source 表；Application 生命周期命令；candidate（parent NodeVersion 精确继承 + provenance + 幂等）；activate parent-stale guard。
- **`ef2f97f`**：`GitRepositoryWriter`（apply --check → apply --index → 受控 commit + trailers）；`WorkspaceService.applyArtifact`（22 guards + 幂等 + crash 对账）；Live adoption 区；CoreFlow APPLY/CREATE/ACTIVATE 解锁、session ArtifactReview 退休。
- **`36ea453`**：**恢复/幂等/stale 边界收口（P0-1..8 + P1-1..4）**——Run 1:N request 正确性、exact-binding 幂等、AUTHORIZED 恢复、exact-base CAS + parent 校验、commit 失败安全补偿、candidate 仓库 guard、可信私有 hooks 目录、CoreFlow 精确激活、candidate name+description 幂等、DRAFT review boundary 跨重启、Live Retry/Reconcile。
- **交付：** `Baseline N → … → Baseline N+1` 全链闭合，副作用可识别、可重试、可对账（`2e4a814`）。

### 收尾（`7f3c8c7`）

- 全部 Phase 4 验证包标记 `VERIFIED / CLOSED`；MVP Core Loop 正式收旗。

---

## 6. 下一阶段（权威顺序）

1. **DS-003：Release Reliability**——时钟、migration packaging、packaged/CI smoke。
2. **DS-004：Workspace Runtime**——原生选择仓库、单活动运行时、仓库隔离状态。
3. **DS-005：Real Local Agent**——通用 CLI boundary + 首个 Codex Adapter。
4. **DS-006 → UI-003：Live-first Product Workbench**——DeepSeek 完成数据状态，Luna 只做视觉壳与 QA。
5. **DS-007：RC Gates**——全链、重启、采纳幂等、package、文档收口。

Checkpoint/Resume、第二 Adapter 与 Canvas 均被范围门延后。详细依赖、所有权和验收矩阵见 `docs/PRODUCT_MVP_V0.2_PLAN.md` 与 `docs/tasks/README.md`。
