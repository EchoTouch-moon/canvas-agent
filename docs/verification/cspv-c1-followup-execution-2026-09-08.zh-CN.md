# C1 后续计划执行与机制实验

日期：2026-09-08。基线：`cf4b7ea61be784a92bcefec895b2d36888b91172`。
修改位于独立分支 `codex/c1-v4-offline-followup`；本地验证，不代表远端 CI 或合并。
真实 Provider 调用为 0。下文所有响应数若未注明 V4，均为受控假响应。

## 已交付的修复

1. **失败路径账本。** `RESPONSE_RECEIVED` 在工具开始前记录已正规化响应；
   `TOOL_EXECUTION_RECORDED` 在每个工具结束后单独持久化。工具批次只有在事件写入成功后才继续。
   manifest 保留原 completed-only 数字，新增 schema 2 checkpoint 对应的 `callAccounting`，
   区分全程、完成与未完成 leg。许可不等于响应；没有最终 oracle 就是 UNOBSERVED。
   写入失败后的尾部标记 UNKNOWN_AFTER_WRITE_FAILURE，不把未确认的物理执行当作已知零。
2. **连续干预。** 首次实验在第 3 次 Runtime 请求出现 UNEXPLAINED_MEMBERSHIP：
   之前已移除的来源再次出现在完整历史中，而当前 transition 不会重复 REMOVE 它们。
   C1 现在复用已有 `applyCarriedRemovals`，仅沿用已成功发送且准确消息指纹未变化的成对移除。
   记录逐决策 reasonCodes/sourceVersionId、原移除 transition、pair fingerprint 与 carried source keys；拒绝内容漂移和单边恢复。
3. **有依据的候选输入。** 使用已有 `scanDuplicateReads` 的相同内容/路径和无跨 edit 语义，
   加上错误、opaque、混合内容、歧义 ID、额外参数及保护项的保守过滤。
   只有曾被提交或具有成功移除证据的来源可排除，避免新来源无 REMOVE 决定，或旧来源来回 ADD。
   候选仅进入新诊断通路，未改写原冻结 live launcher 的策略、C1 合同或 V4 原件。

## 实验结果与证据层级

[最终实验 R4](./cspv-c1-intervention-probe-2026-09-08-r4.json) 绑定 7 个实际执行模块的 SHA-256，
并记录修改前 Git 基线。最终模块哈希已再次核验一致。

| 条件 | 完成 leg | 假响应 | Runtime 改变的调用 | REMOVE 决策条目 |
| --- | ---: | ---: | --- | ---: |
| 原 observation 基线 | 2 | 6 | 无 | 0 |
| 重复读取候选 | 2 | 6 | 第 2、3 次 | 4 |

两条件各有一 Native/Runtime pair。进入策略前的消息指纹逐调用相同；协议结构指纹相同。
候选第 3 次请求只保留最新工具调用/结果对，历史移除持续有效，没有通过恢复旧来源来掩盖组合问题。
到一个 pair 后显式停止；底层 orchestrator 的 KILL_SWITCH_BLOCKED 是这项有界探针的预定停止，
不把它冒充 64-leg C1 study PASS。探针自身按照上述门判为 PASS。

初始失败 [R1](./cspv-c1-intervention-probe-2026-09-08.json) 和中间 [R2](./cspv-c1-intervention-probe-2026-09-08-r2.json)
保留为诊断记录，不能替代带源码哈希和持续移除检查的 R4。
R1 的旧 `stop` 标签不可靠：其 candidate 只完成 Native，实际是 Runtime 第三次组合失败；
最终报告已按实际 operatorSignal 区分预定停止和提前失败，不回填旧 JSON。

既有 C1 treatment readiness 再次 PASS，提供受控同源恢复与保护链证据；
这不是新候选已经在自然任务上验证恢复效用。
V4 元数据没有原读取内容，无法反推其中存在多少相同内容重复机会。
假 usage 不参与成本估计或效果比较。

## 验证

- Node `24.15.0`：研究包 typecheck 通过。
- 研究包：21 个测试文件 / 163 项通过。
- V4 对账工具：13 项 Python 标准库测试通过。
- 连续移除、指纹漂移、单边恢复、未知新来源、错误/opaque/混合读取、受保护来源均有定向检查。
- 24 次 CONTINUE：24 个响应仍可对账，第 25 请求与下一 leg 均未发生。
- 已许可未响应、工具部分完成、checkpoint 写入失败、禁止后续工具等边界均经过假源检查。
- 独立 Canary 完整 fake 流程：2 leg、6 假响应、4 读取；身份复用拒绝，越界工具在执行前拒绝，
  缺失/错误 Live 授权及错误执行 SHA 在凭据读取和身份申请前拒绝。
  另在隔离临时 Git 仓库验证了跨输出目录的永久身份拒绝；凭据 getter 人为抛错，未实例化真实响应源。
- V4 26 原文件哈希与原独立裁定及本地归档仍一致。未修改历史合同或原始实验数据。
- `git diff --check` 通过。未运行无关 Electron 产品测试、真实 Provider 或远端 CI。

本地完整日志在 ignored 的 `research/context-benchmarks/reports/followup-verification-20260908/`。
本轮检查与落盘工具不新增 Python 或 Node 依赖；现有 Node 依赖按 lockfile 安装且禁用了安装脚本。

## 下一项：真实机制 Canary 尚待授权

[冻结范围](../plan/cspv-mechanism-canary-2026-09-08.zh-CN.md) 为新合同、纯合成 README、Step Plan
`step-3.7-flash`、最多 6 请求 / 4 次只读工具，Native 失败则不执行 Runtime。
本地提交后生成具体 executionRevision、fresh studyId、contractSha256 的 PENDING 绑定，
待 owner 授权才可执行。不是 V4 恢复，不生成任务效能或节省成本的结论。
