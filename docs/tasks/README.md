# Cross-computer task board

The remote repository is the coordination point. The two implementers never exchange uncommitted folders.

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
