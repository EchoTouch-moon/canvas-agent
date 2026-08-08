import { z } from 'zod'

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

export const executionRequestSchema = z
  .object({
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
    schemaVersion: z.literal(1),
    requestHash: contentHash,
    expiresAt: z.iso.datetime()
  })
  .strict()

export type RepositoryRevisionContract = z.infer<typeof repositoryRevisionSchema>
export type ExecutionRequestContract = z.infer<typeof executionRequestSchema>
