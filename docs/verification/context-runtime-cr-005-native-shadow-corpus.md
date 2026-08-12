# CR-005 Native + Shadow benchmark corpus verification

## 1. Branch and HEAD

- Branch: `agent/luna-cr-005-native-shadow-corpus`
- Verification baseline: `13d3b9087c980296e92eba91958d89c877cd40d8` (PR #25 exact merge)
- This artifact is part of the Luna implementation changes on that branch; the final implementation commit is reported by the handoff after commit.

## 2. Corpus layout

The research-only boundary is `research/context-benchmarks/`:

```text
corpus/<category>/{fixture,reference}/
manifests/*.json
src/{manifest,fixture-generator,aggregation,validation,live-runner}.ts
tests/*.test.ts
output/                         # gitignored live metadata
```

No production Runtime, Pi payload, Active renderer, or provider-request rewrite code was added.

## 3. Six task definitions and category mapping

| Category | Task id | Intent |
| --- | --- | --- |
| C1 localized bug fix | `cr005-c1-localized-bug-fix` | percentage discount arithmetic |
| C2 multi-file feature | `cr005-c2-multi-file-feature` | formal greeting option across config/greeting/index |
| C3 failing-test diagnosis | `cr005-c3-failing-test-diagnosis` | cache-hit factory regression |
| C4 constrained refactor | `cr005-c4-constrained-refactor` | domain-owned normalization under an architecture rule |
| C5 unrelated discovery | `cr005-c5-unrelated-discovery` | security expiry among four candidate modules |
| C6 wrong investigative path | `cr005-c6-wrong-path-rehydration` | nested parser bug after plausible cache/tokenizer leads |

## 4. Exact fixture revisions and state hashes

All fixture repositories are created from committed templates with fixed Git author/committer metadata.

| Task id | Base commit | Tree hash | Initial state hash |
| --- | --- | --- | --- |
| `cr005-c1-localized-bug-fix` | `9bf11fe9f7c8b3d8aba808e61f5ce4a5993dc653` | `5dd1e4e2a8fa397fbe29a43dba6b6c924b6081fb` | `dd926cee8b39f581782f7b19181a7e357ae79cbe3a0bfeaf8d93589b444bff11` |
| `cr005-c2-multi-file-feature` | `12e461d4166749df7716f104ec9b24e9fc6c7068` | `7173c55ec2a83cfa4616103c18fb3a31fec3100d` | `fd46b5cadf4b186c798c10739d05f0b77ee60bd78b8baf735f5cee4eea92b5ee` |
| `cr005-c3-failing-test-diagnosis` | `14c989061bdb06891f260bbc14519a81f95d415b` | `5554d820b48359e8d411e9bee767392d9cc35388` | `40d76b7e16f65631871ed19a3e7f74647a9642b470913bd8fbc18e1afbde7421` |
| `cr005-c4-constrained-refactor` | `90b1da4875bf4277c4579f59d8771caadeec646c` | `a79d15135137e18c6ae75bd4f00bea45d307a36e` | `228899998ea2219d54e63b19261d8b5f198811d931e21ae1e759d792db706eaf` |
| `cr005-c5-unrelated-discovery` | `6a91e4eea26f38a8ae64a2eca5c49bb8b1e368ed` | `014a59f8f070716f04dd7aa383276dbf90e6c9d5` | `301d6550ccfc93cdcfe7301de1ac6190e96e6dcbe31f8af79197c46aeba53d8f` |
| `cr005-c6-wrong-path-rehydration` | `a128b6de309c9363dc635682f9ae50386c24537e` | `3edd61a9e53b2fb8710a2529be5ec06689103b91` | `9d79a724d1a3fffb9f8d1b221674b90742b3406b715ad8e79775f537687f31e6` |

## 5. Acceptance oracles

Each manifest uses `node --test` against a focused `test/` file. The initial fixture is deliberately known-bad; the paired reference tree is known-good. C4's architecture rule is executable via a source assertion, and C5/C6 keep unrelated/wrong candidates in the repository.

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

No provider calls were made during this verification. The preferred live matrix remains six tasks × two Native repetitions × two Shadow repetitions = 24 runs.

## 8. Per-task quality summary

Credential-free oracle validation passed for all six categories: every initial fixture oracle failed as expected and every reference oracle passed. No Agent execution quality result exists yet; Native/Shadow quality rates are therefore `N/A`, not zero-success evidence.

## 9. Per-task context/planning summary

No live call records exist. The harness records Native per-call `agent-messages-pre-provider` estimates and Shadow per-call Universe, Working Set, planning hash, semantic estimate, representation counts, decisions, reasons, and materialization failures when live execution is enabled.

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

Live evidence: none. Aggregation code preserves explicit `ADD`, `KEEP`, `REMOVE`, `REPLACE`, and `REHYDRATE` kinds and reason codes; it does not infer `REHYDRATE` from a first-time `ADD`.

## 12. Rehydrate-within-1/3/5 data

Live counts are all `0` because no live Shadow run exists. The deterministic aggregation test verifies call distance and the within-1/3/5 derivation fields.

## 13. Read-after-remove and false-removal candidates

Live candidate count: `0`. The harness emits bounded candidates for a matching read/search after `REMOVE`, keeps the removal reason and distance, and labels the synthetic test evidence `INDETERMINATE`; it does not use a second LLM as a causal judge.

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
- Only hashes, counts, bounded paths, decisions, reasons, oracle outcomes, and revision metadata are durable by default.

## 19. Exact commands executed

```sh
env PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin pnpm install --lockfile-only
env CI=1 PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin pnpm install
env PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin pnpm --filter @canvas-agent/context-benchmarks typecheck
env PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin pnpm --filter @canvas-agent/context-benchmarks test
/opt/homebrew/opt/node@24/bin/node --import ./node_modules/.pnpm/tsx@4.23.7/node_modules/tsx/dist/loader.mjs research/context-benchmarks/src/cli.ts validate
```

The direct Node loader was used for the validation command because the sandbox denied the temporary IPC pipe used by the `tsx` CLI wrapper; the underlying validator itself passed.

## 20. Explicit corpus readiness verdict

```text
HARNESS_ONLY
```

The six-category corpus, manifests, deterministic fixtures, objective oracles, aggregation fixtures, and credential-free validation are ready for lead review. Live Native/Shadow evidence is still absent, so this artifact is not `READY_FOR_GO_NO_GO`.

This packet does not authorize CR-004, does not establish Active rewrite safety, does not compare Dynamic against Native, and does not claim provider token savings. The next action is a lead decision on the corpus, followed by the bounded live matrix when credentials and execution authority are available.
