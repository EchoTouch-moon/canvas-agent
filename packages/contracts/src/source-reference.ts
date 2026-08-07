import { z } from 'zod'

// Phase 4 #1: only kinds the resolver can actually materialize are schema-valid.
// Future kinds (REPOSITORY_CONTENT, ARTIFACT, USER_INPUT) are documented in
// PROPOSAL-023 but deliberately not part of the public union.

export const sourceReferenceSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('TASK_SPEC_VERSION'),
      taskSpecVersionId: z.string().min(1)
    })
    .strict(),
  z
    .object({
      kind: z.literal('NODE_VERSION'),
      nodeVersionId: z.string().min(1)
    })
    .strict()
])

export type SourceReference = z.infer<typeof sourceReferenceSchema>

export const contextSelectionSchema = z
  .object({
    source: sourceReferenceSchema,
    selectionReason: z.string().nullable().optional()
  })
  .strict()

export type ContextSelection = z.infer<typeof contextSelectionSchema>

// Canonical-only encoding. Raw ids and unknown schemes are invalid; historical
// frozen snapshots keep their old strings and are never re-encoded.

export function sourceRefToString(ref: SourceReference): string {
  switch (ref.kind) {
    case 'TASK_SPEC_VERSION':
      return `task-spec://${ref.taskSpecVersionId}`
    case 'NODE_VERSION':
      return `node://${ref.nodeVersionId}`
  }
}

export function parseSourceRef(value: string): SourceReference {
  const match = /^([a-z][a-z0-9-]*):\/\/(.+)$/.exec(value)
  const scheme = match?.[1]
  const id = match?.[2]
  if (scheme === undefined || id === undefined) {
    throw new Error(`Invalid source reference: ${value}`)
  }
  switch (scheme) {
    case 'task-spec':
      return { kind: 'TASK_SPEC_VERSION', taskSpecVersionId: id }
    case 'node':
      return { kind: 'NODE_VERSION', nodeVersionId: id }
    default:
      throw new Error(`Unknown source reference scheme: ${scheme}`)
  }
}
