# 机制 Canary V3：bootstrap 重复对设计（待 owner 授权）

日期：2026-09-08。承接 [V2 计划](cspv-mechanism-canary-v2-2026-09-08.zh-CN.md)、
[V1](cspv-c1-mechanism-canary-live-execution-2026-09-08.zh-CN.md) 与
[V2](../verification/cspv-c1-mechanism-canary-v2-live-execution-2026-09-08.zh-CN.md) 执行报告。

## 从两次真实执行学到的

V1/V2 均为 CANARY_STOP：step-3.7-flash 在 bootstrap 已含 README 内容时不会自发重读，
两种提示策略都未形成"两次模型读取"。但复盘 V1/V2 的请求证据发现：
**bootstrap 本身就携带一对 README 的 read 调用/结果**（`…-shared-bootstrap-01`）。
模型只要读一次，下一次请求的历史中就存在两对同路径同内容的读取——
这正是 duplicate-read 策略设计要处理的重复。V1/V2 把重复来源限定为"模型读两次"，
这个判定门假设才是真正的阻塞点，而不是机制条件不可达。

## V3 变更（相对 V2）

合同 `C1_MECHANISM_CANARY_V3` 序列化与 V2 仅差 `contractId` 与 `promptSha256`：

1. **提示改为要求读取一次**：`Call read on README.md once, then reply with only the diagnostic marker…`
2. **读取计数门从"恰好 2 次"放宽为"1–2 次"**（门与 V1/V2 一样位于执行器代码，按 contractId 冻结：
   V1/V2 保持 {2,2}，V3 为 {1,2}，有定向测试锁定 V1 在单次读取轨迹下仍 FAIL）。

其余全部不变：fixture、预算（≤6 请求 / ≤4 读）、工具范围、超时、无 fallback、单次身份、
Native 失败不执行 Runtime、PASS 不蕴含任何效能或成本结论。

## 机制验证点（假源已离线验证）

- 单次读取轨迹（与两次真实执行中观察到的模型行为一致）：Runtime 第 2 次请求
  `REMOVE SUPERSEDED ×2`（bootstrap 旧对）+ `ADD CURRENT_TARGET ×2`（模型新对），
  最终 provider-bound 上下文只剩新对；同轨迹在 V1 门下 FAIL（门差异被锁定）。
- 两次读取轨迹：移除在第 3 次请求**持续保持**（carried 绑定原 transition 与准确指纹）。
- 模型若一次都不读：无干预机会，`runtimeContextChanged=false`，按既有规则 FAIL——
  仍是允许的失败结果，不为凑结果伪造 REMOVE。

预期真实执行成本下降：模型读一次时每臂 2 次请求，合计约 4 次 Provider 调用（预算上限 6 不变）。

## 授权绑定

本地提交后生成新的 PENDING 绑定：fresh studyId、新 executionRevision、V3 contractSha256。
只有 owner 对该具体范围显式授权后才写入 AUTHORIZED 并执行。
V1/V2 消耗记录与证据保持不可变；C1 64-leg 正式实验授权状态不变（仍 NO_GO）。
