# CR-010 — Model-visible Request Parity

## 状态

**PASS — offline parity evidence complete**

CR-010 建立了下面的零 Provider Call 验证链路：

```text
CommittedWorkingSet
        ↓
PiCommittedContextAdapter
        ↓
Pi context event
        ↓
before_provider_request capture
        ↓
Captured openai-completions payload
        ↓
Request reconstruction
        ↓
Canonical parity comparison
```

本轮没有修改 Context Runtime v0.3 Core Contract 的语义。

## Branch / baseline

- Branch: `codex/cr-010-model-visible-request-parity`
- Initial base: refreshed `origin/main@0148bd0`
- Local baseline merge: `origin/codex/context-runtime-core-state-machine@29c7778`
- Worktree: `/Users/v/Documents/V-cr-010`

刷新时发现远端 `main@0148bd0` 尚未包含已审查的 v0.3 state-machine commits，因此本分支保留了一个显式 merge commit 将 v0.3 core 带入 CR-010 基线。CR-010 新增代码未修改以下对象的定义或语义：

```text
UniverseRevision
ProposedWorkingSet
AdmissionReceipt
CommittedWorkingSet
WorkingSetTransition
```

交付前应在 PR 中明确审查该基线 merge；若 v0.3 后续正式进入 `main`，可将 CR-010 重新对齐到包含它们的 `main`，不改变本轮 adapter/parity 代码。

## Architecture

### Runtime → Pi adapter

`PiCommittedContextAdapter` 读取 `CommittedWorkingSet.entries`，按 `position` 稳定排序。每个 admitted entry 生成一条 Pi `custom` message：

- `role: custom`
- `customType: canvas-committed-context`
- `content`: representation 的 materialized text
- `display: false`
- `details`: verification-side `ContextRenderTrace`

`details` 不会进入模型 payload；Pi 的 `convertToLlm()` 将 custom message 转为普通 `user` message，只发送真实文本。

`contentRef` 或缺失 `content` 会 fail closed 为 `TRANSLATION_FAILURE`，不会把 `contentHash` 当作模型文本。

### Capture seam

代码位置：

```text
packages/pi-context-integration/src/active/request-parity.ts
  createPiRequestParityExtension()
    pi.on('before_provider_request', ...)
```

经验证的实际调用链为：

```text
Pi ExtensionRunner.emitBeforeProviderRequest()
    ↓
Agent SDK onPayload()
    ↓
pi-ai openai-completions stream()
    ↓
options.onPayload()
    ↓
client.chat.completions.create()
```

版本为 `@earendil-works/pi-coding-agent@0.84.1` 与 `@earendil-works/pi-ai@0.84.1`。捕获发生在 `client.chat.completions.create()` 之前，payload 是实际 OpenAI-compatible request shape，而不是 adapter 输入副本。

当前只接受 `api === 'openai-completions'`。其他 API 会产生 `HARNESS_CONTRACT_FAILURE / UNSUPPORTED_API`。

### Reconstruction

`reconstructModelVisibleContext(capturedRequest)` 只接收：

```text
CapturedModelRequest.payload
CapturedModelRequest.trace
```

它从 payload 的最后一组 parity message 读取实际 `role`、顺序和 text，并重新计算 `renderedContentHash`。函数签名不接收 `CommittedWorkingSet`，因此不能从 Runtime state 直接复制结果。

### Canonical parity

两侧分别 canonicalize 为：

```text
position
sourceId
sourceVersionId
representationId
representationKind
renderedHash
renderedContentHash
role
```

比较器报告：

```text
MISSING
EXTRA
VERSION_MISMATCH
REPRESENTATION_MISMATCH
ORDER_MISMATCH
CONTENT_HASH_MISMATCH
```

Pipeline error categories 为：

```text
TRANSLATION_FAILURE
REQUEST_CAPTURE_FAILURE
RECONSTRUCTION_FAILURE
PARITY_FAILURE
HARNESS_CONTRACT_FAILURE
```

## G1–G4 gates

| Gate | Result | Evidence |
| --- | --- | --- |
| G1 Translation | PASS | adapter determinism test；FULL/SUMMARY mixed representation；unresolved `contentRef` fail-closed test |
| G2 Identity Preservation | PASS | capture sidecar 保留 source/version/representation/rendered identity；outbound payload 不包含 provenance 字段 |
| G3 Reconstruction | PASS | 从实际 `before_provider_request` captured payload 重新提取 user messages；未传入 Runtime object |
| G4 Parity | PASS | canonical intended hash 与 observed hash 相等；P1–P8 全部通过 |

