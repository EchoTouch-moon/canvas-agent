import { z } from 'zod'

// Phase 4 #1: TASK_SPEC_VERSION (Main-owned pinned binding) + NODE_VERSION.
// Phase 4 #2: REPOSITORY_CONTENT — pinned repository file, authority REFERENCE/P2.

// Canonical repo-root-relative POSIX path. Non-canonical paths are rejected,
// never silently normalized.
export function isCanonicalRepositoryPath(path: string): boolean {
  if (path.length === 0) return false
  if (path.startsWith('/')) return false
  if (/[\\\0]/.test(path)) return false
  if (/^[A-Za-z]:/.test(path)) return false
  const segments = path.split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function encodeRepositoryPath(path: string): string {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function decodeRepositoryPath(encoded: string): string {
  return encoded
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/')
}

const taskSpecVersionSourceReferenceSchema = z
  .object({
    kind: z.literal('TASK_SPEC_VERSION'),
    taskSpecVersionId: z.string().min(1)
  })
  .strict()

const nodeVersionSourceReferenceSchema = z
  .object({
    kind: z.literal('NODE_VERSION'),
    nodeVersionId: z.string().min(1)
  })
  .strict()

const repositoryContentSourceReferenceSchema = z
  .object({
    kind: z.literal('REPOSITORY_CONTENT'),
    path: z.string().refine(isCanonicalRepositoryPath, {
      message: 'path must be a canonical repo-root-relative POSIX path'
    })
  })
  .strict()

export const sourceReferenceSchema = z.discriminatedUnion('kind', [
  taskSpecVersionSourceReferenceSchema,
  nodeVersionSourceReferenceSchema,
  repositoryContentSourceReferenceSchema
])

export type SourceReference = z.infer<typeof sourceReferenceSchema>

// Freeze selections are structurally NODE_VERSION | REPOSITORY_CONTENT only: the
// TASK_SPEC_VERSION is the Main-owned pinned binding and is never submitted by
// the renderer.
export const freezeSelectionSourceSchema = z.discriminatedUnion('kind', [
  nodeVersionSourceReferenceSchema,
  repositoryContentSourceReferenceSchema
])

export type FreezeSelectionSource = z.infer<typeof freezeSelectionSourceSchema>

export const freezeSelectionSchema = z
  .object({
    source: freezeSelectionSourceSchema,
    selectionReason: z.string().nullable().optional()
  })
  .strict()

export type FreezeSelection = z.infer<typeof freezeSelectionSchema>

// Canonical-only encoding. Raw ids and unknown schemes are invalid; historical
// frozen snapshots keep their old strings and are never re-encoded. The repo
// scheme encodes each path segment (the slash stays a hierarchy separator), and
// parsing re-encodes the decoded path and requires an exact match so a
// canonical encoding round-trips exactly.

export function sourceRefToString(ref: SourceReference): string {
  switch (ref.kind) {
    case 'TASK_SPEC_VERSION':
      return `task-spec://${ref.taskSpecVersionId}`
    case 'NODE_VERSION':
      return `node://${ref.nodeVersionId}`
    case 'REPOSITORY_CONTENT':
      return `repo://${encodeRepositoryPath(ref.path)}`
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
    case 'repo': {
      let path: string
      try {
        path = decodeRepositoryPath(id)
      } catch {
        throw new Error(`Invalid source reference: ${value}`)
      }
      if (!isCanonicalRepositoryPath(path)) {
        throw new Error(`Invalid source reference: ${value}`)
      }
      if (`repo://${encodeRepositoryPath(path)}` !== value) {
        throw new Error(`Invalid source reference: ${value}`)
      }
      return { kind: 'REPOSITORY_CONTENT', path }
    }
    default:
      throw new Error(`Unknown source reference scheme: ${scheme}`)
  }
}
