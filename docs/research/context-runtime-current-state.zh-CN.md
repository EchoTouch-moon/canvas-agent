# Context Runtime 当前状态索引

更新时间：2026-09-08（Asia/Shanghai）。本次更新在 `codex/c1-v4-offline-followup` 本地分支；未推送或合并远端。

## 当前结论

C1 V4 已真实尝试并终止。近端主线改为失败证据与干预可达性收口，不能继续使用此前“等待 V3 签署”的状态。
系统通路已有工程证据，但没有可信的 Native-vs-Runtime 效果结论。

```text
New Provider calls      NO_GO
V4 study                TERMINAL / RETIRED
Old study resume/reuse  FORBIDDEN
Wave B / productization NO_GO
```

V4 study：`c1-20260906-c1-feasibility-v1-5a4b5d58`，执行 SHA：`cf4b7ea61be784a92bcefec895b2d36888b91172`。
计划 64 leg、尝试 19、完成 18、终止未完成 1、未执行 45；完成 9/32 pair（T1 8、T2 1、T3/T4 0）。
全程记录 223 response / 279 tool executions；完成子集为 199 / 246，终止 leg 为 24 / 33。
最终 oracle 缺失仍为 UNOBSERVED；本轮独立对账未执行 frozen analyzer。

100 个 Runtime response 均没有记录上下文改变或 lifecycle eligibility，只有 ADD/KEEP。
此结果和分层样本不足共同限制解释：不能声称干预有效、节省 token，或从任务成功推断 Runtime 优势。
M5 未支持效率优势；M6–M9 的机制曝光不能替代完整任务比较。

## 本轮已执行与下一步

- 已完成：26 文件哈希校验、本机持久副本、可重复的 checkpoint 对账、13 项合成回归测试，以及绑定执行 SHA 的干预路径定位。
- 已完成核心修复：响应及逐工具事件独立持久化，manifest 明确区分全程与完成子集，异常尾部保留未知。
- 已执行受控干预实验：同输入基线保留全部来源，重复读取候选在第 2、3 请求发生移除；同时修复并验证连续移除的历史沿用与指纹边界。
- 下一项是真实只读机制 Canary：新合同、最多 6 请求，假 Provider 流程已通过；等待精确版本与身份的 owner 授权。V4 永不恢复、补跑或重绑定。

[后续实施验证](../verification/cspv-c1-followup-execution-2026-09-08.zh-CN.md) ·
[机制 Canary 计划](../plan/cspv-mechanism-canary-2026-09-08.zh-CN.md) ·
[本轮执行计划](../plan/cspv-c1-next-execution-2026-09-08.zh-CN.md) ·
[本轮验证报告](../verification/cspv-c1-v4-offline-followup-2026-09-08.zh-CN.md) ·
[机器对账结果](../verification/cspv-c1-v4-reconciliation-2026-09-08.json)

以下保留已有工程与合同绑定；历史 CI 结果是既有记录，本轮只核验最新 Git 基线和离线证据。

## 当前事实与绑定

