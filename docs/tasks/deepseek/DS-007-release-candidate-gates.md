# DS-007 — Product MVP v0.2 release-candidate gates

## Task owner

DeepSeek V4 Flash — non-visual integration, automation and documentation owner. Lead architect performs final acceptance.

- **Branch:** `agent/deepseek-ds-007-product-mvp-rc`
- **Depends on:** DS-003, DS-004, DS-005, DS-006 and UI-003 merged
- **Final gate:** Product MVP v0.2

## Goal

Turn the merged product flow into a repeatable release candidate with deterministic automated evidence, a separate opt-in authenticated Agent proof, a packaged cold-start proof and truthful operating documentation.

## Read first

- `AGENTS.md`
- `docs/PRODUCT_MVP_V0.2_PLAN.md` sections 8–12
- all DS-003…DS-006 and UI-003 handoffs
- `.github/workflows/ci.yml`
- `apps/desktop/e2e/**`
- `README.md`
- `docs/PROGRESS.md`

## Authorized files

- `.github/workflows/**`
- `apps/desktop/e2e/**`
- package scripts in root and desktop `package.json`
- deterministic test fixtures adjacent to E2E only
- `README.md`
- `docs/PROGRESS.md`
- `docs/PRODUCT_MVP_V0.2_PLAN.md` status/evidence fields only
- new `docs/verification/product-mvp-v0.2-rc.md`
- new operator/release documents under `docs/**`
- minimal test-only selectors in Renderer components only if Luna agrees and appearance/behavior does not change

Production architecture/code changes are not authorized. A discovered product bug returns to its owning task or a new scoped fix packet.

## Required implementation

1. Create one deterministic, credential-free RC suite that covers workspace lifecycle using fake/test boundaries and the complete fixture-backed domain loop.
2. Keep one explicitly opt-in authenticated Codex smoke. It must skip with a clear reason when unavailable; it cannot silently pass as if executed.
3. Cover packaged cold start with migrations, native selection test seam and isolated userData.
4. Cover restart after real/fixture run evidence, acceptance, completion, adoption, candidate creation and activation.
5. Prove idempotent artifact application does not create a second commit.
6. Add logs/screenshots/test reports as CI artifacts on failure.
7. Document prerequisites, local dev, supported runtime, repository selection, Agent availability/auth errors, unsigned internal build and signed external distribution distinction.
8. Correct stale status claims in README/PROGRESS and mark the old execution plan superseded.
9. Produce a release checklist mapping every master-plan gate to exact evidence.

## Prohibited scope

- No weakening assertions to make CI green.
- No committed credentials, personal absolute paths or reliance on global Git identity.
- No automatic push of adopted repository changes.
- No production behavior/refactor hidden inside an E2E task.
- No claim that authenticated smoke passed when it skipped.
- No external signed distribution unless separately authorized and credentials are intentionally available.

## Acceptance criteria

1. `pnpm check` is green on a clean checkout.
2. macOS CI proves Electron live E2E and unsigned packaged cold start.
3. Deterministic suite needs no personal Agent account.
4. Opt-in real-Agent report states executable version, executed/skipped/failed and redacted reason.
5. Full flow preserves all formal separation and survives restart.
6. Adoption retry is idempotent and repository revision advances once.
7. Security regression asserts no renderer path/process authority and no Fixture production fallback.
8. Production dependency audit has no high/critical known vulnerability at release time.
9. Documentation matches the actual commands and current status.
10. All P0/P1 entries in the release record are closed or explicitly rejected by the lead architect.

## Required verification

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm --filter @canvas-agent/desktop e2e:workspace
pnpm --filter @canvas-agent/desktop e2e:live
pnpm --filter @canvas-agent/desktop e2e:packaged-smoke
pnpm audit --prod --audit-level high
CANVAS_AGENT_REAL_AGENT_SMOKE=1 pnpm --filter @canvas-agent/desktop e2e:agent
```

## Final handoff

Return the standard contract plus a matrix with one row per release gate:

- command/scenario;
- platform;
- result;
- artifact/log path;
- blocking status;
- reviewer sign-off.

Do not mark Product MVP complete yourself. The lead architect compares the matrix to `docs/PRODUCT_MVP_V0.2_PLAN.md` and makes the final status decision.
