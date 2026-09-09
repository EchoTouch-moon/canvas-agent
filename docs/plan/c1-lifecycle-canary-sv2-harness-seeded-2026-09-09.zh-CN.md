# C1_LIFECYCLE_CANARY_SV2：Harness-Seeded Provider-Bound Pure-Evict Proof

日期：2026-09-09。状态：**设计候选 / NO_GO / 未实现 / 未授权 / 未执行**。
基线：`codex/c1-v4-offline-followup@012093274da742eddd8178b4448d105e6b27c4ac`；
实现、合同哈希和 live execution revision 必须在后续独立提交后重新生成，不能继承旧身份。

本设计响应 SV1 的研究边界：SV1 的终止响应缺少可回溯的 outcome、tool-request 和 usage，
因此不能用它推断模型为何没有调用工具。SV2 不重跑 SV1，也不把模型是否自发产生工具调用作为机制门。

## Goal

在不依赖模型生成前置行为的情况下，对一个由 Harness 确定性构造、且满足
`SUPERSEDED_VERSION` 五条触发条件的状态，先持久化可 replay 的输入证据，再完成 pure eviction，
并证明第一个真实 Provider 请求实际接收了移除陈旧读取对后的上下文。

这是一项 `CONTROLLED_MECHANISM_NOT_EFFECTIVENESS` 诊断。它不回答任务质量、token 节省、Provider 成本、
Runtime 相对 Native 的优劣，也不授权 C1 64-leg 或 §11.5 effectiveness A/B。

## 与已有证据的关系

| 证据 | 能支持的内容 | 不能支持的内容 |
| --- | --- | --- |
| V1/V2/V3 live | 真实 Provider 曾返回响应；前三次分别观察到 1、1、0 次读取 | Runtime 的真实移除；模型不能或不愿调用工具 |
| SV1 live | 1 次出站请求、收到 `outcome !== CONTINUE` 的正规化响应、协议仍停在 `EXPECT_READ_A` | outcome 的具体类型、内容、tool-request 数、usage；任何模型行为解释 |
| V4 prevalence | 在带有内容指纹的历史观察中，SUPERSEDED 现象具有观察下界 | 在同一历史 durable evidence 上逐腿 replay；Provider-bound 处理 |
| fake/driver lifecycle evidence | 五条件、REMOVE、replay 和 carried 机制可在离线环境成立 | 真实 Provider 请求是否使用已移除的上下文 |

SV2 只补最后一个缺口：**第一次真实 Provider-bound request 的 pure-evict 完整性**。

## 冻结候选合同

| 项目 | 冻结候选值 |
| --- | --- |
| 合同 ID | `C1_LIFECYCLE_CANARY_SV2` |
| 研究性质 | `CONTROLLED_MECHANISM_NOT_EFFECTIVENESS` |
| Policy | `C1_SUPERSEDED_VERSION_POLICY_V1` |
| 臂 | 单一 `RUNTIME`，无 Native 前置门 |
| Leg | 1；最多 1 个 Provider request；不重试、不恢复、不复用 |
| Provider | Step Plan / `step-3.7-flash`；无 fallback |
| Provider 工具 | 0；Provider 返回 tool request 时记录响应后停止，不执行下一请求 |
| Harness 预置工具 | 2 个成功的本地观察事件：`read src/a.js`、`edit src/a.js` |
| 时间 | request 30 秒；leg 120 秒；全程 120 秒 |
| 输出 | 沿用每请求 `max_tokens=16384`；不是实际用量或费用估计 |
| 数据 | 仅本合同内联 synthetic fixture 和固定上下文；不读取项目文件、任务答案、oracle 或凭据 |
| Bootstrap | 中性 synthetic `AGENTS.md`；不含 marker、任务答案或版本内容 |
| 身份 | fresh single-use identity；terminal 后永久禁止 resume/reuse/rebind |
| 记录 | metadata-only checkpoint、fingerprint-only replay record、正规化 response receipt；不保存 raw payload、原始请求、文件内容、oldText/newText 或凭据 |

### Inline fixture

```text
AGENTS.md:
Synthetic fixture. No task instructions.

src/a.js @ v1:
export const value = 1;

src/a.js @ v2:
export const value = 2;
```

`AGENTS.md` 仅作为满足观察来源不为空的中性 bootstrap。`src/a.js` 的 v1/v2 内容只在 Harness
的临时 sandbox 和内存 observation 中存在；durable evidence 只保存其指纹、版本和 source identity。

### Harness-seeded observation

Provider 第一次调用前，Harness 在临时 sandbox 中完成并验证：

1. 读取 `src/a.js`，记录成功 tool-call/tool-result 对以及 `beforeVersionFingerprint`；
2. 修改 `src/a.js` 从 v1 到 v2，记录成功 mutation 对；
3. 通过版本探针确认当前指纹存在且与 v1 不同；
4. 将这条 observation 交给 replay capture 和 `SUPERSEDED_VERSION` policy。

这不是向模型注入伪造 response，也不是从任务 manifest 推导 changed path。它是一个固定、可审计的
生命周期前置状态，目的是隔离 Runtime 的处理能力与模型是否愿意制造重复行为。

## 唯一请求的严格顺序

