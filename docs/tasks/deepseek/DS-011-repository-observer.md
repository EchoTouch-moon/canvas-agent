# DS-011 — Authoritative Repository Observer

## Task owner

DeepSeek V4 Flash — Context Runtime research implementer. The lead architect owns architecture acceptance and any authorization to move from authoritative repository observation into file-aware Working Set policy or active context rewrite.

- **Implementation branch:** `agent/deepseek-ds-011-repository-observer`
- **Milestone:** Context Runtime v0.3 research
- **Status:** ASSIGNED / READY AFTER THIS PACKET MERGES
- **Depends on:** CR-003A / DS-010 accepted and PR #18 merged to `main@1bffb8e99cdd70a17c5b97ff5fd99c479aa72edf`
- **Purpose:** close the authoritative repository/file Source gap identified by CR-002 and CR-003A
- **Enables later:** bounded file-aware CR-003B Shadow planning
- **Does not authorize:** CR-003B policy expansion in this task, active model-context rewrite, CR-004, production persistence, OpenCode/Codex integration, or v0.2 contract changes

> Create the implementation branch from updated `main` only after this packet is merged. Do not branch DS-011 from the old DS-010 implementation branch.

---

## Goal

Build the minimum authoritative, provider-neutral Repository Observer required to answer:

> For an exact expected `RepositoryRevision` and a bounded set of canonical repository paths, can Canvas establish whether each file is AVAILABLE, ABSENT, or UNAVAILABLE at that exact repository state, emit trustworthy `SourceObservation`s for `repository/file://*`, and advance the existing Context Universe without guessing from Agent/tool hints?

This task is about **world-state observation only**.

It must preserve the architecture boundary:

```text
Repository / Git working tree
        ↓
Authoritative Repository Observer   ← DS-011
        ↓
SourceObservation + SourceDescriptor
        ↓
CR-002 Reconciliation
        ↓
Context Universe
────────────────────────────────────
CR-003B file-aware planning         ← NOT implemented here
```

The Observer answers **what repository file state is true**. It does not answer **whether the model should see that file**.

---

## Why DS-011 exists

CR-002 and CR-003A intentionally refused to promote Pi tool-argument paths into source truth.

A Pi event such as:

```text
read(path = "src/auth.ts")
```

may establish a useful resource hint:

```text
repository/file://src/auth.ts
```

but it does **not** prove that the current canonical repository state of that path is the tool result text, nor that the path still exists at the repository revision being planned against.

Therefore:

```text
DERIVED_HINT != canonical repository Source
```

DS-011 supplies the missing independent authority.

---

## Read first

Architecture / accepted evidence:

- `AGENTS.md`
- `docs/architecture/context-runtime-v0.3-direction.md`
- `docs/architecture/decisions/PROPOSAL-030-context-source-universe-model.md`
- `docs/architecture/decisions/PROPOSAL-031-context-working-set-planner.md`
- `docs/verification/context-runtime-cr-002-acceptance.md`
- `docs/verification/context-runtime-cr-003a-acceptance.md`
- `docs/verification/context-runtime-cr-003-shadow-planner.md`
- `docs/tasks/deepseek/DS-009-context-source-universe-shadow.md`
- `docs/tasks/deepseek/DS-010-shadow-working-set-planner.md`

Existing repository seams to inspect and reuse where appropriate:

- `apps/desktop/src/main/git-revision-reader.ts`
- `apps/desktop/src/main/git-repository-content-reader.ts`
- `apps/desktop/src/main/context-resolver.ts`
- existing `RepositoryRevision` domain/persistence contracts
- `packages/context-runtime/src/source/**`
- `packages/context-runtime/src/universe/**`

Do not duplicate an existing correct repository-revision algorithm merely to make the experiment self-contained.

---

# Central architecture rules

## 1. Observation must be independent of Pi / Agent context

The Repository Observer must never derive file truth from:

- Pi message text;
- tool arguments;
- tool-result payloads;
- assistant claims;
- planner membership;
- existing `DERIVED_HINT`s.

The Observer reads the repository through an authoritative repository seam and emits normal Runtime `SourceObservation`s.

Pi may later suggest **which paths are worth observing**, but Pi is not the authority for **what those paths contain**.

---

## 2. Every observation is bound to an exact expected RepositoryRevision

The accepted RepositoryRevision model represents repository state using existing project semantics including:

```text
baseCommit
treeHash
workingTreePatchHash | null
```

DS-011 must not silently observe “whatever happens to be on disk” while labeling it as some other revision.

For a bounded observation request:

```text
Expected RepositoryRevision R
+ canonical paths P[]
        ↓
Observer
```

it must establish that the repository being read corresponds to R.

### Required race-safety principle

For live working-tree observation, use an equivalent of:

