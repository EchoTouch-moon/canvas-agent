# 机制 Canary V2：提示修订与待授权绑定

日期：2026-09-08。承接 [V1 计划](cspv-mechanism-canary-2026-09-08.zh-CN.md) 与
[V1 执行报告](../verification/cspv-c1-mechanism-canary-live-execution-2026-09-08.zh-CN.md)。

状态：已于 2026-09-08 经 owner 授权执行一次（studyId `c1-mechanism-20260908-2d05cb78`），
结果 FAIL / CANARY_STOP——V2 提示仍未诱导第二次读取，与 V1 同形。身份已永久消耗。
结果详见[V2 执行报告](../verification/cspv-c1-mechanism-canary-v2-live-execution-2026-09-08.zh-CN.md)。

## 为什么有 V2

V1（`C1_MECHANISM_CANARY_V1`）真实执行结果为 CANARY_STOP：模型读取 README 一次后直接作答，
未形成"同一内容两次独立读取"的前置条件，机制问题保持未知。V1 身份已永久消耗，不能在原绑定下重跑。

## 变更范围（刻意最小）

合同 `C1_MECHANISM_CANARY_V2` 与 V1 的差异**只有两项**：`contractId` 与 `promptSha256`。
fixture、预算（≤6 请求 / ≤4 读 / 30 秒超时 / 240 秒全程）、工具范围、判定门、无 fallback 全部不变，
使"提示文本"成为唯一自变量。

V2 提示给第二次读取一个具体目的（文件可能在两次读取之间变化），并明确禁止在两次读取完成前作答：

```text
This is a read-only mechanism diagnostic. The file README.md may change between reads, so one earlier read or the bootstrap copy is not enough. Step 1: call read on README.md. Step 2: call read on README.md again as a separate step to confirm whether the content changed. Step 3: only after both reads return the same diagnostic marker, reply with exactly that marker and nothing else. Do not call edit or bash or any other tool. Do not read any other path. Do not reply before both read results are present.
```

工程改动：合同构造提取为共享 builder（V1 序列化字节不变，SHA-256 仍为
`eac271d5b01ebb6b3bfe5d899737acf21cc878b95ab9ea2ad72b56892c2a250d`，有定向测试锁定）；
执行器按绑定中的 contractSha256 严格解析合同版本，未知 SHA 直接拒绝；
Live 授权的合同 SHA 与所选版本不一致时，在身份申请与凭据读取之前拒绝。

## 通过与停止

与 V1 完全相同的门：每臂正常 terminal、恰好两次成功读取、标记正确；Runtime 至少一次
`runtimeContextChanged=true`。Native 失败不执行 Runtime；任何失败即停，不重试。
模型仍可能不形成两次读取——这仍是允许的失败结果，不为凑结果调整门或补跑。

## 授权绑定

本地提交后生成新的 PENDING 绑定：fresh studyId、新 executionRevision、V2 contractSha256。
owner 于 2026-09-08 对话中授权"再试一次"，覆盖且仅覆盖该新绑定的一次性执行。
V1 消耗记录与证据保持不可变；C1 64-leg 正式实验授权状态不变（仍 NO_GO）。
