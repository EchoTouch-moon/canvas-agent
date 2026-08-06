# Cross-computer task board

The remote repository is the coordination point. The two implementers never exchange uncommitted folders.

## Status — 2026-08-06

| Owner | Task | Branch | Status |
|---|---|---|---|
| DeepSeek V4 Flash | DS-001 persistence foundation | `agent/deepseek-ds-001-persistence` | ✅ reviewed, merged into `main` (`50d4c1f`) |
| DeepSeek V4 Flash | DS-002 isolated Worker runtime | `agent/deepseek-ds-002-worker-runtime` | ✅ reviewed, merged into `main` (`2bf86e8`) |
| GPT-5.6 Luna | UI-001 UI foundation | `agent/luna-ui-001-foundation` | ✅ reviewed, merged into `main` (`c54e15c`) |
| GPT-5.6 Luna | UI-002 core flow prototype | `agent/luna-ui-002-core-flow` | ✅ reviewed, merged into `main` (`79ad0a5`) |

Wave 1 and Wave 2 are complete and fully integrated. All four cross-computer tasks
(DS-001, DS-002, UI-001, UI-002) are merged into `main`. Future work is tracked in
`docs/product/scope-register.md` (deferred Canvas, multi-worker, collaboration).

Wave 1 and Wave 2 are no longer gated on each other: the DeepSeek side is fully
integrated, so Luna may branch UI-001 from current `main` and run UI-001 → UI-002
sequentially.

## Wave 1 — start in parallel from the foundation commit

| Owner | Task | Branch | Exclusive file ownership |
|---|---|---|---|
| DeepSeek V4 Flash | DS-001 persistence foundation | `agent/deepseek-ds-001-persistence` | `packages/persistence/**` |
| GPT-5.6 Luna | UI-001 UI foundation | `agent/luna-ui-001-foundation` | `apps/desktop/src/renderer/**` |

Neither task may edit `packages/domain`, `packages/contracts`, Electron main/preload or architecture ADRs. A required contract change is reported, not implemented.

## Wave 2 — start after Wave 1 is reviewed and merged

| Owner | Task | Branch | Exclusive file ownership |
|---|---|---|---|
| DeepSeek V4 Flash | DS-002 isolated Worker runtime | `agent/deepseek-ds-002-worker-runtime` | `packages/worker-runtime/**` |
| GPT-5.6 Luna | UI-002 core flow prototype | `agent/luna-ui-002-core-flow` | `apps/desktop/src/renderer/**` |

## Handoff contract

Every implementer returns:

1. commit SHA and branch name;
2. modified file list;
3. short implementation explanation;
4. exact commands run and results;
5. acceptance-criterion evidence;
6. unresolved questions and risks;
7. explicit disclosure of any scope deviation.

Do not merge branches locally across computers. Push the branch and request an architecture review.
