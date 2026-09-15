# C1 V4 离线收口结果

日期：2026-09-08。执行源码基线：`cf4b7ea61be784a92bcefec895b2d36888b91172`。
本轮新增工具尚未提交；原件不变。本报告是本地验证，不宣称远端 CI、PR 审批或合并完成。

## 对账结果

以 2026-09-06 独立裁定 JSON 中的 26 文件 SHA-256 清单为锚核验原件。
源：`/private/tmp/c1-live-v4-evidence-20260906-5a4b5d58/study`。
持久副本：本工作区 `research/context-benchmarks/reports/c1-v4-20260906/study`（gitignored）。
副本全部哈希与原件及清单一致；这是一份本机归档，不是异地备份。

| 口径 | 响应 | 工具执行 | 输入 token | 总 token |
| --- | ---: | ---: | ---: | ---: |
| 全程已记录 | 223 | 279 | 1,068,755 | 1,148,241 |
| 已完成 18 leg | 199 | 246 | 885,467 | 952,309 |
| 终止未完成 leg | 24 | 33 | 183,288 | 195,932 |

计划 64 leg，尝试 19、完成 18、未完成 1、未执行 45。完成配对 9/32：T1 8、T2 1、T3/T4 0。
223 个许可均有关联响应；六类 projection 各 199 行，恰好覆盖完成子集。
原 manifest 的完成汇总没有计入终止 leg。最终 oracle 保留 UNOBSERVED，原 `PREFLIGHT_FAILURE` 保留。
缓存成本与生命周期率均不可估计；本工具不执行统计裁决。

机器结果：[reconciliation JSON](./cspv-c1-v4-reconciliation-2026-09-08.json)。

## 干预路径定位

以下行号均绑定上述执行 SHA，并非对整个 Runtime 所有通路的断言。

| 层 | 源码证据 | 判断 |
| --- | --- | --- |
| 正式 factory | `c1-live-study.ts:1645` | 使用 `C1LiveTaskObservationSource.fromFixture` |
| bootstrap | `c1-live-study.ts:439` | 所有 observed source 为 current target，excluded 为空 |
| 后续 observation | `c1-live-study.ts:450`；`c1-live-binding.ts:407` | 原样接受工具 observation；工具累积消息并重新把全部 source 列为目标、清空 exclusions |
| planning | `c1-live-preflight.ts:1848` | 传递上述目标/排除集合；预算固定 1,000,000；表示估计基于 source identity 元数据，不能当真实 prompt token |
| Provider 边界 | `c1-live-preflight.ts:2069`、`:2121` | eligible 来自显式差异要求或 lifecycle signals；changed 比较本轮 Runtime 与同输入 Native 的消息哈希 |
| 异常终止 | `c1-live-binding.ts:1292`、`:1302` | 第 24 响应 checkpoint 已写入，CONTINUE 随后抛错 |
| 完成汇总 | `c1-live-study.ts:1249` | 只有正常返回并完成 leg 才加 response/tool 总数 |

100 个 Runtime response 的 changed/eligible 都为 false，决策条目 ADD 278、KEEP 1784，REMOVE/REHYDRATE 0。
源码给出了这条正式路径缺少自然 exclusion/lifecycle 输入的解释，不能归咎于 Provider 不配合，
也不能推出所有自然任务都无删除机会或算法永远不能 REMOVE：其他信号、失效来源和预算分支需要各自验证。
changed=false 表示本轮处理前后的消息哈希相同，不代表两个独立 live 臂的完整轨迹相同。

## 实际验证

使用 Python 标准库实现离线工具，按 daily-coding 的最小范围原则，避免触及冻结 TypeScript 执行路径。
13 个合成回归测试通过：部分计数与未知值、哈希篡改、重复 response、无许可 response、序号缺口、
重复/缺失 projection、投影字段篡改、缺失 usage、工具错配、未响应许可、跨 study。
真实原件重算与本地归档重算一致；原件最终哈希再次核验一致。

在工作区根运行：

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s research/context-benchmarks/scripts -p 'test_reconcile*.py' -v
python3 research/context-benchmarks/scripts/reconcile_c1_evidence.py research/context-benchmarks/reports/c1-v4-20260906/study --baseline docs/verification/cspv-c1-v4-reconciliation-2026-09-08.json --output research/context-benchmarks/reports/c1-v4-20260906/recheck.json
```

输出路径须尚不存在。脚本不覆盖文件，也拒绝输出到原始证据目录内。
首次对账使用原独立裁定清单；后续以上命令复核本轮固化清单的一致性，并不新增独立真实性证明。

Provider 调用 0；未执行工具任务、冻结分析器或 Runtime replay。
Git fetch / PR 查询使用了网络，不能将本轮整体表述为零网络。
尚未做 Provider 账单核对、独立禁止字段认证、统计效果裁决或全仓测试；本轮没有产品或 TypeScript 改动。

下一步验收见[执行计划](../plan/cspv-c1-next-execution-2026-09-08.zh-CN.md)。