```text
read current revision R_before
verify R_before == expected R
read bounded files
read current revision R_after
verify R_after == expected R
```

If the repository changes during the observation window, do **not** emit AVAILABLE/ABSENT as if the read were stable. Return/emit a bounded UNAVAILABLE outcome such as `REVISION_CHANGED_DURING_OBSERVATION`.

An equivalent atomic strategy is acceptable if it proves the same property.

---

## 3. Dirty revisions must never fall back silently to baseCommit

A dirty RepositoryRevision (`workingTreePatchHash != null`) represents commit + working-tree delta.

The Observer must never do this:

```text
expected dirty revision
        ↓
read baseCommit only
        ↓
claim AVAILABLE current file state   ❌
```

Preferred DS-011 direction:

- verify the actual working tree exactly matches the expected dirty RepositoryRevision;
- then read the current workspace path under that verified revision;
- perform post-read revision verification to detect races.

If exact dirty-revision observation cannot be implemented safely within this task, fail closed with `UNAVAILABLE(DIRTY_REVISION_UNSUPPORTED)` and document the limitation. Do not weaken the revision contract.

---

## 4. AVAILABLE / ABSENT / UNAVAILABLE semantics remain exactly CR-002 semantics

For a requested canonical file source:

### AVAILABLE

Emit AVAILABLE only when:

- the repository revision is verified;
- the canonical path exists at that revision;
- file bytes/content can be read within bounded safety limits;
- content hash is computed from the exact observed content;
- the observation window remains bound to the expected revision.

### ABSENT

Emit ABSENT only when:

- the repository revision is successfully verified;
- the observer authoritatively establishes that the canonical path does not exist at that exact revision.

A read failure is never ABSENT.

### UNAVAILABLE

Use UNAVAILABLE for cases such as:

```text
REPOSITORY_UNAVAILABLE
REVISION_MISMATCH
REVISION_CHANGED_DURING_OBSERVATION
PATH_OUTSIDE_REPOSITORY
NON_CANONICAL_PATH
READ_FAILED
FILE_TOO_LARGE
UNSUPPORTED_BINARY
DIRTY_REVISION_UNSUPPORTED   (only if required by bounded implementation)
```

Exact reason-code names are experimental, but their semantics must be deterministic and documented.

---

## 5. Canonical source identity remains path-based; version identity remains content-based within the source

Use the existing neutral source scheme:

```text
repository/file://<canonical repository-relative path>
```

The same logical path keeps the same `sourceKey` as its contents change.

Content change:

```text
same sourceKey
+ different contentHash
→ different ContextSourceVersion.versionId
```

Do not include timestamps, model-call sequence, absolute machine paths, username, or workspace root in `contentHash`.

For text files, prefer the hash of the exact bytes/content actually observed. If an existing repository reader already defines byte-safe hashing/materialization semantics that match the accepted contracts, reuse them and document the choice.

`SourceVersionId = H(sourceKey, contentHash)` remains the Runtime identity rule; DS-011 must not redefine it.

---

## 6. Canonical path safety is mandatory

The Observer must reject or report UNAVAILABLE for paths that are not canonical repository-relative paths.

Do not permit:

- `..` traversal;
- absolute paths;
- drive-letter escapes;
- symlink/path resolution that escapes the repository root;
- alternate path spellings that create duplicate logical source identities.

Reuse existing `isCanonicalRepositoryPath` / repository path codec semantics when possible rather than inventing a second canonicalization model.

---

## 7. Observation is targeted and bounded — no repository crawler

DS-011 is **not** a whole-repository indexer.

The minimum request should be conceptually equivalent to:

```ts
interface RepositoryObservationRequest {
  expectedRevision: RepositoryRevisionRef
  paths: readonly CanonicalRepositoryPath[]
  observedAt: string
}
```

The Observer should inspect only the requested bounded path set.

No recursive source-tree crawl, embedding index, symbol index, vector DB, or background watcher is authorized.

---

## 8. Repository authority belongs at the adapter/observer boundary

The Runtime core should continue to consume generic:

```text
SourceObservation
ContextSourceDescriptor
```

The repository adapter/observer owns repository-specific details such as:

- canonical path validation;
- revision verification;
- filesystem/Git reads;
- repository-specific sourceKind/provenance identifiers;
- repository observation error mapping.

`packages/context-runtime` must not start shelling out to Git or importing desktop/Pi integration types.

Preferred organization is a separate repository-observer/integration seam consistent with workspace package conventions. If creating a new package would be disproportionate, a bounded non-core integration location is acceptable, but explain the boundary choice in the verification document.

---

# Required implementation

## 1. Define a provider-neutral repository observation seam

Implement an experimental observer API sufficient to produce, per requested path:

```text
source descriptor
+
AVAILABLE / ABSENT / UNAVAILABLE SourceObservation
+
expected/verified RepositoryRevision metadata for research evidence
```

