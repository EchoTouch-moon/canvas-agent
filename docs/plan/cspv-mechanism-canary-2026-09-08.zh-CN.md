# 独立只读机制 Canary：待 owner 授权

状态：执行器已准备；真实 Provider 调用尚未授权、尚未执行。
这是一项独立机制诊断，不是 C1 V4 恢复、64-leg 矩阵补跑或任务效用实验。

## 要回答的问题

在真实 Provider 请求中，重复读取的旧来源能否被移除并在后续请求持续保持移除，
同时保留最新同内容来源、工具协议连续性，以及完整的失败账本？
模型是否按提示产生单独读取不预先假定；未形成合格干预同样是允许的失败结果。

## 冻结范围

| 项目 | 范围 |
| --- | --- |
| 合同 | 源码常量 `C1_MECHANISM_CANARY_V1`，完整 JSON 与 SHA-256 随待授权绑定保存 |
| 模型 | Step Plan / `step-3.7-flash`，无 fallback |
| 数据 | 只有下列合成 README、固定诊断提示、既有 system/tool envelope，以及该诊断内的响应和读取结果 |
| 顺序 | Native → Runtime，1 pair / 最多 2 leg，串行 |
| 请求 | 每 leg 最多 3，合计最多 6 |
| 工具 | 只执行 `read` 且参数严格为 `{"path":"README.md"}`；每 leg 最多 2 次读取，总计最多 4 |
| 响应上限 | 沿用适配器每请求 `max_tokens=16384`；不是实际用量或费用估计 |
| 时间 | 每请求超时 30 秒；每 leg 120 秒、全程 240 秒预算门；不表示进程被硬实时调度 |
| 状态 | fresh single-use identity，任何终止或崩溃后均不 resume/reuse/retry |
| 记录 | metadata-only checkpoints、分臂诊断结果和全程/完成/未完成账本；不保存凭据或 raw payload |

README 的全部内容：

```text
# Synthetic mechanism diagnostic
The diagnostic marker is COBALT-17.
This file contains no project or personal data.
```

固定提示要求模型逐次读取 README 两次，然后仅返回标记；禁止 edit、bash 和其他路径。
执行器会在实际工具执行前校验整个请求批次，越界请求触发停止，不依赖模型自行遵守。
Native 与 Runtime 使用同一提示、相同合成文件及相同工具限制。

Runtime 仅对已在工作集中出现过、或已有成功移除证据的工具调用/结果对应用候选规则：
同一路径、相同完整纯文本读取内容、无跨越 edit 的重复，才用最新副本替代旧副本。
混合 assistant 内容、错误结果、opaque 内容、歧义 ID、额外读取参数、受保护证据均保留。
没有干预机会时不得伪造 REMOVE。历史移除必须绑定旧 transition 和准确消息指纹。

## 通过与停止

每臂需要正常 terminal outcome、恰好两次成功读取及正确的诊断标记。
Runtime 还须在至少一次真实请求上 `runtimeContextChanged=true`。
来源物化、协议保护、绑定、预算、tool scope 或 evidence 持久化失败都停止下一请求/下一臂。
Native 失败时不执行 Runtime；不为凑齐矩阵补跑。

PASS 只说明这一个受控机制诊断的路径成立。不证明自然任务会频繁出现重复、策略提高质量、
节省费用、跨模型有效，或完成恢复能力的真实比较。历史 V4 的重复机会仍因缺少内容证据而未知。

## 授权绑定与运行入口

先保存本地提交，再生成 ignored 的 `authorization.pending.json`，其字段包括：
`decision=PENDING`、具体 executionRevision、fresh studyId 和 contractSha256。
生成候选文件不 claim identity。真实 identity 永久登记在 Git common directory，跨工作区/输出目录共享且永不释放。`--live` 会拒绝 PENDING、错误 SHA、错误合同和脏工作区；
只有 owner 对该具体范围明确授权后，才能写入 AUTHORIZED 记录并执行。
凭据通过 `STEP_PLAN_API_KEY` 在通过本地门与独占身份申请后读取，不输出或持久化。

入口：`research/context-benchmarks/scripts/c1-mechanism-canary.ts`。
`--fake` 走同一个执行器、真实本地只读工具和全部终止门，但不实例化 Provider response source。
`--live` 才能访问 Provider，并且需要上述完整授权对象。

本地验证见[后续执行报告](../verification/cspv-c1-followup-execution-2026-09-08.zh-CN.md)。
