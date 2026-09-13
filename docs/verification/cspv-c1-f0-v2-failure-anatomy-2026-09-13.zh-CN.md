# F0-v2 Failure Anatomy（离线）

日期：2026-09-13（Asia/Shanghai）

状态：`CLOSED / ZERO_PROVIDER / DESCRIPTIVE / NO CONTRACT CHANGE`

本记录只分析已消费的 F0-v2 study artifacts，不改变 F0-v2 合同、阈值或执行结果，不读取 credential，不访问 Provider，
也不重跑任何 identity。

## 输入与方法

```text
Study identity                     = c1-f0-v2-20260913-341fbab9
Study result                      = VALID / F0_V2_FEASIBILITY_NO_GO / CONSUMED
Run manifest SHA-256              = 5c76e91e6fcba2cb8fadf353e424ee9ce73661ff8b44a44937bbe7ec5db9728a
Response ledger SHA-256            = 1f2a6497ab82cba24efe01a73b32f2eb560199d8f71f2fc0dba009f892da9c6f
Tool provenance SHA-256            = d81d4c0446404bc9023d6c75d2c2484351a99fe3ede25ede7774d3c629039c1e
```

分析按 `runId → response call → tool execution → provenance → final run record` 连接，保留所有 started runs，
不删除 budget exhaustion、tool failure 或 oracle failure。所有结论都是描述性轨迹观察。

## t1：任务完成与 operational recovery 分离

`t1` 的 16 个 run 全部完成任务并通过两个 oracle：

```text
FEASIBILITY_SUCCESS                  = 16/16
Oracle PASS                         = 16/16
Budget exhaustion                   = 0/16
Changed path scope                  = PASS for 16/16
Recovery status                     = RECOVERED for 16/16
Unrecovered-tool-failure runs       = 4/16
```

4 条严格标记为 unrecovered 的轨迹是：

| Run ordinal | Response calls | Tool executions | Tool errors | Linked successful recoveries | Error sequence | Final state |
| ---: | ---: | ---: | ---: | ---: | --- | --- |
| 3 | 8 | 9 | 2 | 1 | `PACKAGE_MANAGER → NODE_TEST` | task success / oracle PASS |
| 7 | 9 | 10 | 2 | 1 | `PACKAGE_MANAGER → NODE_TEST` | task success / oracle PASS |
| 9 | 9 | 11 | 2 | 1 | `PACKAGE_MANAGER → NODE_TEST` | task success / oracle PASS |
| 29 | 8 | 11 | 2 | 1 | `PACKAGE_MANAGER → SHELL_OTHER` | task success / oracle PASS |

这 4 条轨迹的共同结构是：早期 bash 命令失败，随后出现一条带 linkage 的纠正动作，但最终成功的验证命令本身
没有通过 `recoveryOfToolCallId` 关联。因此当前 `unrecoveredToolFailure` 是严格的 operational 定义，不能直接等同于
任务没有被语义恢复。

这不是修改 F0-v2 gate 的理由。它说明后续设计需要单独区分：

```text
operational recovery linkage
        vs
semantic task recovery after a transient tool fault
```

当前数据只支持提出该问题，不支持事后改判 4 个 run 或声称 recovery 已被证明安全。

## t2：多文件迁移是主要 Native feasibility bottleneck

`t2` 的 16 个 run 呈现明显不稳定：

```text
FEASIBILITY_SUCCESS                  = 7/16
FEASIBILITY_FAILURE                  = 9/16
Budget exhaustion                   = 8/16
Oracle PASS                         = 10/16
Unrecovered-tool-failure runs       = 8/16
Unknown                            = 0/16
```

8 个 budget-exhausted run 的共同点是都达到冻结的 24 Provider-call 上限；它们的首个错误位置与错误类型如下：

| Run ordinals | 首个错误位置 | 首个错误类型 | 最终 oracle PASS | 完整 9-path scope |
| --- | ---: | --- | ---: | ---: |
| 2 | 19 | `bash / PACKAGE_MANAGER` | 1 | 1 |
| 4 | 2 | `read / PATH_NOT_FOUND` | 0 | 0 |
| 14 | 2 | `read / PATH_NOT_FOUND` | 1 | 1 |
| 18 | 16 | `bash / PACKAGE_MANAGER` | 1 | 1 |
| 22 | 18 | `bash / SHELL_OTHER` | 0 | 0 |
| 24 | 2 | `read / PATH_NOT_FOUND` | 0 | 1 |
| 26 | 20 | `bash / PACKAGE_MANAGER` | 0 | 0 |
| 28 | 2 | `read / PATH_NOT_FOUND` | 0 | 0 |

`t2` 另有 1 个非预算 failure（run 6）：5 个 response calls、12 个 tool executions、无 tool error，但 objective oracle
FAIL 且没有产生 fixture change。这与 8 个 budget exhaustion 是不同失败类别，不能合并解释。

成功与失败轨迹的描述性差异：

```text
t2 success (7 runs)       median response calls = 20, median tool requests = 33, oracle PASS = 7/7
t2 budget failure (8)     response calls = 24 for all, median tool requests = 33, oracle PASS = 3/8
t2 terminal failure (1)   response calls = 5, tool requests = 12, oracle PASS = 0/1
```

因此瓶颈不是单纯“错误次数更多”：成功组和预算组的中位 tool-request 数相同，但预算组全部耗尽 24 calls；失败轨迹
还伴随 edit-match、path-not-found、package-manager 和 test command 的混合序列。当前证据支持“多文件迁移在冻结 envelope
下不稳定”，不支持把原因归结为单一变量。

## 全 study failure taxonomy

```text
Tool executions                     = 725
NONE                                = 624
COMMAND_FAILED                     = 64
EDIT_MATCH_COUNT                   = 32
PATH_NOT_FOUND                     = 5

Recovery actions                   = NONE 624
                                      INSPECT_COMMAND_RESULT 64
                                      REISSUE_CORRECTED_ARGUMENTS 32
                                      REREAD_TARGET 5

Side-effect attribution            = EDIT_TOOL 152
                                      BASH_TOOL 3
                                      NONE 570
Provenance status                   = COMPLETE for all 32 runs
```

所有 32 个 run 都有完整 provenance 和 post-run adjudication；因此 F0-v2 的 NO_GO 不是 evidence loss、UNKNOWN 膨胀或
shared invalidator 混入，而是冻结 feasibility/safety gate 的真实失败。

## 研究含义与边界

当前可以保留两类后续问题：

```text
F1 — Native Feasibility Frontier
固定 task / prompt / provider / tool semantics，逐一改变单个 envelope 变量，寻找 Native 可行边界。

R0 — Runtime Rescue
在新的独立合同中研究 Runtime 是否能把已知 Native-infeasible stress regime 推回可行区间。
```

这两条线都不是 F0-v2 的补跑，也不能直接从本报告生成 executable contract。任何改变 budget、task、prompt、tool
semantics、recovery policy 或 Runtime assignment 的实验，都必须新建 contract、execution binding、identity 和授权。

F0-v2 的正式结论保持：

```text
Execution validity          PASS
Execution precision         PASS
Native feasibility          NO_GO
Runtime effectiveness        NOT MEASURED
T0 / E1                     HOLD
```