## P1–P8 executable corpus

所有 corpus case 均使用静态 DeepSeek model metadata、fake API key 和 test-only fetch stop；每项断言：

```text
captured request exists
parity = PASS
providerCalls = 0
transportStopCount > 0
```

| Case | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| P1 | 单个 `A@V1 FULL` | PASS | outbound payload 重建为 A@V1 |
| P2 | 多个有序 source | PASS | `A → B → C` 顺序保持 |
| P3 | `FULL + SUMMARY` | PASS | observed representation 文本与对应 materialized representation 一致 |
| P4 | 预算拒绝 C | PASS | receipt 将 C 标为 `REJECTED/BUDGET`；payload 只含 A、B |
| P5 | `UNAVAILABLE → LAST_GOOD` | PASS | receipt 为 `LAST_GOOD/LAST_GOOD_FALLBACK`；payload 仍为 A@V1 |
| P6 | 同 version `SUMMARY → FULL` | PASS | sourceVersionId 不变，representationId 与最终文本变化 |
| P7 | `A@V1 → A@V2` | PASS | captured request 只包含 V2，不残留 V1 |
| P8 | source removal | PASS | B 变为 ABSENT 后，payload 只保留 A |

P7 使用真实的两个 UniverseRevision：先 reconcile A@V1，再基于它 reconcile A@V2，然后从 V2 建立 proposal/admission/commit。

## Negative parity cases

| Mutation | Expected diagnosis | Result |
| --- | --- | --- |
| 删除 outbound parity message | `MISSING` | PASS |
| 添加额外 outbound message | `EXTRA` | PASS |
| 伪造 observed source version | `VERSION_MISMATCH` | PASS |
| 伪造 representation id/kind | `REPRESENTATION_MISMATCH` | PASS |
| 交换 observed positions | `ORDER_MISMATCH` | PASS |
| 修改 captured text | `CONTENT_HASH_MISMATCH` | PASS |

## Offline provider evidence

测试 harness 配置：

- `allowModelNetwork: false`
- `refreshOnCreate: false`
- `modelsPath: null`
- 静态 DeepSeek `deepseek-v4-flash` metadata
- fake API key
- `fetch` 在真实网络前抛出 test-only capture stop

结果：

```text
providerCalls       = 0
transportStopCount  > 0 for every captured run
```

`transportStopCount` 单独记录，避免把测试 transport 被调用误报为 provider call。

## Validation

使用 Node 24 执行：

```text
pnpm --filter @canvas-agent/context-runtime test
  102 tests passed

pnpm --filter @canvas-agent/pi-context-integration typecheck
  passed

pnpm --filter @canvas-agent/pi-context-integration test
  81 tests passed

pnpm check
  format check passed
  lint passed
  full workspace typecheck passed
  full workspace tests passed
  full workspace build passed
```

`pnpm check` 中 persistence 为 68 tests passed；此前 Node 23 下的 Drizzle `setReturnArrays` 问题在 Node 24 未重现。

## Core Contract changes

```text
NONE
```

CR-010 新增内容只位于 `packages/pi-context-integration` 与本报告；没有修改 `packages/context-runtime` 的核心状态机语义。

## Known limitations

- 当前只覆盖 Pi 与 `openai-completions` API。
- payload 本身不携带 source provenance；identity 依靠验证侧 sidecar trace，不向模型文本注入 trace token。
- reconstruction 当前假设 parity synthetic messages 位于 context message 序列尾部；若未来 Harness 在该边界之后继续插入消息，需要扩展 target-location contract。
- `contentRef` resolver 尚未实现；遇到 unresolved content 会 fail closed。
- 该阶段验证的是 Pi serializer 进入 provider client 前的 payload，不是真实 provider SDK 或 DeepSeek 服务端的二次改写。
- 没有真实 DeepSeek provider call。

## Deferred

```text
CR-011 — Real-provider Parity Smoke
```

后续再用极小规模真实 DeepSeek 请求验证 provider boundary；在此之前不加入 Planner、embedding、memory、Canvas UI 或多 Harness 接入。

## Recommended next step

先审查本分支与 `origin/main` 的基线 merge，确认 v0.3 core 提交的合并归属；然后审查 CR-010 的 Pi adapter、capture seam、P1–P8 parity evidence。通过后再开 CR-011。
