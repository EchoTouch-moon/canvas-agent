# CR-005 Native + Shadow benchmark corpus verification

## 1. Branch and HEAD

- Branch: `agent/luna-cr-005-native-shadow-corpus`
- Review target: `4e575d2d3004d4933136f5d6775524acd295327b` (PR #26 exact HEAD)
- Correction scope: five P1 and three P2 benchmark-validity fixes; no live provider execution.

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
| `cr005-c1-localized-bug-fix` | `c7e08c35f608a1a9cfbca927f5a36a0ed0ea5e7c` | `3f0a45846714cb3a1623f31a3c4c3a7235fe659b` | `d6e7864fffe3023a55985f3bdad822eb0820af84e9af42ae7df7ebe566933b40` |
| `cr005-c2-multi-file-feature` | `f6fae2c899491d8c1f8ad343ae5738cb97e558fc` | `29ea520df7fd1f11c6a3ac8654d1ab2801927f7e` | `58af62a05eb673468e1ab5e158c0ec299c1f146f14f45b64985c0b75931d207c` |
| `cr005-c3-failing-test-diagnosis` | `0b82bb4894076ec16ca058c6a8e9425988e1c4a3` | `b18b46768414bbf4f5fd91d84cce08ba912dd2d5` | `6e2fdf66f3a6304be88dfed35b3b7a4a0e5e2727502d22e3139328592cfc22e3` |
| `cr005-c4-constrained-refactor` | `83187a56da63026fb161da3b828f10ed014f3e1f` | `758c13f8ba231579452404a9e6d3c3b6630b22cb` | `c47338e610585a750cad330c4b30c9915bc675076cd1f614ac8cea9f77e74159` |
| `cr005-c5-unrelated-discovery` | `a27eab2d457c37a8e24b2fb9599293d6650474f4` | `0079f79280ece50ad29415877cfdbe2cd5cf621c` | `db707f55f66682135138e38da1083b630bc0a5da44e4cefecfcbd3b8a0911aad` |
| `cr005-c6-wrong-path-rehydration` | `ae22d0e616df8e27b664c612f80703d9e0e443a5` | `695020a1deef724d43efd85c0b74187020b0a3fe` | `13fdae63bbfc5cb5a053d83e66e7e06c5007cd0885d7026544223329447ddc13` |

## 5. Acceptance oracles

Each manifest uses `node --test` against a focused objective `test/` file and a separate `test/regression.test.js`. The initial fixture is deliberately known-bad for the objective oracle, while the independent regression oracle passes on both the fixture and paired reference tree. C4's architecture rule is executable via a source assertion, and C5/C6 keep unrelated/wrong candidates in the repository without putting evaluator answers in the Agent prompt.

## 6a. Bounded validity corrections

- Shadow starts with no manifest candidate/relevant paths. A real `read` event is observed against the fixed Git revision, then queued as a metadata-only repository seed for the next Shadow boundary.
- C5/C6 prompt and README prose no longer prescribe the target file or wrong-path sequence.
- Final status rejects any tracked, staged, or untracked path outside `expectedWritablePaths`.
- Aggregation counts a matching read/search at the same semantic sequence as `REMOVE`.
- Each Shadow call retains Universe, PlanningRequest, previous Working Set, transition identity, and content-free representation identity inputs. Replay invokes `planWorkingSet` and rejects identity drift.
- The real Shadow extension pass-through test asserts the original `ContextEvent.messages` array identity.
- Objective and regression oracles are distinct commands; the task-board history now records DS-013 as PR #24 and CR-005 assignment as PR #25.

## 6. Provider, model, and run-budget configuration

- Primary profile: provider `deepseek`, model `deepseek-v4-flash`, thinking level `medium`.
- Strategies: exactly `NATIVE` and `SHADOW`.
- Per-task semantic-call, tool-call, and wall-clock bounds are in the manifests; C6 has the largest bounded budget.
- Live execution is opt-in through `CANVAS_CR005_LIVE=1`.
- No credentials are committed or copied into fixtures.

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

## 15. Materialization failure evidence

Live materialization failure count: `0` (no live calls). Shadow metadata retains bounded failure reason strings from the existing fail-closed `FileRepresentationProvider`; failures never rewrite Native messages.

## 16. Stochastic/provider variance

Not measured. The live protocol fixes one provider/model profile and uses balanced repetitions, but no claim about model variance, cost, or quality difference is made from credential-free harness evidence.

## 17. Metric scope statement

Native estimates are scoped to `agent-messages-pre-provider`. Shadow estimates are proposed semantic Working Set estimates. They are intentionally separate scopes; the report does not convert their difference into provider token savings.

## 18. Credential and data-retention confirmation

- Fixtures contain synthetic local repository content only.
- Raw provider payloads are disabled in `BenchmarkRunRecord`.
- Live metadata is written under the Git-ignored `research/context-benchmarks/output/` directory.
- Only hashes, counts, bounded paths, decisions, reasons, oracle outcomes, revision metadata, and content-free representation identity inputs are durable by default; representation `content` and `contentRef` are stripped before run retention.

## 19. Exact commands executed

```sh
env PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin pnpm install --lockfile-only
env PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin pnpm --filter @canvas-agent/context-benchmarks typecheck
env PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin pnpm --filter @canvas-agent/context-benchmarks test
env PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin pnpm --filter @canvas-agent/pi-context-integration typecheck
env PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin pnpm --filter @canvas-agent/pi-context-integration test
/opt/homebrew/opt/node@24/bin/node --import /Users/v/Documents/V/node_modules/.pnpm/tsx@4.23.7/node_modules/tsx/dist/loader.mjs research/context-benchmarks/src/cli.ts validate
```

The direct Node loader was used because the sandbox denied the temporary IPC pipe used by the `tsx` CLI wrapper; the underlying validator itself passed with all objective/regression and identity checks green. No live command was run.

## 20. Explicit corpus readiness verdict

```text
HARNESS_ONLY
```

The six-category corpus, manifests, deterministic fixtures, objective oracles, aggregation fixtures, and credential-free validation are ready for lead review. Live Native/Shadow evidence is still absent, so this artifact is not `READY_FOR_GO_NO_GO`.

This packet does not authorize CR-004, does not establish Active rewrite safety, does not compare Dynamic against Native, and does not claim provider token savings. The next action is a lead decision on the corpus, followed by the bounded live matrix when credentials and execution authority are available.
