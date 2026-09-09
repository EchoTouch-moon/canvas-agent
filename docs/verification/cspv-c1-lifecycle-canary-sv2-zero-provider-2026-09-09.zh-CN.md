# C1_LIFECYCLE_CANARY_SV2：零 Provider 实现验收

日期：2026-09-09。状态：`IMPLEMENTED / ZERO_PROVIDER_PASS / LIVE_NO_GO`。
本记录绑定实现分支，待提交后填写最终 execution revision；不构成真实 Provider 授权。

## 实现范围

新增 `research/context-benchmarks/src/c1-lifecycle-canary-sv2.ts` 和对应入口/测试。
SV2 使用一个 Runtime leg、最多一个 Provider request。Harness 在临时 sandbox 中实际执行并验证：

```text
read src/a.js @ v1 → edit src/a.js SUCCESS → current file @ v2
```

随后先生成 `C1_LIFECYCLE_REPLAY_RECORD`、同步 fsync 写入并读回，离线 adjudicate 为 `SUPERSEDED`，
应用 `C1_SUPERSEDED_VERSION_POLICY_V1`，核对 `MATCH` 和 provider-bound source/message 侧的陈旧读取对缺席，
最后才进入共享 binding driver。Provider response receipt 继续由现有 metadata-only checkpoint sink 持久化。

为支持 seeded boundary，共享 `C1LiveBindingDriver` 增加可选 `initialWorkingSet` 输入；未提供时保持既有
`null` 起始行为，旧 C1/V4 调用不改变。

## 冻结候选绑定

| 项目 | 值 |
| --- | --- |
| Contract | `C1_LIFECYCLE_CANARY_SV2` |
| Policy | `C1_SUPERSEDED_VERSION_POLICY_V1` |
| Contract SHA-256 | `87bd74f1caea0a80cee8c4c85da6d3768a52ef950548de630516c3e8f4abb613`（代码常量运行时重算） |
| Provider/model | Step Plan / `step-3.7-flash`，无 fallback |
| Scope | Runtime-only，1 leg，最多 1 request，Provider tool request 上限 0 |
| Synthetic input | 中性 `AGENTS.md`、`src/a.js` v1/v2；不保存原文 |
| Claims | mechanism only；不产生任务质量、成本或 token savings 结论 |

最终 live 运行必须把 fresh study identity 和代码提交 SHA 写入新的授权记录；旧 SV1/V1–V4 identity 不可复用。

## 假源执行结果

脚本级 `--fake` 入口结果：

```text
status=PASS
providerCalls=0
networkRequests=0
fakeResponses=1
replayRecords=2 (NOT_CANDIDATE=1, SUPERSEDED=1)
removedSourceKeys=run/tool-call://sv2-seed-read-a-v1,
                  run/tool-result://sv2-seed-read-a-v1
providerBoundSourceKeys=仅中性 bootstrap 对 + edit 对
stalePairPresentInProviderBoundMessages=false
callAccounting=1 permit / 1 normalized response / 0 missing response / 0 provider tools
```

所有 durable artifacts 均未包含 v1/v2 文件内容、bootstrap 原文或 raw Provider payload。
同一输出目录二次启动被拒绝；错误 live authorization 在输出目录、身份注册和凭据读取前拒绝。

## 验证命令

- `pnpm --filter @canvas-agent/context-benchmarks typecheck`：通过。
- `pnpm --filter @canvas-agent/context-benchmarks test`：26 个测试文件、214 项通过。
- 定向 SV2：4 项通过。
- `pnpm install --frozen-lockfile --filter '!@canvas-agent/desktop' --ignore-scripts`：通过。
- `pnpm check:core`：通过（headless audit、变更文件格式、typecheck、非桌面 tests/build）。
- 脚本级 fake：`research/context-benchmarks/scripts/c1-lifecycle-canary-sv2.ts --fake`，
  输出边界检查通过，Provider/network calls 均为 0。
- `git diff --check` 与两个 workflow 的 YAML 解析：通过。

完整实现 PR 的远端 CI 和独立 review 仍是后续门。未执行真实 Provider，未创建 SV2 live identity，
未启动 §11.5 或 C1 64-leg。

## 下一步

1. 以本提交生成 fresh PENDING authorization，等待覆盖 exact revision、contract SHA、模型和 1 request 预算的 owner 授权。
2. 授权后只执行一次 SV2 live request；任何 pre-send gate、receipt、replay 或 boundary 失败立即 terminal/retired。
3. PASS 只关闭真实 provider-bound pure-evict 机制问题，然后另行评审 §11.5 E0；不自动开启 64-leg。
