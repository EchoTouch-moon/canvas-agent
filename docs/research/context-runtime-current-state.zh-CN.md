# Context Runtime 当前状态索引

更新时间：2026-09-06（Asia/Shanghai）

> 本页是 Context Runtime 研究状态的当前入口。它只记录已经合并、已经审查或明确授权的事实；历史计划和历史报告保留原貌，但不再单独承担当前授权依据。任何新的 Provider 执行都必须以最新授权记录为准，不能从本页或旧计划自动推导。

## 一页结论

当前项目已经完成从“可观察、可审计的 Runtime 基础设施”到“比较实验准备”的工程收敛，但还没有得到 Context Runtime 相对 Native 的有效性答案。C1 usage amendment adapter、零 Provider 证据闭环与 live entrypoint 均已合并进入当前 `main`；Authorization V3 草案已绑定当前 exact `main`，下一步是完成有界审查并等待 owner 单独签署。

当前唯一近端主线是：基于已完成的零 Provider 闭环，准备并审查一份绑定当前 exact `main`、effective usage contract 和 fresh single-use identity 的新授权记录；在 owner 单独签署前不 claim identity、不发起 Provider 调用。

```text
C1 Live                 NO_GO
New Provider calls      NO_GO
Old study resume/reuse  FORBIDDEN
CR-004                  NO_GO
Wave B                  NO_GO
```

## 当前事实与绑定

| 项目 | 当前状态 | 绑定或解释 |
| --- | --- | --- |
| 远端 `main` | `4d5e39a9b337d6cabdc84d450680bc54ad85561b` | PR #102 合并后的当前研究基线；合并后 CI `33983852204` 的 `check` 与 `macos-electron` 均成功 |
| PR #98 | `MERGED / CI_GREEN / IMPLEMENTATION_ACCEPTED` | implementation `55d834483ba044099e0be8d64b95028becabb014`；merge commit `583ecb74623b77dce2238f67faba1b2e046aaa9b`；实现 usage amendment 的 adapter/validator/serialization 兼容层 |
| PR #100 | `MERGED / CI_GREEN / ZERO_PROVIDER_CLOSURE_ACCEPTED` | merge commit `816c13c15ef8247ec9f27c981e025283be4e366b`；补齐 usage source map、正式 treatment 入口审计和离线 adjudicator 证据闭环 |
| PR #102 | `MERGED / CI_GREEN / LIVE_ENTRYPOINT_ACCEPTED` | merge commit `4d5e39a9b337d6cabdc84d450680bc54ad85561b`；实现正式 C1 live entrypoint 的授权、ground-truth-free bootstrap、scope gate 与 execution provenance |
| `C1_USAGE_CONTRACT_AMENDMENT_V1` | `FROZEN / MERGED` | 只调整 provider cache split 的可用性语义；原 `C1_RUN_CONTRACT_V1` 保持不变 |
| `C1_PROTOCOL_V1` | `FROZEN` | 比较问题、对照/处理臂、指标与裁决边界 |
| `C1_A_MANIFEST_V1` | `FROZEN` | 4 个任务层、fixture、oracle、anchors 与身份绑定 |
| `C1_RUN_CONTRACT_V1` | `FROZEN` | 32 matched pairs / 64 legs、AB/BA、主终点、预算与统计规则 |
| C1 treatment readiness | `FROZEN / PASS` | provider-bound Native fidelity、Runtime treatment 与 T4 cold/restored 证据已通过零 Provider readiness |
| C1 study orchestration | `MERGED / ACCEPTED` | 64-leg 顺序执行、隔离 sandbox、七类 metadata-only evidence、terminal/kill-switch |
| 首次 C1 Live attempt | `TERMINAL / NOT ADMISSIBLE` | study `c1-20260905-c1-feasibility-v1-35359a74`；1 次 provider/network attempt、0 个 completed leg、usage capability mismatch |
| 首次 study identity | `CONSUMED / RETIRED` | 永不 resume、reuse 或 rebind；不能用 #98 或后续修复继续该 identity |
| CR-005 | `CLOSED_AS_STOPPED_EXPERIMENT` | Run 1/Run 2 保留；没有把 C5/C6 伪装成补跑结果 |
| CSPV-B0/B1 | `POLICY_CAPABILITY_GAP → PASS` | 原 oracle 先暴露缺口，B1 在不改 frozen suite 的条件下修复并通过 |

## 证据层级：目前能说什么

### 已有的系统/测量证据

