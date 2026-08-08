# Phase 4 #5 verification packet — Result Adoption + Baseline Promotion

- **Status:** Pending merge — evidence recorded on branch `agent/deepseek-phase4e-result-adoption`
- **Date:** 2026-08-08
- **Basis:** PROPOSAL-026 (frozen durable side-effect protocol)
- **Repository:** https://github.com/EchoTouch-moon/canvas-agent

## Requirement → evidence map

| Frozen decision | Evidence | Status |
|---|---|---|
| `artifact.apply({ taskId, evaluationId, artifactId })` — narrow payload, Main derives the graph | WorkspaceService.applyArtifact resolves run/request/project/base from persistence | **PASS** |
| Adoption guards (latest PASSED eval, exact PATCH, persisted byte/hash, clean + exact-base Run revision, ACTIVE baseline == Snapshot.baseBaseline) | integration + persistence tests | **PASS** |
| `ArtifactApplication` immutable binding + `ArtifactApplicationEvent` append-only (AUTHORIZED/APPLYING/APPLIED/FAILED/INTERRUPTED) | persistence tests (events sequence, effective status) | **PASS** |
| Main-authored commit only; `git apply --check` → `git apply --index` → controlled commit with trailers | `GitRepositoryWriter` + integration test asserts HEAD advances with parent == base and clean tree | **PASS** |
| No patch→NodeVersion mapping; candidate inherits parent NodeVersion set exactly | candidate test copies `['nv_1']` from parent | **PASS** |
| Side-effect idempotency (one per Task/PATCH; retry APPLIED returns existing, no second commit) | E2E + integration: second apply leaves HEAD unchanged, commit count stays 2 | **PASS** |
| Crash-gap reconciliation (commit exists, DB finalize lost → retry detects trailers → finalize, never reapply) | integration test deletes APPLIED event + revision, retry → APPLIED, HEAD unchanged | **PASS** |
| Stale base rejection (manual commit after Run blocks adoption, no side effect) | integration test | **PASS** |
| `baseline.createCandidateFromTask({ applicationId, name, description? })` + `baseline_candidate_source` provenance + one-candidate-per-application | persistence tests | **PASS** |
| `baseline.activate` strengthened (candidate parent stale guard + real repo == candidate revision) | Main wrapper + `assertCandidateActivationValid` | **PASS** |
| Session-only ArtifactReview retired; CoreFlow APPLY/CREATE/ACTIVATE real | CoreFlow review gates wired; ArtifactScreen session buttons removed | **PASS** |
| Migration: 3 tables, no semantic backfill | migration generated | **PASS** |

## Restart E2E (final gate — Project Evolution)

`pnpm --filter @canvas-agent/desktop e2e:live` (real Electron, Playwright; isolated
userData + real repo):

```text
[e2e] A execution dispatch -> SUCCEEDED evidence
[e2e] A acceptance.evaluate -> WAITING_REVIEW
[e2e] A task.complete submitted
[e2e] A artifact.apply -> APPLIED
[e2e] A baseline candidate created (DRAFT)
[e2e] A baseline.activate submitted
[e2e] first launch closed; relaunching with the SAME userData DB + repo
[e2e] B application still APPLIED after restart
[e2e] B candidate baseline ACTIVE after restart
[e2e] B applied RepositoryRevision == actual Git HEAD
[e2e] B ACTIVE baseline pins the applied revision
[e2e] ALL PASSED
```

The adoption creates a real Git commit (HEAD C2, parent C1, clean); the
Application is APPLIED; a Baseline N+1 DRAFT candidate is created with
provenance (parent = Baseline N, source = the application) and activated
(Baseline N SUPERSEDED, N+1 ACTIVE); after a full Electron restart the
application, the ACTIVE candidate baseline and the applied RepositoryRevision
(all equal to the actual Git HEAD) survive.

## Integration evidence (crash consistency)

- **Stale base**: Run based on C1, manual commit Cx → `artifact.apply` rejected,
  Cx unchanged, no application rows.
- **Crash gap**: adoption commit succeeds but the DB APPLIED finalize is lost →
  retry detects the matching commit via trailers → finalize APPLIED, HEAD stays
  C2 (never reapplied).

## Verification note

`pnpm check` green (236 tests: domain 5, contracts 36, persistence 68,
worker-runtime 19, desktop 108). `CANVAS_AGENT_PHASE3_SMOKE=1` PASSED with the
`task lifecycle IN_PROGRESS` assertion. CI publishes commit status on the PR.

This packet closes the loop: `Baseline N → Task → Run → Acceptance →
Adoption → Baseline N+1` with durable, idempotent, reconcilable external
side effects.