Do not change the v0.2 public `ContextSnapshot`, `ExecutionRequest`, or persisted RepositoryRevision contracts.

Any new types must be experimental/internal unless architecture review explicitly promotes them later.

---

## 2. Reuse existing revision-reading semantics

The repository already has a `GitRevisionReader` path backed by worker-runtime revision reading.

DS-011 should reuse or factor existing logic rather than implementing a second incompatible definition of:

```text
baseCommit
treeHash
workingTreePatchHash
```

If code must be factored into a reusable package, keep the refactor bounded and behavior-preserving.

No production persistence schema changes are authorized.

---

## 3. Implement exact revision comparison

Add deterministic comparison of expected vs observed repository revision.

At minimum compare all semantically relevant fields represented by the existing revision contract.

Prove:

- exact clean revision match succeeds;
- wrong base commit fails closed;
- wrong tree hash fails closed;
- clean vs dirty mismatch fails closed;
- different workingTreePatchHash fails closed;
- repository mutation during observation fails closed.

---

## 4. Implement bounded file observation

For each canonical requested path:

```text
verified revision
        ↓
read path
        ↓
exists + supported readable content → AVAILABLE(contentHash)
confirmed missing                  → ABSENT
error / unsupported / race         → UNAVAILABLE(reason)
```

Use bounded size/read limits. Reuse the existing repository content safety conventions where appropriate (for example byte limits and strict text decoding).

Do not store raw repository content in research traces by default. Metadata-only evidence should include hashes, byte counts/token estimates when useful, statuses and reason codes.

---

## 5. Emit explicit neutral descriptors

Repository observations must supply descriptors rather than relying on Runtime source-key parsing.

Conceptual descriptor:

```text
sourceKey   = repository/file://src/auth.ts
sourceKind  = REPOSITORY_FILE   (exact experimental literal may vary)
provenance  = REPOSITORY_OBSERVER
```

The exact literals belong to the repository integration layer. Runtime core must not special-case them.

---

## 6. Advance the existing Context Universe using normal reconciliation

Feed Repository Observer outputs through existing CR-002 APIs.

Prove the transition sequence:

```text
File v1 observed AVAILABLE
→ Universe admits V1

same file unchanged AVAILABLE
→ NO_CHANGE / stable admitted V1

file changes to v2 at exact new RepositoryRevision
→ UPDATE / admits V2

file read temporarily fails
→ UNAVAILABLE / RETAIN_LAST_KNOWN V2

file authoritatively deleted
→ ABSENT / REMOVE / clears admitted version
```

Do not add a second repository-specific Universe implementation.

---

## 7. Demonstrate coexistence with Pi hints without promotion-by-hint

Add a deterministic integration fixture proving:

```text
Pi-derived repository/file path hint
        +
no Repository Observer observation
→ still not canonical Universe source
```

then:

```text
same canonical path
        +
Repository Observer AVAILABLE observation
→ canonical repository source admitted
```

The authority transition comes from the Repository Observer, not from the hint itself.

Do not modify Pi attribution rules merely to make this test easy.

---

## 8. Add one bounded integration with the accepted Shadow Planner

DS-011 does **not** implement CR-003B policy, but it should prove the new authoritative file Source can be consumed by the already-accepted generic Planner without any repository-specific logic in Policy V0.

A credential-free fixture may:

```text
Repository Observer admits repository/file://src/a.ts
        ↓
Universe revision
        ↓
PlanningRequest pins/targets that canonical sourceKey
        ↓
existing Policy V0
        ↓
REFERENCE representation / Shadow Working Set item
```

This is only an interoperability proof.

Do not add FULL/SYMBOL/DIFF representation policy or REPLACE/COMPRESS behavior in DS-011.

---

# Required deterministic tests

Credential-free tests must cover at least:

1. canonical repository path → stable `repository/file://*` sourceKey;
2. non-canonical / traversal / absolute path is rejected/fails closed;
3. exact expected clean RepositoryRevision match allows observation;
4. revision mismatch produces UNAVAILABLE/failure, never AVAILABLE;
5. pre/post revision mismatch detects mutation during the observation window;
6. existing supported file → AVAILABLE with deterministic contentHash;
7. unchanged file at same logical source → stable SourceVersion identity;
8. changed file at a new exact revision → new SourceVersion / Universe UPDATE;
9. confirmed missing file at verified revision → ABSENT;
10. read failure is UNAVAILABLE, never ABSENT;
11. UNAVAILABLE retains last-known admitted version through normal CR-002 reconciliation;
12. authoritative deletion clears the admitted version through ABSENT/REMOVE;
13. dirty revision exact-match path is either correctly observed or explicitly UNAVAILABLE with documented bounded reason — never silently read baseCommit as current state;
14. same file path under two revision observations never uses timestamp/session id as content identity;
15. Runtime core contains no Git/Pi/OpenCode/Codex adapter-specific imports or literals introduced by DS-011;
16. Pi-derived repository hint alone still does not create canonical repository source state;
17. Repository Observer AVAILABLE for that same path does create canonical source state;
18. accepted Policy V0 can consume the newly canonical repository Source through generic Universe/PlanningRequest interfaces;
19. no DS-011 code rewrites real model context;
20. no public v0.2 contract or production persistence schema is changed.