| 项目 | 当前状态 | 绑定或解释 |
| --- | --- | --- |
| 远端 `main` | `cf4b7ea61be784a92bcefec895b2d36888b91172` | 2026-09-08 fetch 核验；PR #104 已合并。本轮未核对该提交 CI |
| PR #98 | `MERGED / CI_GREEN / IMPLEMENTATION_ACCEPTED` | implementation `55d834483ba044099e0be8d64b95028becabb014`；merge commit `583ecb74623b77dce2238f67faba1b2e046aaa9b`；实现 usage amendment 的 adapter/validator/serialization 兼容层 |
| PR #100 | `MERGED / CI_GREEN / ZERO_PROVIDER_CLOSURE_ACCEPTED` | merge commit `816c13c15ef8247ec9f27c981e025283be4e366b`；补齐 usage source map、正式 treatment 入口审计和离线 adjudicator 证据闭环 |
| PR #102 | `MERGED / CI_GREEN / LIVE_ENTRYPOINT_ACCEPTED` | merge commit `4d5e39a9b337d6cabdc84d450680bc54ad85561b`；实现正式 C1 live entrypoint 的授权、ground-truth-free bootstrap、scope gate 与 execution provenance |
| `C1_USAGE_CONTRACT_AMENDMENT_V1` | `FROZEN / MERGED` | 只调整 provider cache split 的可用性语义；原 `C1_RUN_CONTRACT_V1` 保持不变 |
| `C1_PROTOCOL_V1` | `FROZEN` | 比较问题、对照/处理臂、指标与裁决边界 |
| `C1_A_MANIFEST_V1` | `FROZEN` | 4 个任务层、fixture、oracle、anchors 与身份绑定 |
| `C1_RUN_CONTRACT_V1` | `FROZEN` | 32 matched pairs / 64 legs、AB/BA、主终点、预算与统计规则 |
| C1 treatment readiness | `FROZEN / PASS` | provider-bound Native fidelity、Runtime treatment 与 T4 cold/restored 证据已通过零 Provider readiness |
| C1 study orchestration | `MERGED / ACCEPTED` | 64-leg 顺序执行、隔离 sandbox、七类 metadata-only evidence、terminal/kill-switch |
| 首次 C1 Live attempt | `TERMINAL / NOT ADMISSIBLE` | study `c1-20260905-c1-feasibility-v1-35359a74`；1 次 provider/network attempt、0 个 completed leg、usage capability mismatch |
| 首次 study identity | `CONSUMED / RETIRED` | 永不 resume、reuse 或 rebind；不能用 #98 或后续修复继续该 identity |
| CR-005 | `CLOSED_AS_STOPPED_EXPERIMENT` | Run 1/Run 2 保留；没有把 C5/C6 伪装成补跑结果 |
| CSPV-B0/B1 | `POLICY_CAPABILITY_GAP → PASS` | 原 oracle 先暴露缺口，B1 在不改 frozen suite 的条件下修复并通过 |

## 冻结合同与历史授权入口

任何历史授权均不构成新执行许可。V2/V3 文件用于历史追溯；V4 的实际 terminal 状态以本页所链离线档案为据。
策略、任务、预算或执行版本改变，须新设计、新冻结和覆盖确切身份的授权。

相关冻结文件：

- [`C1 comparative effectiveness protocol`](../plan/cspv-c1-comparative-effectiveness-protocol-2026-09-01.md)
- [`C1 task / fixture manifest`](../plan/cspv-c1-task-fixture-manifest-2026-09-01.md)
- [`C1 analysis / run contract`](../plan/cspv-c1-analysis-run-contract-2026-09-01.md)
- [`C1 treatment readiness`](../verification/cspv-c1-treatment-readiness-2026-09-01.md)
- [`C1 live authorization gate`](../plan/cspv-c1-live-authorization-gate-2026-09-02.md)
- [`retired C1 live authorization record`](../plan/cspv-c1-live-authorization-record-2026-09-04.md)
- [`C1 usage contract amendment`](../plan/cspv-c1-usage-contract-amendment-2026-09-05.md)
- [`C1 Live authorization record V2 (historical / superseded)`](../plan/cspv-c1-live-authorization-record-2026-09-05-v2.md)
- [`C1 Live authorization record V3 (draft)`](../plan/cspv-c1-live-authorization-record-2026-09-06-v3.md)
- [`C0-L1 live evidence`](../verification/cspv-c0-l1-live-evidence-2026-09-01.md)
- [`CR-005 interim evidence analysis`](../verification/context-runtime-cr-005-interim-evidence-analysis.md)
- [`C1 zero-provider evidence closure`](../verification/cspv-c1-zero-provider-evidence-closure-2026-09-05.md)

## 范围与叙事边界

当前贡献是可观察、可追溯、可受控改变的上下文执行基础；策略效用仍未知。
UI、第二模型、更多策略与扩样属于候选方向，不能替代失败路径和干预输入的核心验收。
历史 CR-005、M 系列、readiness 与 V4 是不同证据层级，不混用计数或授权。
