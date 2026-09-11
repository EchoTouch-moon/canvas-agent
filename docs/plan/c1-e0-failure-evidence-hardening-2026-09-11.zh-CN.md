# C1 E0 终止 leg 证据一致性修复计划

日期：2026-09-11（Asia/Shanghai）

## 目标

修复 E0 live runner 在 leg 因 `maxCalls`、Provider response 或工具边界错误终止时的证据投影：已经写入
checkpoint 的响应和工具事件必须继续出现在失败 leg 的 metadata report 中；清理状态、调用计数和失败分类必须
反映实际事实。该修复不改变 E0 的 pair matrix、预算、Provider configuration、policy、Dose 语义或终止规则。

## 当前证据

授权运行 `c1-e0-20260911-b88b0b56` 已按 24-call leg budget 终止：Native leg 有 24 个
`RESPONSE_RECORDED` 和 37 个工具事件，但 `response-ledger.jsonl` 为空，失败 leg 的投影计数为零，且
`fixtureCleaned=false`。identity 已 retired，原报告不可回填或重跑。

本修复分支的绑定值为：`executionRevision=902f27f6b91ccd835e78b1796279d1dc6015a1c4`、
`executionSurfaceHash=9a088875a805e60f3aad852cfd0d21a29a2d207a485cd99222b7425d7b5f369f`、
`runContractSha256=8df91b5bf9390a4ab6dbaec55bca3f8bacfa4c952f7ed3c286c42a785b737d58`。

## 实施范围

1. 为 live binding leg failure 携带已经 checkpoint 的 metadata-only partial evidence。
2. E0 study runner 在失败 leg 和最终 report/artifact 中投影这些 partial rows，并保留未知的 terminal outcome、
   task correctness 与 Dose 结论。
3. 在清理完成后记录准确的 fixture cleanup 状态，并增加一个 credential-free injected-fetch 回归。
4. 重新计算新的 headless execution revision 与 Run Contract SHA；完成独立 review 和新的 owner authorization 前，
   不发起新的真实 Provider study。

## 完成条件

- 终止 leg 的 response/tool metadata 可通过 `runId` 与 checkpoint 对账；不写入 raw provider content、tool
  arguments、credential 或 authorization header。
- `NO_GO`、single-use identity、预算、fallback、retry/resume/reuse 规则保持不变。
- 目标测试、headless audit、format、lint、typecheck、build 与 Node 24 CI 通过。
- 新 execution revision 覆盖修复后的 headless surface；旧 identity 不恢复、不复用。