- C0-L1 已在真实 Step Plan 交互中捕获 provider-reported usage，并完成 lifecycle observability、持久化和 replay 证据；其中 Node23 运行保留为 usage-seam validation，Node24 运行才是受控 runtime evidence。
- C1 的 zero-provider readiness 已证明 Native 与 Runtime 的 provider-bound 请求边界可区分，T4 的 `REMOVE → cold materialization → provider-bound absence → REHYDRATE → provider-bound restoration` 链条成立。
- #98 分支的回归表明：缺失 cache-write 从硬失败改为显式 `UNAVAILABLE / NOT_REPORTED_BY_PROVIDER`，不以零代替缺失；核心 `inputTokens/outputTokens/totalTokens` 仍必须由 Provider 报告。

### 目前没有的效果证据

- 没有完成的 C1 Native-vs-Runtime comparative effectiveness 数据。
- 没有可用于 C1 primary endpoint 的有效 paired result、BETTER/WORSE/TRADE-OFF/INCONCLUSIVE 裁决。
- 首次 C1 Live attempt 发生在首个响应的 usage-contract 校验阶段，不能计入 task effectiveness 或 treatment effectiveness。
- M5 的随机复现未支持效率优势；M4 的早期正向信号不能作为当前策略已有效的结论。M6–M9 只说明特定机制曾获得 direct exposure，不等于整段任务资源或质量改善。

## 冻结合同之间的关系

```text
C1_PROTOCOL_V1
      +
C1_A_MANIFEST_V1
      +
C1_RUN_CONTRACT_V1
      +
C1_USAGE_CONTRACT_AMENDMENT_V1
      ↓
effective execution contract
      ↓
exact implementation revision + fresh study identity
      ↓
separate owner authorization
```

相关冻结文件：

- [`C1 comparative effectiveness protocol`](../plan/cspv-c1-comparative-effectiveness-protocol-2026-09-01.md)
- [`C1 task / fixture manifest`](../plan/cspv-c1-task-fixture-manifest-2026-09-01.md)
- [`C1 analysis / run contract`](../plan/cspv-c1-analysis-run-contract-2026-09-01.md)
- [`C1 treatment readiness`](../verification/cspv-c1-treatment-readiness-2026-09-01.md)
- [`C1 live authorization gate`](../plan/cspv-c1-live-authorization-gate-2026-09-02.md)
- [`retired C1 live authorization record`](../plan/cspv-c1-live-authorization-record-2026-09-04.md)
- [`C1 usage contract amendment`](../plan/cspv-c1-usage-contract-amendment-2026-09-05.md)
- [`C1 Live authorization record V2 (historical / superseded)`](../plan/cspv-c1-live-authorization-record-2026-09-05-v2.md)
- [`C1 Live authorization record V3 (draft)`](../plan/cspv-c1-live-authorization-record-2026-09-06-v3.md)
- [`C0-L1 live evidence`](../verification/cspv-c0-l1-live-evidence-2026-09-01.md)
- [`CR-005 interim evidence analysis`](../verification/context-runtime-cr-005-interim-evidence-analysis.md)
- [`C1 zero-provider evidence closure`](../verification/cspv-c1-zero-provider-evidence-closure-2026-09-05.md)

## 下一步执行顺序

以下是当前允许的近端顺序：步骤 1–3 已完成或正在进行且不产生 Provider 调用；步骤 4–5 必须在新的授权记录获得 owner 明确签署后才能执行，不能从本页提前获得 Live 授权。

### 1. 收口 #98 — 已完成

由 owner 按仓库 review 规则完成 #98 有界技术审查、标记 Ready 并合并。#98 implementation 为 `55d834483ba044099e0be8d64b95028becabb014`，merge 后的历史基线为 `583ecb74623b77dce2238f67faba1b2e046aaa9b`；不能把 #98 的 head 或旧授权自动当作新的执行基线。

### 2. 做一次核心的零 Provider 证据闭环 — 已完成

这个包保持小而可审查，PR #100 已合并且 `main` CI `33970829132` 的 `check` 与 `macos-electron` 均通过。正式入口行为测试在 Node 24 CI 中执行；Node 23 本地运行的入口审计总状态为 `INCOMPLETE`、行为探针记录 `NOT_RUN_NODE_RANGE`，不把未执行的行为证据写成已通过：

1. **用量字段来源表**：明确 C0 normalized usage 与 C1 provider response 的原始字段、缓存是否包含、归一化变换、缺失状态和可参与的终点；禁止把 C0/C1 的 token 口径拼接或重复相加。
2. **正式 treatment 入口审计**：绑定真实 live launcher、Native/Runtime factories、内容哈希和 executed revision，另经 `C1StudyOrchestrator → factory → driver` 的零网络行为测试核对相同输入下的实际 provider-bound context 差异，并验证绕过 treatment 会被拒绝；不得用 dry-run 预造 lifecycle 轨迹冒充自然 live 行为。
3. **分析器离线验收**：用合成 pair 覆盖 `BETTER/WORSE/TRADE-OFF/INCONCLUSIVE`、缺失用量证据失效率、逐 pair 次指标差值、带单位 Cold Context Penalty、失败、零分母、停止和 `NOT_ESTIMABLE`，并验证结果与冻结合同一致。

