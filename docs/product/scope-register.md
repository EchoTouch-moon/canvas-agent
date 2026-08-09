# Scope register

- **Current release:** Product MVP v0.2 closeout
- **Authoritative plan:** `docs/PRODUCT_MVP_V0.2_PLAN.md`
- **Last classified:** 2026-08-09

## Core — current Product MVP

- deterministic ExecutionRequest time validation across Main and Worker;
- packaged Drizzle migrations and cold-start smoke;
- Main-owned native Git repository selection;
- one active workspace with repository-scoped SQLite/runtime directories;
- safe close/switch/reopen lifecycle;
- provider-neutral local CLI process boundary;
- ExecutionRequest v2 immutable Context Bundle from the FROZEN Snapshot;
- Main-owned packaged-safe Agent executable discovery/readiness and native selection;
- first production Agent adapter (Codex CLI based on the verified local capability baseline);
- Live-first production UI with explicit lifecycle/error/disabled/read-only states;
- first-workspace Project/charter/initial Baseline/Task onboarding without demo seed;
- full Run → Acceptance → Complete → Apply → Candidate → Activate regression and restart durability;
- source, Electron and packaged CI gates;
- accurate developer/operator/release documentation.

These items are required because the existing engineering loop cannot be used as a normal packaged product without them.

## Enhancements — candidates after v0.2 evidence

| Candidate | Why not now | Reconsider trigger |
|---|---|---|
| Claude/second Agent adapter | doubles an unstable provider surface before the first adapter is measured | Codex adapter stable and concrete contract gaps recorded |
| large Renderer module decomposition | maintainability gain, but not required to prove the product loop | a v0.2 change is blocked or review/test cost becomes recurrent |
| bundle/dependency reduction | current bundle is large but functionality is the release blocker | startup/bundle measurements exceed an accepted budget |
| advanced Agent profile editor | one validated provider/profile is sufficient for first use | repeated manual configuration demand |
| repository-defined verification commands | executing repository content requires a separate sandbox and explicit authorization design | users need independent automated checks beyond built-in patch integrity |
| recent-workspace catalog | last-opened plus choose-another completes the loop | users manage several repositories frequently |
| richer Inspector / command palette | useful speed improvement | observed workflow friction after Live-first use |
| fuller Run event visualization | current evidence is adequate for the loop | real Agent event data exposes recurring diagnosis gaps |
| local one-hop relationship mini-map | improves orientation but does not unlock execution | impact-analysis need repeatedly observed |

## Future directions — require explicit trigger

| Direction | Trigger |
|---|---|
| Checkpoint/Resume | at least three real, classified recoverable interruption cases plus an approved continuation contract |
| Canvas/SavedView expansion | core flow stable and hierarchy/status views fail a repeated coordination question |
| multi-provider routing/fallback | two stable adapters with measured, documented differences |
| concurrent Worker scheduling | observed queue latency or throughput bottleneck |
| multi-user permissions | verified team demand and an accepted identity/security model |
| remote execution | local isolation model validated and a remote trust/secret design approved |

## Idea repository — not scheduled

- global infinite Canvas;
- distributed Worker fleet;
- autonomous multi-Agent negotiation/organization;
- cloud-shared project state;
- full-repository vectorization and automatic context optimization;
- plugin/extension marketplace;
- enterprise billing and audit administration.

These remain deliberately unscheduled because they expand product surface before the single-user local-first loop is product-ready.
