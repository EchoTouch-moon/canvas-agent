# CR-005 Native + Shadow benchmark corpus verification

## 1. Branch and HEAD

- Branch: `agent/luna-cr-005-native-shadow-corpus`
- Review target: PR #26 current correction round (live/provider execution remains disabled)
- Review baseline HEAD: `ee4a78c` (the three security-boundary fixes were present; the
  output-limit regression was the remaining CI blocker).
- Current correction scope: one P1 deterministic output-limit test fix and one P2
  verification-record update; no live provider execution.

## 2. Corpus layout

The research-only boundary is `research/context-benchmarks/`:

```text
corpus/<category>/{fixture,reference}/
manifests/*.json
src/{manifest,fixture-generator,aggregation,validation,live-runner}.ts
tests/*.test.ts
output/                         # gitignored live metadata
```

No Active renderer or provider-request rewrite was added. The Pi integration has
only an additive, inert queue for authoritative metadata-only repository seeds;
the CR-005 runner uses it only after an actual Agent read.

## 3. Six task definitions and category mapping

| Category | Task id | Intent |
| --- | --- | --- |
| C1 localized bug fix | `cr005-c1-localized-bug-fix` | percentage discount arithmetic |
| C2 multi-file feature | `cr005-c2-multi-file-feature` | formal greeting option across config/greeting/index |
| C3 failing-test diagnosis | `cr005-c3-failing-test-diagnosis` | cache-hit factory regression |
| C4 constrained refactor | `cr005-c4-constrained-refactor` | domain-owned normalization under an architecture rule |
| C5 unrelated discovery | `cr005-c5-unrelated-discovery` | session-expiry behavior among unrelated modules, without naming the target path |
| C6 wrong investigative path | `cr005-c6-wrong-path-rehydration` | nested parser bug without prescribing an investigation route |

## 4. Exact fixture revisions and state hashes

All fixture repositories are created from committed templates with fixed Git author/committer metadata.

| Task id | Base commit | Tree hash | Initial state hash |
| --- | --- | --- | --- |
| `cr005-c1-localized-bug-fix` | `ff3239541b98be14329281ea2cd11ef27f96f10b` | `4315df57ff701bcf56c7cff61c380ae99451ad9b` | `60ada771a58af67e9275fde0eeba9064cb3412fcc71582208e041a38d29eab4f` |
| `cr005-c2-multi-file-feature` | `f6fae2c899491d8c1f8ad343ae5738cb97e558fc` | `29ea520df7fd1f11c6a3ac8654d1ab2801927f7e` | `58af62a05eb673468e1ab5e158c0ec299c1f146f14f45b64985c0b75931d207c` |
| `cr005-c3-failing-test-diagnosis` | `4330f29e37309b349327b12c24d6064528c4bbd9` | `c90cda0e5faf1beb44abebbd012669921a3e6569` | `09b2f1adb09efe1d04dd69c39b855b1708fd9b7b18403cd6750a359c6ba89cfd` |
| `cr005-c4-constrained-refactor` | `83187a56da63026fb161da3b828f10ed014f3e1f` | `758c13f8ba231579452404a9e6d3c3b6630b22cb` | `c47338e610585a750cad330c4b30c9915bc675076cd1f614ac8cea9f77e74159` |
| `cr005-c5-unrelated-discovery` | `ea1ef1e328fcfd0fa72e64c67eae1ba9fb829ce8` | `893fde9b32b2bd4b3e052580c7d2d38a5fac893a` | `144d5e12693f52125c8e34a47a20739e7456a6824531e326e03386119af56f71` |
| `cr005-c6-wrong-path-rehydration` | `ae22d0e616df8e27b664c612f80703d9e0e443a5` | `695020a1deef724d43efd85c0b74187020b0a3fe` | `13fdae63bbfc5cb5a053d83e66e7e06c5007cd0885d7026544223329447ddc13` |

## 5. Acceptance criteria and oracles

Each manifest declares structured acceptance criteria with an id and a machine-check kind. Each run records one bounded result and evidence string per criterion; `VALID` requires every declared criterion result to pass in addition to the objective/regression oracles, message pass-through, and writable-path checks. The criteria use deterministic oracle, path-scope, pass-through, retention, and executable contract evidence rather than an unreviewed Agent claim. C2-3 uses an independent `C2_MULTI_FILE_CONTRACT` runtime probe: it verifies config's actual punctuation export, probes greeting with a sentinel config to verify formal behavior, and injects a greeting spy to verify index forwarding and return pass-through. The probe executes untrusted fixture modules in a `shell: false` child with a strict environment allowlist, fixed IPC JSON schema, bounded output, timeout, and process-tree termination; probe stdout/stderr is not retained. A credential-free adversarial index-only implementation with comment/dead-code markers is required to fail.

