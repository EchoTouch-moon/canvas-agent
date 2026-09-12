# F0-RCA Prospective Hardening 验证记录

日期：2026-09-13（Asia/Shanghai）

状态：`IMPLEMENTED / PROSPECTIVE / ZERO_PROVIDER / RECOVERY_SEMANTICS_HARDENED`

本变更承接 F0-RCA，对未来 F0-v2 执行增加安全的 side-effect provenance 和 tool-error recovery。它不修改
已消费的 `c1-f0-20260912-41753674`，不回填历史 artifact，也不改变 `F0_FEASIBILITY_NO_GO`。

## 修复内容

新增独立模块：

```text
research/context-benchmarks/c1/f0/hardening/c1-f0-tool-hardening.ts
```

### Side-effect provenance

未来执行可逐 tool request 记录：

- `changedPaths`、before/after snapshot hash 和 snapshot 可用性；
- `sideEffectSource=EDIT_TOOL | BASH_TOOL | NONE`；
- bash 的 `commandClass` 与 `commandHash`，不保存 command 原文；
- canonical request signature、`failureClass`、`errorDigest`、连续失败 streak 和 recovery action；原始 arguments
  不进入 durable provenance。
- `recoveryOfToolCallId` 与 `recoveryAttemptOrdinal` 组成 metadata-only recovery linkage，允许不同 signature 的
  corrected request 在成功后被记录为 `RECOVERED`。

这样可以把“执行后出现越界文件”与具体 tool 类型、安全 command hash 和文件变化关联起来，同时保持 raw
command、assistant 内容和 tool result content 不进入 durable provenance。

### Tool-error recovery

工具失败会被归类为 `PATH_NOT_FOUND`、`EDIT_MATCH_COUNT`、`COMMAND_FAILED`、`COMMAND_TIMEOUT`、
`COMMAND_OUTPUT_LIMIT` 等固定类别，并向下一次 model observation 添加结构化恢复提示。重复检测使用 tool name
与 canonicalized semantic arguments 的 hash，不受 JSON key 顺序或空白格式影响。相同 canonical request 连续
失败达到预设次数后，第三次请求被标记为 `REPEATED_FAILURE_BLOCKED`；不同 request 或成功执行都会清除
identical-failure streak。这不是 study-level retry，也不会自动重跑 run。

每个 corrected request 都由模型显式发出，并通过 `recoveryOfToolCallId` / `recoveryAttemptOrdinal` 关联到
最近一次失败；因此 corrected request 使用不同 signature 仍可正确计入 `RECOVERED`。blocked request 必须在
before/after snapshot 中证明没有 side effect。

未来 F0-v2 runner 还必须在 cleanup 前完成 immutable post-run snapshot，再执行 oracle / writable-scope adjudication
和 evidence persistence，最后清理 live sandbox。snapshot 或 provenance 不可用时记为 `UNKNOWN`，不能压成
`FEASIBILITY_FAILURE`；missing row、schema conflict 或 raw-data leakage 才是 study invalidator。

该策略是显式 opt-in。现有 E0/F0 execution runner 默认不启用，未来 F0-v2 必须在新 contract、execution
revision 和新 study identity 中声明并绑定。

## 零 Provider 验证

新增 `c1-f0-rca-hardening.test.ts` 的 6 项回归：

1. bash collateral write 被归因为 `BASH_TOOL`，只留下 command hash 和 changed paths；
2. edit match failure 得到固定 recovery hint，并在第三次相同失败后阻断；
3. command failure 分类、error digest 和 bounded provenance 生效；
4. JSON key 顺序变化仍得到同一 canonical request signature，并触发重复失败阻断；
5. 不同 signature 的 corrected request 能建立 recovery linkage、计入 `RECOVERED`，并清除连续失败 streak；
6. 不同 request signature 会清除前一条 request 的连续失败 streak，不会误触发 block。

Node 24 下 benchmark 全量回归为 **33 个测试文件、258 项通过**；typecheck 与 Prettier 检查通过。

## 研究边界

```text
历史 F0 study                  IMMUTABLE / CONSUMED
F0-RCA hardening               PASS / PROSPECTIVE / RECOVERY_SEMANTICS_HARDENED
F0-v2 contract                 DESIGN_REVISED / NOT_EXECUTABLE
新的 Provider execution        NO_GO
T0 / E1                        HOLD
```

任何未来启用该 hardening 的执行都必须重新冻结 task、tool envelope、provenance schema、recovery policy、
execution surface 和 identity；不得把它当作历史 F0 的补跑或结果修正。
