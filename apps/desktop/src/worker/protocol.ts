import { z } from 'zod'
import { dispatchResultSchema, executionRequestSchema } from '@canvas-agent/contracts'

const messageIdSchema = z.string().min(1)
const executionIdSchema = z.string().min(1)
const protocolVersionSchema = z.literal(1)

// Main-internal trusted Agent launch plan (PROPOSAL-028B/DS-005B). The
// environment allowlist accepts only PATH/HOME and rejects any extra key; the
// executable is the absolute validated launcher path from the locator's private
// state, never a renderer-supplied value.
export const agentLaunchPlanSchema = z
  .object({
    schemaVersion: z.literal(1),
    provider: z.literal('codex-cli'),
    executable: z.string().min(1),
    environment: z
      .object({
        PATH: z.string().min(1),
        HOME: z.string().min(1)
      })
      .strict()
  })
  .strict()
export type AgentLaunchPlanContract = z.infer<typeof agentLaunchPlanSchema>

export const workerHostRequestSchema = z.discriminatedUnion('type', [
  z
    .object({
      protocolVersion: protocolVersionSchema,
      type: z.literal('init'),
      sourceRepositoryPath: z.string().min(1),
      runtimeDirectory: z.string().min(1),
      agentLaunchPlan: agentLaunchPlanSchema.nullable()
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      type: z.literal('dispatch'),
      messageId: messageIdSchema,
      executionRequestId: executionIdSchema,
      request: executionRequestSchema
    })
    .strict()
    .refine((frame) => frame.executionRequestId === frame.request.executionRequestId, {
      message: 'frame executionRequestId must match the request executionRequestId'
    }),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      type: z.literal('cancel'),
      messageId: messageIdSchema,
      executionRequestId: executionIdSchema
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      type: z.literal('dispose')
    })
    .strict()
])
export type WorkerHostRequest = z.infer<typeof workerHostRequestSchema>

export const workerHostResponseSchema = z.discriminatedUnion('type', [
  z
    .object({
      protocolVersion: protocolVersionSchema,
      type: z.literal('init:ack')
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      type: z.literal('dispatch:result'),
      messageId: messageIdSchema,
      executionRequestId: executionIdSchema,
      result: dispatchResultSchema
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      type: z.literal('cancel:result'),
      messageId: messageIdSchema,
      executionRequestId: executionIdSchema,
      cancelled: z.boolean()
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      type: z.literal('error'),
      messageId: messageIdSchema.nullable(),
      executionRequestId: executionIdSchema.nullable(),
      code: z.enum(['NOT_INITIALIZED', 'INVALID_FRAME', 'SERVICE_FAILURE']),
      message: z.string()
    })
    .strict(),
  z
    .object({
      protocolVersion: protocolVersionSchema,
      type: z.literal('dispose:ack')
    })
    .strict()
])
export type WorkerHostResponse = z.infer<typeof workerHostResponseSchema>