If dirty-revision support is implemented, add deterministic fixtures for working-tree modifications and deletion under a matching `workingTreePatchHash`.

---

# Optional live smoke

A live model call is **not required** to prove Repository Observer correctness.

Preferred evidence is a credential-free temporary Git repository smoke/test that performs real repository transitions:

```text
commit A: file = v1
observe AVAILABLE v1
modify working tree: file = v2
observe exact dirty revision v2
simulate/read failure or revision mismatch → UNAVAILABLE
commit/delete file → ABSENT
```

If a Pi + DeepSeek smoke is run, it must remain optional and Shadow-only. Do not make model credentials a gate for repository truth.

---

# Expected verification artifact

Create:

```text
docs/verification/context-runtime-ds-011-repository-observer.md
```

Record:

- implementation boundary and package placement;
- exact RepositoryRevision binding strategy;
- clean/dirty support status;
- race-detection strategy;
- path canonicalization/safety behavior;
- contentHash semantics;
- AVAILABLE / ABSENT / UNAVAILABLE producer semantics;
- Universe reconciliation evidence;
- Pi-hint coexistence evidence;
- Planner interoperability evidence;
- package tests/typechecks/full `pnpm check`;
- any real temporary-Git smoke;
- known limitations;
- explicit statement that CR-003B and CR-004 remain unauthorized.

No credentials, absolute user paths, repository raw file content, or sensitive payloads should be committed in verification artifacts.

---

# Stop conditions

Stop and escalate to the lead architect instead of broadening scope if any of these become necessary:

1. changing the persisted/public v0.2 `RepositoryRevision` contract;
2. changing `ContextSnapshot` or `ExecutionRequest` contracts;
3. adding production SQLite schema;
4. adding a full repository index/crawler/watcher;
5. adding symbol parsing, AST indexing, embeddings, vector search or graph ranking;
6. modifying Policy V0 to understand repository-specific sourceKind/provenance;
7. implementing FULL/SYMBOL/DIFF selection policy, REPLACE or COMPRESS;
8. rewriting real Pi/model context;
9. integrating OpenCode/Codex;
10. starting CR-004.

If current repository infrastructure cannot safely observe a dirty exact RepositoryRevision without a broader architectural change, return `UNAVAILABLE(DIRTY_REVISION_UNSUPPORTED)` for that bounded case and report the required follow-up. Do not weaken truth semantics.

---

# Required validation

At minimum run:

```bash
pnpm --filter @canvas-agent/context-runtime test
pnpm --filter @canvas-agent/context-runtime typecheck
```

plus all tests/typechecks for any repository integration package or desktop/worker-runtime package changed by the implementation.

Finally run:

```bash
pnpm check
```

If an existing unrelated flaky test appears, isolate and document it exactly; do not silently treat a red full gate as green.

---

# Handoff format

Return a concise handoff containing:

1. branch and HEAD;
2. modified files grouped by repository integration / Runtime core / tests / docs;
3. exact observation API/types introduced;
4. sourceKey/sourceKind/provenance semantics;
5. exact RepositoryRevision comparison/binding strategy;
6. clean-revision evidence;
7. dirty-revision evidence or explicit unsupported reason;
8. race-detection evidence;
9. AVAILABLE / ABSENT / UNAVAILABLE test evidence;
10. contentHash / SourceVersion identity evidence;
11. Universe transition evidence (INITIALIZE/NO_CHANGE/UPDATE/RETAIN_LAST_KNOWN/REMOVE as applicable);
12. Pi hint vs Repository Observer authority evidence;
13. accepted Planner interoperability evidence;
14. package tests/typechecks and full `pnpm check` result;
15. verification document path;
16. known limitations / proposal mismatches;
17. explicit scope confirmation:

```text
No CR-003B file-aware policy was implemented.
No FULL/SYMBOL/DIFF representation selection was implemented.
No REPLACE/COMPRESS behavior was implemented.
No real Pi/model context was rewritten.
No production persistence schema was added.
No v0.2 RepositoryRevision/ContextSnapshot/ExecutionRequest public contract was changed.
No OpenCode/Codex integration was added.
CR-004 was not started.
```

Do not self-declare DS-011 accepted. Wait for lead architect review.