```text
load exact frozen binding + verify Node 24
  → materialize fresh inline sandbox
  → construct seeded observation and verify v1→v2 mutation
  → capture C1_LIFECYCLE_REPLAY_RECORD (no verdict persisted)
  → await durable append + fsync + read-back hash/schema verification
  → offline adjudication = SUPERSEDED
  → apply policy = REMOVE exactly read call/result pair
  → reconcile replay inputs and live decisions = MATCH
  → assert providerBoundMessages/sourceKeys omit stale pair
  → claim fresh identity and pass send boundary
  → exactly one real Provider request
  → persist normalized response receipt and final metadata
  → terminal + retire identity
```

Replay 写入、重读和 adjudication 必须在网络调用之前完成。SV2 不接受异步 `void` 写盘，
也不产生其他调用的 `NOT_EVALUATED` 记录。任何顺序、身份、hash、schema 或安全校验失败都在出站前停止。

## 发送前硬门

发送前必须同时满足：

- read path 与 mutation path 逐字节相同；
- mutation tool result 为 `SUCCESS`；
- read result 的 v1 指纹存在；
- version probe 返回 v2 指纹；
- v2 指纹与 v1 不同；
- replay 独立重算为 `SUPERSEDED`；
- live policy 恰好移除该 read 的 tool-call 和 tool-result 两个 source key；
- edit 对和中性 bootstrap 保留；没有 v2 内容、marker 或额外提示注入；
- provider-bound message list 与 source-key set 均确认不含陈旧读取对；
- `reconcileC1LifecycleReplayCall` 返回 `MATCH`；
- evidence 中没有 raw payload、credential-shaped text、绝对机器路径或 fixture 原文；
- 预算、单次身份和 Node 24 范围均通过。

`UNKNOWN`、`NOT_CANDIDATE`、`CONTRACT_CONFLICT`、写盘异常、source membership 不明或
provider-bound hash 不一致都属于 `CANARY_STOP`；不得用补输入、重试或放宽门来转成 PASS。

## Provider response 与 PASS

Provider 只需返回 schema 合法、usage 可按有效合同正规化的响应 receipt。响应文本、assistant 内容、
以及 `COMPLETE`/`FAILED` 的具体类型不参与 PASS 判定；它们只作为已收到响应的 metadata 边界保存。

若 response 含 tool request、usage contract 不匹配、网络/超时/写盘失败，必须先保留已知 receipt 或
明确的缺失状态，再 terminal/retire；不得执行第二次请求。此类结果不满足 SV2 PASS，但也不能抹除已发生的请求。

SV2 PASS 的最小条件是：

1. 至少一次真实 Provider request 已获准且网络发送；
2. 发送前 replay、policy、composition、source-key 和 message-boundary 全部通过；
3. 真实 response receipt 已持久化并可对账；
4. stale read pair 在 provider-bound context 中缺席，edit 对与 bootstrap 仍在；
5. 身份 terminal/retired，调用数为 1，后续请求为 0。

PASS 仅关闭“真实 Provider-bound pure eviction 是否可达”的机制问题，不代表策略有效、任务成功或有成本收益。

## 零 Provider 验收包

实现 PR 必须先通过假源和受控 sandbox：

- 正常 seeded path：replay durable → adjudicate → REMOVE → MATCH；
- 写盘失败、截断、重排、hash/schema mismatch：Provider calls = 0；
- v1/v2 相同：`NOT_SUPERSEDED`，不删除；
- 缺少 v1 或 v2 probe：`UNKNOWN`，不删除；
- 保护项、混合/opaque/error/歧义 pair：不删除；
- policy 移除多余 source 或 replay/live 不一致：`CONTRACT_CONFLICT`，不出站；
- provider-bound messages 含 stale pair 或注入 v2 内容：停止；
- response receipt 正常、terminal、失败、tool request 和 usage 缺失均保留正确未知边界；
- 同一 identity 第二次启动、换 output root 或换工作区均拒绝；
- durable evidence 不含 raw payload、凭据、绝对路径或 fixture 原文；
- fake provider/network calls = 0，研究包相关测试全绿。

## 授权与执行门

SV2 当前保持 `NO_GO`。只有以下条件全部完成，才创建新的授权记录：

1. `js-yaml@4.3.2` 依赖 PR 合并并恢复审计门；
2. #105/#106 在新的 main 基线上重新获得必需 CI 和独立 review；
3. SV2 实现与设计分开审查，提交确切 execution revision；
4. 生成新的 contract SHA、fresh study ID 和不可变 PENDING 记录；
5. owner 明确授权该 revision、contract、provider、数据范围、1 次请求预算和失败停止规则。

授权只覆盖这 1 个 SV2 request，不覆盖 C1 64-leg、Wave B、§11.5 或其他 Provider。
旧 SV1/V1/V2/V3/V4 身份全部 retired/consumed，不能继承。

## 后续路线

```text
#107 js-yaml deps PR
  → #105/#106 review + merge / new-main CI
  → SV2 implementation + zero-provider review
  → fresh authorization
  → one-request SV2 live proof
  → PASS: close mechanism gate
  → §11.5 E0: 2–4 Native/Runtime pairs, Dose > 0 check
  → E1: 8–16 pairs if justified
  → only then reconsider 64-leg
```

SV2 失败时保留完整失败证据并停止；不能自动进入 E0。SV2 通过时也不自动启动 64-leg。

## 当前明确不做

不重跑 SV1；不恢复历史身份；不把 SV1 的 `toolResults=[]`、`answerMatched=false` 或硬编码工具结构
指纹当作行为证据；不修改历史失败措辞；不把 carried removal 作为 SV2 必测终点；不做 Native 对照、
proactive re-read、更多模型、UI、扩样、成本估计或任务效果分析。