本次验证的分类是核心研究闭环，不是产品 UI、第二 Provider、LLM planner 或 CR-004 Active Rewrite；本地验证期间 Provider calls 与 network requests 均为 0。

### 3. 准备新的 Live 授权记录 — V3 草案已完成，待有界审查与 owner 签署

基于零 Provider 闭环与已合并的 live entrypoint，Authorization V3 草案已绑定：

- 合并后的 exact `main` SHA `4d5e39a...`；
- #98 implementation revision；
- amendment hash 与 effective contract hash；
- C1-A/B/C hashes；
- 固定 provider/model/config、seed、预算和 assignment；
- fresh single-use study identity。

V3 当前仍是 `DRAFT / ZERO PROVIDER / PENDING OWNER AUTHORIZATION`。旧 identity 与 V2 candidate 均不得恢复或复用；V3 候选 identity 仅写入为 `NOT CLAIMED / NOT RESERVED`。Live 决定仍须由 owner 单独签署，不能由 readiness、本索引或 Draft 文档自动授予。

### 4. 执行一场固定 C1 study — 条件性后续

获得新的明确授权后，才按 32 pairs / 64 legs、concurrency=1、固定 assignment 和既有 hard-stop 规则执行。失败任务、基础设施失败、usage 不完整、撤销/恢复和证据写入失败必须分别保留；不得 retry-until-success，也不得为了补齐矩阵而恢复 terminal study。

### 5. 做结果综合并结束本轮判断 — 条件性后续

至少报告 paired primary endpoint、任务结果、Runtime attrition、provider usage、tool trajectory、REMOVE/REHYDRATE、恢复代价与不确定性。最终允许的结果包括 `BETTER`、`WORSE`、`TRADE-OFF` 或 `INCONCLUSIVE`；token 下降本身不能压过任务质量和可靠性。

## 明确禁止的动作

- 恢复、复用或重新绑定 `c1-20260905-c1-feasibility-v1-35359a74`。
- 禁止在新的明确授权前 claim、创建或使用新的 C1 study identity，或发起 Provider call；Draft 中的候选字符串不代表已 claim。
- 修改 `C1_RUN_CONTRACT_V1`、C1-A/B/C 冻结文件、assignment、primary endpoint、统计裁决或历史 Run 证据以适配首次 Live 失败。
- 把 `UNAVAILABLE` 当作 0、估算值或由其他字段推导出的 cache split。
- 把 C0/C1 的不同 usage pipeline 直接合并成一个 token 结果。
- 把当前 Shadow 观察差异、机制 direct exposure 或 readiness PASS 写成 Context Runtime 已经提升成功率、降低成本或具有跨模型普适性。
- 启动 Wave A continuation、Wave B、CR-004 Active Rewrite、第二 Provider 或复杂 planner；这些属于后续研究方向，不是当前核心闭环。

## 研究叙事边界

当前最稳妥的研究表述是：

> 项目已经构建出一个能够在真实 Agent/Provider 边界观察、绑定来源与版本、执行受控 lifecycle、保存 metadata-only evidence 并在失败时 fail-closed 的 Context Runtime 实验基础；策略是否改善任务质量或资源使用，仍需一场新的、完整且可审计的 Native-vs-Runtime 比较实验回答。

若未来 C1 结果为：

- `BETTER`：先在新任务层检查是否只对当前 fixture 有效，再考虑第二模型；
- `WORSE`：只根据已观测机制定位一个策略变量，不立即扩展策略族；
- `TRADE-OFF`：同时呈现节省与恢复/质量代价，不压成宣传性 PASS；
- `INCONCLUSIVE`：先判断是方差、任务覆盖、treatment 未触发、usage 缺失还是 attrition，不能自动增加重复数。

## 历史入口

- [`Context Runtime v0.3 research rebaseline`](./context-runtime-v0.3-research-rebaseline-2026-08-13.md) 保留 Phase 1/2 历史结论；当前状态以本页为准。
- [`Context Runtime v0.3 experiment plan`](../plan/context-runtime-v0.3-experiment-plan.md) 保留 CR-001–CR-008 的历史定义；其中旧的 `ACTIVE`/`awaiting review` 文案不构成当前授权。
- 2026-09-05 的研究总审查与 PR 复盘是本页的编制依据；本页负责提供可提交、可导航的当前状态入口。
