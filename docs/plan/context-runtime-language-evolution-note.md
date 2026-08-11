# Context Runtime Language Evolution Note

- **Status:** DEFERRED OPTIMIZATION / ARCHITECTURE OPTION
- **Current decision:** Keep Canvas Agent and Context Runtime research TypeScript-first through v0.3.
- **Purpose:** Preserve an explicit future optimization path without prematurely introducing a second production runtime language.

## 1. Current language strategy

For v0.3, TypeScript remains the default implementation language for:

- Electron / React product control plane;
- IPC and orchestration;
- Pi / OpenCode integration adapters;
- Context Runtime research domain models;
- Source Attribution, Source Reconciliation, Universe and Working Set experiments.

The reason is architectural iteration speed and type continuity across the current JavaScript/TypeScript ecosystem, not a claim that TypeScript is the optimal language for every future Runtime workload.

Python may be used for offline research such as benchmark analysis, ranking experiments, notebooks, statistical analysis or ML policy exploration. It is not currently planned as the production Context Runtime.

## 2. Future native-runtime option

If Context Runtime proves independently valuable and its domain model becomes stable, evaluate whether selected infrastructure components should move behind a language-neutral boundary, with Rust as the primary native-runtime candidate.

Potential long-term shape:

```text
Canvas Desktop / Agent integrations
            TypeScript
                |
                | typed protocol / stable semantic contract
                v
        Context Runtime Core
              Rust?
                |
      repository / source infrastructure
```

A Rust migration is an option, not a committed roadmap item.

## 3. Migration triggers

Do not introduce Rust merely because it may benchmark faster. Re-evaluate the language boundary when one or more measured triggers appear:

1. repository indexing, AST parsing, diffing, hashing or file watching becomes a material CPU bottleneck;
2. Context Universe reaches a scale where memory layout / GC behavior becomes a measured problem;
3. Context Runtime needs to run as an independent local daemon or reusable SDK/service outside Canvas Desktop;
4. multiple Agent harnesses need to share one long-lived Runtime process;
5. cross-platform native isolation / sandbox requirements become materially easier with a native core;
6. repeated profiling shows TypeScript Runtime overhead is meaningful relative to model/tool latency;
7. Context Runtime contracts are stable enough that a language boundary will not slow active domain-model research.

Until a trigger is supported by evidence, stay TypeScript-first.

## 4. Migration method if triggered

Prefer incremental extraction, not a full rewrite.

Example progression:

```text
Phase 1
TypeScript Runtime research only

Phase 2
Rust native module for one measured hotspot
(repository index / AST / hashing / file watcher)

Phase 3
Move stable Source Store / Reconciliation / Universe infrastructure only if justified

Phase 4
Optionally extract a standalone Context Runtime process with a TypeScript SDK
```

Do not rewrite `packages/context-runtime` wholesale before the Context Runtime model and benchmark value are validated.

## 5. Language-neutral design requirement now

Even while implemented in TypeScript, the Runtime domain should avoid unnecessary JavaScript-specific coupling.

Prefer:

- plain immutable data structures;
- deterministic functions;
- explicit serialization boundaries;
- stable hashes / identifiers;
- Agent/provider-neutral contracts;
- no React/Electron/Pi/OpenCode concepts in the Runtime core.

This keeps a future Rust or other native implementation possible without making multi-language architecture a v0.3 requirement.

## 6. Review point

Revisit this note after CR-005 benchmark evidence and again after CR-007 OpenCode portability evidence.

At those gates decide one of:

```text
KEEP_TYPESCRIPT
EXTRACT_NATIVE_HOTSPOTS
PROTOTYPE_RUST_RUNTIME_CORE
DEFER_AGAIN
```

The decision must be evidence-driven and should consider developer velocity, packaging complexity, runtime performance, memory use and whether Context Runtime is becoming an independent infrastructure product.