Each manifest uses `node --test` against a focused objective `test/` file and a separate `test/regression.test.js`. The initial fixture is deliberately known-bad for the objective oracle, while the independent regression oracle passes on both the fixture and paired reference tree. C4's architecture rule is executable via a source assertion. C5's oracle now enters through a domain-neutral `src/session-expiry.js` seam; it does not directly import the answer path, so the four candidate modules must be distinguished through repository evidence.

## 6a. Bounded validity corrections

- Shadow starts with no manifest candidate/relevant paths. A real `read` event is observed against the fixed Git revision, then queued as a metadata-only repository seed for the next Shadow boundary.
- C5/C6 prompt and README prose no longer prescribe the target file or wrong-path sequence.
- Final status compares committed, staged, unstaged, and untracked paths against the fixture's initial `baseCommit`; an out-of-scope commit cannot make the working-tree diff appear clean.
- Repository Observer `UNAVAILABLE`/`ABSENT` results and thrown observation errors are retained as bounded, sanitized `observationFailures` evidence rather than silently discarded.
- Aggregation counts a matching read/search at the same semantic sequence as `REMOVE`.
- Aggregation also covers the next semantic call after `REMOVE`; same-call evidence has distance `0` and next-call evidence has distance `1`.
- Evaluator annotation variants cannot enter Shadow planner inputs; the credential-free regression test varies them through the same `buildShadowFilePathCandidates` seam used by the live runner while holding observed evidence constant.
- Each Shadow call retains Universe, PlanningRequest, previous Working Set, transition identity, and content-free representation identity inputs. Replay invokes `planWorkingSet` and rejects identity drift.
- The real Shadow extension pass-through test asserts the original `ContextEvent.messages` array identity.
- Objective and regression oracles are distinct commands; the task-board history now records DS-013 as PR #24 and CR-005 assignment as PR #25.

## 6b. Security-boundary and deterministic-probe corrections

- C2 runtime probing never loads Agent-modified modules in the credentialed parent process. The child uses `shell: false`, a fixed JSON-over-IPC protocol, a 1-second timeout, process-tree termination, and a 64 KiB bounded output pipe. Module-cache injection uses the child loader's canonical `require.resolve()` paths, including macOS `/var` to `/private/var` aliases.
- Oracle, Git fixture operations, and the registered Agent `bash` replacement use an explicit environment allowlist. Provider/auth variables, `NODE_OPTIONS`, `BASH_ENV`, and shell startup hooks are not inherited; Pi session environment exposure is disabled for the controlled Bash tool.
- The credential-free safety suite has 23 tests, including Oracle and Bash credential canaries, C2 `process.exit()`, infinite-loop, and output-limit fail-closed cases. The output-limit fixture uses synchronous `fs.writeSync()` with a complete-write loop and keeps the child alive, so the parent must observe more than 64 KiB before termination.

## 6. Provider, model, and run-budget configuration

- Primary profile: provider `deepseek`, model `deepseek-v4-flash`, thinking level `medium`.
- Strategies: exactly `NATIVE` and `SHADOW`.
- Per-task semantic-call, tool-call, and wall-clock bounds are in the manifests; C6 has the largest bounded budget.
- Live execution is opt-in through `CANVAS_CR005_LIVE=1`.
- No credentials are committed or copied into fixtures.
- The current verification baseline is Node `24.15.0`; the review baseline HEAD is `ee4a78c`. GitHub reported `check` failing only on the asynchronous output-limit regression and `macos-electron` skipped; no live/provider job was authorized.

## 7. Exact Native/Shadow run counts per task

| Task id | Native completed | Shadow completed | Valid paired runs |
| --- | ---: | ---: | ---: |
| all six tasks | 0 | 0 | 0 |

No provider calls were made during this verification. Live matrix remains paused at zero; the preferred future matrix is six tasks × two Native repetitions × two Shadow repetitions = 24 runs.

## 8. Per-task quality summary

Credential-free validation passed for all six categories: every initial objective oracle failed as expected, every fixture/reference regression oracle passed, and every reference objective oracle passed. No Agent execution quality result exists yet; Native/Shadow quality rates are therefore `N/A`, not zero-success evidence.

## 9. Per-task context/planning summary

No live call records exist. When live execution is enabled, the harness records Native per-call `agent-messages-pre-provider` estimates and Shadow per-call Universe, PlanningRequest, previous Working Set, replayable content-free representation identities, Working Set/transition hashes, semantic estimate, representation counts, decisions, reasons, and materialization failures. Shadow file candidates can only originate from observed Agent reads.

