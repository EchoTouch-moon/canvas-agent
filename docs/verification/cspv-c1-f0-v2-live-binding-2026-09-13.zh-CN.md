# F0-v2 Authorized Provider Binding 验证记录

日期：2026-09-13（Asia/Shanghai）

状态：`IMPLEMENTED / FAKE_FETCH_E2E_PASS / BINDING_REVIEW_REQUIRED / NO_PROVIDER`

本记录对应新增的 `research/context-benchmarks/c1/f0/v2/runner/c1-f0-v2-live-binding.ts`。它实现了 F0-v2
的 authorized-provider wiring，但本记录只使用注入的 fake fetch，不读取真实 credential，不访问外部网络，不 claim
live study identity。

## Exact binding

```text
Freeze candidate SHA-256            = 31663b2833ea8ecf46fdc1165dd69b87e12c4ce1999fd595307368448d0606a7
Final-bound run-contract SHA-256    = b340c987903318b0fed72de26007cc4a29d88cae0ac51a399eaa33cd4c6ebdab
Execution revision                  = c072af5c4fb3245a74e457a616d0c2b78ddd3f3d
Execution surface SHA-256           = bde57600d2f57ab48210298bcaa0b58283fe003301f617aa506eacddb46f0ae2
Provider config SHA-256              = bdb805044bb9548a79493249a9a5bdea87600e072caf305903079662a128e86a
Enrollment manifest SHA-256          = 2bfcad11078758c21a9ca799357553d08beb08065cea2efd179eade7e0a04e38
Node range                          = >=24.0.0 <25.0.0
```

研究语义仍由 `31663b…` candidate hash 冻结；新增 live binding 只改变 executable surface 与对应 final-bound hash。

## 执行边界

live runner 的 preflight 顺序为：

```text
Node 24 + clean worktree
→ 读取并验证 FINAL_BOUND contract
→ 现场重算 execution revision / surface hash
→ 校验 owner authorization 的全部 binding
→ 读取 STEP_PLAN_API_KEY 到内存
→ 准备 strict provider binding
→ 原子 claim exact studyId
→ 创建 authorized response source
→ 首次 Provider request
```

缺少 credential、identity 冲突、合同/manifest/provider/surface 不一致，都会在第一条请求前 fail closed。fallback、
implicit retry、resume、reuse、rebind 均禁止。

credential-free runner 仍保持独立：

```text
C1_F0_V2_RUNNER_MODE               = CREDENTIAL_FREE_NATIVE_ONLY
responseSource                      = SCRIPTED_FAKE
```

live runner 使用：

```text
C1_F0_V2_LIVE_BINDING_MODE         = AUTHORIZED_PROVIDER_NATIVE_ONLY
responseSource                      = AUTHORIZED_PROVIDER
```

两种模式共享已验证的 `C1LiveBindingDriver`、hardening adapter、post-run snapshot、pre-cleanup adjudication、cleanup
和最终 run disposition 逻辑，但不能互相切换或伪装。

## Fake-fetch E2E

`c1-f0-v2-live-binding.test.ts` 使用临时 `.env` 与注入的 provider-shaped fetch，完成：

- 32 个 Native run、两个 task 各 16 次、确定性交替顺序；
- 32 个 authorized-provider response source 请求，usage 解析为 `PROVIDER_REPORTED`；
- provider request/checkpoint/response/tool/provenance/artifact join；
- cleanup 前 `PRE_CLEANUP_ADJUDICATION` 与 cleanup 后唯一 final disposition；
- raw credential、assistant content、provider payload、tool arguments/results 不进入 durable artifacts；
- provider usage schema conflict → `STUDY_INVALID` 并阻断剩余 runs；
- binding mismatch 在 credential read 与 identity claim 前失败。

验证结果：

```text
Node 24 F0-v2 targeted tests       14/14 passed
Node 24 benchmark suite            37 files / 282 tests passed
headless core gate                 audit / format / lint / typecheck / test / build passed
Injected fake fetch calls          32
Real Provider calls / network      0 / 0
```

## Fresh identity preparation

当前授权准备记录中的候选 identity 仍只是未 claim 值。live binding 代码改动后，旧候选授权记录必须重新绑定；下一份
授权记录应基于本记录的 exact final contract 与 execution surface 重新生成 fresh studyId。

在新的独立 binding review、PR #128 stack 收口和 owner 明确签署之前：

```text
study identity claim       NO_GO
real credential read       NO_GO
live Provider execution   NO_GO
T0 / E1                    HOLD
```
