import { z } from 'zod'
import { CONTEXT_AUTHORITIES, CONTEXT_ITEM_TYPES } from '@canvas-agent/domain'

const contentHash = z.string().regex(/^[a-f0-9]{64}$/i, 'Expected a SHA-256 hash')
const gitObjectHash = z.string().regex(/^([a-f0-9]{40}|[a-f0-9]{64})$/i, 'Expected a Git object hash')

// Runtime-safe opaque id: the worker uses executionRequestId directly as a
// filesystem path segment (worktrees/<id>, artifacts/<id>, recovery/<id>.json),
// so it must never contain separators, whitespace or path traversal.
export const executionRequestIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/, 'Expected a runtime-safe execution request id')
  .refine((value) => value !== '.' && value !== '..', {
    message: 'invalid execution request id'
  })

export const repositoryRevisionSchema = z
  .object({
    baseCommit: gitObjectHash,
    treeHash: gitObjectHash,
    workingTreePatchHash: contentHash.nullable()
  })
  .strict()

// --- v2 Context Bundle (PROPOSAL-028A, frozen) -----------------------------

export const MAX_EXECUTION_CONTEXT_ITEMS = 256
export const MAX_EXECUTION_CONTEXT_BYTES = 4 * 1024 * 1024

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

// --- ExecutionRequest v1/v2 variants ---------------------------------------

const executionRequestBaseSchema = z.object({
  executionRequestId: executionRequestIdSchema,
  runId: z.string().min(1),
  workerAttemptNumber: z.number().int().positive(),
  taskSpecVersionId: z.string().min(1),
  contextSnapshotId: z.string().min(1),
  expectedRepositoryRevision: repositoryRevisionSchema,
  checkpointId: z.string().min(1).nullable(),
  requiredCapabilities: z.array(z.string().min(1)),
  agentConfiguration: z
    .object({
      provider: z.string().min(1),
      model: z.string().min(1),
      temperature: z.number().min(0).max(2).optional()
    })
    .strict(),
  toolPolicy: z
    .object({
      allowedTools: z.array(z.string().min(1)),
      deniedPaths: z.array(z.string().min(1)),
      allowNetwork: z.boolean(),
      allowShell: z.boolean()
    })
    .strict(),
  workspaceStrategy: z.literal('ISOLATED_WORKTREE'),
  resourceBudget: z
    .object({
      maxDurationMs: z.number().int().positive(),
      maxToolCalls: z.number().int().positive(),
      maxTokens: z.number().int().positive().optional(),
      maxCostCents: z.number().int().nonnegative().optional(),
      maxDiskBytes: z.number().int().positive()
    })
    .strict(),
  requestHash: contentHash,
  expiresAt: z.iso.datetime()
})

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

export type RepositoryRevisionContract = z.infer<typeof repositoryRevisionSchema>
export type ExecutionContextItemV2 = z.infer<typeof executionContextItemV2Schema>
export type ExecutionContextBundleV2 = z.infer<typeof executionContextBundleV2Schema>
export type ExecutionRequestContractV1 = z.infer<typeof executionRequestV1Schema>
export type ExecutionRequestContractV2 = z.infer<typeof executionRequestV2Schema>
export type ExecutionRequestContract = z.infer<typeof executionRequestSchema>
