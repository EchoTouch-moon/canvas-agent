# PROPOSAL-028A — ExecutionRequest v2 Context Bundle contract addendum

- **Status:** APPROVED — exact contract shape frozen for DS-005
- **Decision owner:** Lead architect
- **Date:** 2026-08-09
- **Parent:** `PROPOSAL-028-local-cli-adapter-v1.md`

## Purpose

Freeze the public runtime schema needed to give a real Agent the exact immutable content of a FROZEN ContextSnapshot without allowing the Worker to query SQLite or re-resolve sources.

## Exported constants

```ts
export const MAX_EXECUTION_CONTEXT_ITEMS = 256
export const MAX_EXECUTION_CONTEXT_BYTES = 4 * 1024 * 1024
```

The byte limit applies to the UTF-8 byte length of the canonical serialized `items` array, not JavaScript string length.

## Exact v2 additions

`packages/contracts/src/execution-request.ts` adds:

```ts
import { CONTEXT_AUTHORITIES, CONTEXT_ITEM_TYPES } from '@canvas-agent/domain'

export const executionContextItemV2Schema = z
  .object({
    position: z.number().int().nonnegative(),
    itemType: z.enum(CONTEXT_ITEM_TYPES),
    sourceRef: z.string().min(1).max(4096),
    resolvedContent: z.string(),
    contentHash,
    authority: z.enum(CONTEXT_AUTHORITIES),
    priority: z.enum(['P0', 'P1', 'P2', 'P3']),
    tokenEstimate: z.number().int().nonnegative()
  })
  .strict()

export const executionContextBundleV2Schema = z
  .object({
    items: z.array(executionContextItemV2Schema).min(1).max(MAX_EXECUTION_CONTEXT_ITEMS),
    contentHash,
    totalBytes: z.number().int().positive().max(MAX_EXECUTION_CONTEXT_BYTES)
  })
  .strict()
```

The existing request fields become a shared strict base. Two variants are exported:

```ts
export const executionRequestV1Schema = executionRequestBaseSchema
  .extend({ schemaVersion: z.literal(1) })
  .strict()

export const executionRequestV2Schema = executionRequestBaseSchema
  .extend({
    contextBundle: executionContextBundleV2Schema,
    schemaVersion: z.literal(2)
  })
  .strict()

export const executionRequestSchema = z.discriminatedUnion('schemaVersion', [
  executionRequestV1Schema,
  executionRequestV2Schema
])
```

Export inferred `ExecutionContextItemV2`, `ExecutionContextBundleV2`, `ExecutionRequestContractV1`, `ExecutionRequestContractV2` and union `ExecutionRequestContract` types. Existing imports of `ExecutionRequestContract` remain valid but must narrow `schemaVersion` before accessing `contextBundle`.

## Canonicalization

Use the existing recursive, key-sorted `stableStringify` algorithm over the parsed `items` array.

```text
canonicalItems = stableStringify(parsedItems)
totalBytes    = UTF8.byteLength(canonicalItems)
contentHash   = SHA256(canonicalItems)
requestHash   = SHA256(stableStringify(requestWithoutRequestHash))
```

No whitespace-pretty JSON, locale ordering or platform newline conversion participates in these hashes.

## Semantic validation beyond Zod

Both Main materialization tests and Worker validation enforce:

1. positions equal `0..items.length-1` in array order;
2. `sha256(resolvedContent) === item.contentHash` for every item;
3. computed canonical byte length equals `totalBytes` and is within the exported limit;
4. computed canonical hash equals bundle `contentHash`;
5. at least one item has `authority === "TASK_INSTRUCTION"` and `priority === "P0"`;
6. outer `requestHash` matches after all fields are present.

The Worker performs these checks before claiming the request, creating a worktree or spawning an Agent.

## Main materialization

For new dispatches, `ExecutionCoordinator`:

1. requires the referenced Snapshot to be FROZEN;
2. reads `listSnapshotItems` from Persistence;
3. maps only the frozen fields named in the schema;
4. re-verifies each stored content hash;
5. creates the canonical bundle;
6. emits `schemaVersion: 2` and computes the outer request hash last.

The Renderer cannot send or override any bundle field.

## Compatibility policy

- Historical v1 JSON remains parseable and viewable.
- The Fixture adapter may accept v1 only in explicit test/development configuration during migration.
- The Codex production adapter rejects v1 with stable code `EXECUTION_CONTEXT_REQUIRED`.
- No persisted row or database migration is required because existing request JSON is immutable opaque evidence and new records store v2 JSON in the same field.

## Required contract tests

- v1 fixture parses unchanged;
- valid v2 round trip;
- discriminated union rejects v1 with a bundle and v2 without a bundle;
- canonical hash is independent of object insertion order;
- reordered items change the bundle hash;
- content tampering with stale item hash fails semantic validation;
- bundle total/hash tampering fails;
- missing P0 Task instruction fails;
- item 257 and byte `MAX + 1` fail;
- outer request hash changes when any bundle field changes.

## Non-goals

- persisting a second copy of Snapshot rows as a new entity;
- remote blob fetching;
- compressing or chunking the request;
- live context refresh after freeze;
- Provider-specific prompt formatting in Contracts.