## 10. Aggregate quality and context metrics

| Metric | Result |
| --- | ---: |
| valid live runs | 0 |
| Native oracle pass count | 0 |
| Shadow underlying-task oracle pass count | 0 |
| budget exhaustions | 0 |
| Native observed-message estimate | N/A |
| Shadow proposed semantic estimate | N/A |
| provider savings | not computed |

## 11. REMOVE, REHYDRATE, and REPLACE evidence

Live evidence: none. Aggregation code preserves explicit `ADD`, `KEEP`, `REMOVE`, `REPLACE`, and `REHYDRATE` kinds and reason codes; it does not infer `REHYDRATE` from a first-time `ADD`. Replay re-runs the Planner from saved normalized metadata instead of canonicalizing prior outputs.

## 12. Rehydrate-within-1/3/5 data

Live counts are all `0` because no live Shadow run exists. The deterministic aggregation test verifies call distance and the within-1/3/5 derivation fields.

## 13. Read-after-remove and false-removal candidates

Live candidate count: `0`. The harness emits bounded candidates for a matching read/search after `REMOVE`, including the same-call boundary, keeps the removal reason and distance, and labels the synthetic test evidence `INDETERMINATE`; it does not use a second LLM as a causal judge.

## 14. Representation transition evidence

No live representation transition was observed. The accepted file-aware planner seam is wired for `FULL`, `LINE_RANGE`, and `REFERENCE`; the metadata schema records target and previous representation kinds so `FULL → LINE_RANGE`, `LINE_RANGE → FULL`, and source-version-advance `REPLACE` can be derived without changing Planner V0.

## 15. Materialization and observation failure evidence

Live materialization failure count: `0` (no live calls). Shadow metadata retains bounded failure reason strings from the existing fail-closed `FileRepresentationProvider`; runner-level Repository Observer failures are separately retained in `observationFailures`. Failures never rewrite Native messages and absolute temporary fixture roots are redacted from the bounded evidence.

## 16. Stochastic/provider variance

Not measured. The live protocol fixes one provider/model profile and uses balanced repetitions, but no claim about model variance, cost, or quality difference is made from credential-free harness evidence.

## 17. Metric scope statement

Native estimates are scoped to `agent-messages-pre-provider`. Shadow estimates are proposed semantic Working Set estimates. They are intentionally separate scopes; the report does not convert their difference into provider token savings.

## 18. Credential and data-retention confirmation

- Fixtures contain synthetic local repository content only.
- Raw provider payloads are disabled in `BenchmarkRunRecord`.
- Live metadata is written under the Git-ignored `research/context-benchmarks/output/` directory.
- Only hashes, counts, bounded paths, decisions, reasons, oracle outcomes, revision metadata, and content-free representation identity inputs are durable by default; representation `content` and `contentRef` are stripped before run retention.
- The C2 probe does not retain untrusted child stdout/stderr. Its parent accepts exactly one bounded JSON result with the fixed protocol version/type and fails closed on malformed, duplicate, timed-out, or over-limit output.
- Oracle and Agent Bash canary tests assert that a fake `DEEPSEEK_API_KEY` is unavailable to the child process and absent from retained evidence.

## 19. Exact commands executed

```sh
PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:$PATH pnpm check
PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:$PATH pnpm --filter @canvas-agent/context-benchmarks test
PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:$PATH pnpm --filter @canvas-agent/context-benchmarks benchmark:validate
```

`pnpm check` passed format, lint, all workspace typechecks, all workspace tests, and build. The CR-005 package passed `23/23` tests. The six-category credential-free validator passed all objective/regression and identity checks. In the restricted local sandbox, the `tsx` wrapper initially could not create its temporary IPC pipe; the same credential-free validator passed when rerun with the required local socket permission. No live command was run.

## 20. Explicit corpus readiness verdict

```text
HARNESS_ONLY
```

The six-category corpus, manifests, deterministic fixtures, objective oracles, aggregation fixtures, isolated C2 probe, sanitized Oracle/Bash boundaries, and credential-free validation are ready for lead review. Live Native/Shadow evidence is still absent, so bounded live matrix remains `NO_GO` and this artifact is not `READY_FOR_GO_NO_GO`.

This packet does not authorize CR-004, does not establish Active rewrite safety, does not compare Dynamic against Native, and does not claim provider token savings. The next action is a lead decision on the corpus, followed by the bounded live matrix when credentials and execution authority are available.
