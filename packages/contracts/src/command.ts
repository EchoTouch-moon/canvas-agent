import { z } from 'zod'
import { freezeSelectionSchema, sourceReferenceSchema } from './source-reference'
import {
  BASELINE_STATUSES,
  CONTEXT_AUTHORITIES,
  CONTEXT_ITEM_TYPES,
  EDGE_STATUSES,
  EDGE_TYPES,
  NODE_LIFECYCLES,
  NODE_TYPES,
  SNAPSHOT_FRESHNESS,
  SNAPSHOT_STATUSES,
  TASK_STATUSES,
  TASK_TYPES
} from '@canvas-agent/domain'

const idSchema = z.string().min(1)
const isoDateTime = z.string().min(1)
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/i)
const gitObjectHashSchema = z.string().regex(/^([a-f0-9]{40}|[a-f0-9]{64})$/i)

// --- Project ---------------------------------------------------------------

const projectSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    description: z.string().nullable(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime
  })
  .strict()

const projectCreateSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional()
  })
  .strict()

const projectGetSchema = z.object({ projectId: idSchema }).strict()

// --- Node / NodeDraft / NodeVersion -----------------------------------------

const nodeSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    type: z.enum(NODE_TYPES),
    lifecycle: z.enum(NODE_LIFECYCLES),
    createdAt: isoDateTime,
    updatedAt: isoDateTime
  })
  .strict()

const nodeCreateSchema = z
  .object({
    projectId: idSchema,
    type: z.enum(NODE_TYPES),
    lifecycle: z.enum(NODE_LIFECYCLES).optional()
  })
  .strict()

const nodeDraftSchema = z
  .object({
    id: idSchema,
    nodeId: idSchema,
    title: z.string().min(1),
    body: z.string(),
    revision: z.number().int().nonnegative(),
    updatedAt: isoDateTime
  })
  .strict()

const nodeDraftUpsertSchema = z
  .object({
    nodeId: idSchema,
    title: z.string().min(1),
    body: z.string().optional(),
    expectedRevision: z.number().int().nonnegative().optional()
  })
  .strict()

const nodeVersionSchema = z
  .object({
    id: idSchema,
    nodeId: idSchema,
    sequence: z.number().int().positive(),
    title: z.string().min(1),
    body: z.string(),
    contentHash: contentHashSchema,
    createdAt: isoDateTime
  })
  .strict()

const nodeVersionPublishSchema = z
  .object({
    nodeId: idSchema,
    title: z.string().min(1),
    body: z.string()
  })
  .strict()

// --- Task / TaskSpecVersion -------------------------------------------------

const taskSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    type: z.enum(TASK_TYPES),
    status: z.enum(TASK_STATUSES),
    title: z.string().min(1),
    createdAt: isoDateTime,
    updatedAt: isoDateTime
  })
  .strict()

const taskCreateSchema = z
  .object({
    projectId: idSchema,
    type: z.enum(TASK_TYPES),
    title: z.string().min(1)
  })
  .strict()

const verificationMethodSchema = z.enum([
  'AUTOMATED_TEST',
  'MANUAL_REVIEW',
  'ARTIFACT_CHECK',
  'STRUCTURED_ASSERTION'
])

const taskTargetInputSchema = z
  .object({
    nodeId: idSchema.optional(),
    nodeVersionId: idSchema.optional(),
    position: z.number().int().nonnegative()
  })
  .strict()

const acceptanceCriterionInputSchema = z
  .object({
    description: z.string().min(1),
    verificationMethod: verificationMethodSchema.optional(),
    position: z.number().int().nonnegative()
  })
  .strict()

const acceptanceCriterionSchema = z
  .object({
    id: idSchema,
    taskSpecVersionId: idSchema,
    position: z.number().int().nonnegative(),
    description: z.string().min(1),
    verificationMethod: verificationMethodSchema
  })
  .strict()

const taskSpecSchema = z
  .object({
    id: idSchema,
    taskId: idSchema,
    sequence: z.number().int().positive(),
    description: z.string().min(1),
    scope: z.string().min(1),
    contentHash: contentHashSchema,
    createdAt: isoDateTime
  })
  .strict()

const taskSpecPublishSchema = z
  .object({
    taskId: idSchema,
    description: z.string().min(1),
    scope: z.string().min(1),
    targets: z.array(taskTargetInputSchema).optional(),
    criteria: z.array(acceptanceCriterionInputSchema).min(1)
  })
  .strict()

const taskSpecPublishResultSchema = z
  .object({
    spec: taskSpecSchema,
    criteria: z.array(acceptanceCriterionSchema)
  })
  .strict()

// --- Baseline ---------------------------------------------------------------

const baselineSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    status: z.enum(BASELINE_STATUSES),
    name: z.string().min(1),
    description: z.string().nullable(),
    repositoryRevisionId: idSchema.nullable(),
    activatedAt: isoDateTime.nullable(),
    supersededAt: isoDateTime.nullable(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime
  })
  .strict()

const baselineCreateDraftSchema = z
  .object({
    projectId: idSchema,
    name: z.string().min(1),
    nodeVersionIds: z.array(idSchema).min(1),
    description: z.string().optional(),
    repositoryRevisionId: idSchema.optional()
  })
  .strict()

const baselineActivateSchema = z.object({ baselineId: idSchema }).strict()

const baselineActivateResultSchema = z
  .object({
    activated: baselineSchema,
    superseded: baselineSchema.nullable()
  })
  .strict()

// --- Repository revision ----------------------------------------------------

const repositoryRevisionRowSchema = z
  .object({
    id: idSchema,
    baseCommit: gitObjectHashSchema,
    treeHash: gitObjectHashSchema,
    workingTreePatchHash: contentHashSchema.nullable(),
    createdAt: isoDateTime
  })
  .strict()

const emptyObjectSchema = z.object({}).strict()

// --- Context snapshot -------------------------------------------------------

const contextPrioritySchema = z.enum(['P0', 'P1', 'P2', 'P3'])

const contextSnapshotSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    taskId: idSchema,
    taskSpecVersionId: idSchema,
    baseBaselineId: idSchema,
    expectedRepositoryRevisionId: idSchema,
    status: z.enum(SNAPSHOT_STATUSES),
    freshness: z.enum(SNAPSHOT_FRESHNESS),
    createdAt: isoDateTime,
    updatedAt: isoDateTime
  })
  .strict()

const contextSnapshotItemSchema = z
  .object({
    id: idSchema,
    contextSnapshotId: idSchema,
    position: z.number().int().nonnegative(),
    itemType: z.enum(CONTEXT_ITEM_TYPES),
    sourceRef: z.string().min(1),
    resolvedContent: z.string(),
    contentHash: contentHashSchema,
    selectionReason: z.string().nullable(),
    authority: z.enum(CONTEXT_AUTHORITIES),
    priority: contextPrioritySchema,
    tokenEstimate: z.number().int().nonnegative(),
    blobId: idSchema.nullable()
  })
  .strict()

const snapshotFreezeSchema = z
  .object({
    projectId: idSchema,
    taskId: idSchema,
    taskSpecVersionId: idSchema,
    baseBaselineId: idSchema,
    expectedRepositoryRevisionId: idSchema,
    selections: z.array(freezeSelectionSchema)
  })
  .strict()

const snapshotFreezeResultSchema = z
  .object({
    snapshot: contextSnapshotSchema,
    items: z.array(contextSnapshotItemSchema)
  })
  .strict()

const resolvedContextItemSchema = z
  .object({
    itemType: z.enum(CONTEXT_ITEM_TYPES),
    sourceRef: z.string().min(1),
    resolvedContent: z.string(),
    contentHash: contentHashSchema,
    authority: z.enum(CONTEXT_AUTHORITIES),
    priority: contextPrioritySchema,
    tokenEstimate: z.number().int().nonnegative(),
    selectionReason: z.string().nullable().optional()
  })
  .strict()

const contextResolveSchema = z
  .object({
    projectId: idSchema,
    taskId: idSchema,
    taskSpecVersionId: idSchema,
    baseBaselineId: idSchema,
    expectedRepositoryRevisionId: idSchema,
    selections: z.array(sourceReferenceSchema)
  })
  .strict()

const contextResolveResultSchema = z
  .object({
    items: z.array(resolvedContextItemSchema)
  })
  .strict()

// --- Worker dispatch / cancel ----------------------------------------------

const dispatchOutcomeSchema = z.enum([
  'VALIDATION_REJECTED',
  'CLAIM_REJECTED',
  'REVISION_MISMATCH',
  'SUCCEEDED',
  'PARTIAL',
  'CANCELLED'
])

const artifactKindSchema = z.enum(['PATCH', 'TEST_RESULT', 'AGENT_SUMMARY', 'AGENT_PARTIAL'])

const verificationCommandResultSchema = z
  .object({
    argv: z.array(z.string().min(1)),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    stdout: z.string(),
    stderr: z.string(),
    timedOut: z.boolean(),
    cancelled: z.boolean(),
    outputTruncated: z.boolean(),
    durationMs: z.number().int().nonnegative()
  })
  .strict()

const artifactDescriptorSchema = z
  .object({
    kind: artifactKindSchema,
    fileName: z.string().min(1),
    contentHash: contentHashSchema,
    sizeBytes: z.number().int().nonnegative()
  })
  .strict()

const revisionMismatchSchema = z
  .object({
    field: z.string().min(1),
    expected: z.string().nullable(),
    actual: z.string().nullable()
  })
  .strict()

const recoveryMetadataSchema = z
  .object({
    executionRequestId: idSchema,
    worktreePath: z.string().min(1),
    state: z.enum(['running', 'interrupted']),
    startedAt: isoDateTime,
    interruptedAt: isoDateTime.optional(),
    cleanupSucceeded: z.boolean()
  })
  .strict()

export const dispatchResultSchema = z
  .object({
    outcome: dispatchOutcomeSchema,
    claimGranted: z.boolean(),
    rejectionReason: z.string().optional(),
    revisionMismatch: revisionMismatchSchema.optional(),
    patch: z.string().optional(),
    patchHash: contentHashSchema.optional(),
    verificationResults: z.array(verificationCommandResultSchema).optional(),
    artifacts: z.array(artifactDescriptorSchema).optional(),
    agentSummary: z.string().optional(),
    recovery: recoveryMetadataSchema.optional(),
    timedOut: z.boolean().optional()
  })
  .strict()
export type DispatchResult = z.infer<typeof dispatchResultSchema>

// --- Project state / execution coordination ---------------------------------

const projectListRequestSchema = z.object({}).strict()

const projectStateRequestSchema = z.object({ projectId: idSchema }).strict()

const executionDispatchRequestSchema = z
  .object({
    executionRequestId: idSchema,
    contextSnapshotId: idSchema
  })
  .strict()

const executionCancelSchema = z.object({ executionRequestId: idSchema }).strict()

const cancelResultSchema = z.object({ cancelled: z.boolean() }).strict()

// Response-only schemas for the persisted read model (never reused as input).

const edgeSchema = z
  .object({
    id: idSchema,
    projectId: idSchema,
    sourceNodeId: idSchema,
    targetNodeId: idSchema,
    type: z.enum(EDGE_TYPES),
    status: z.enum(EDGE_STATUSES),
    anchoredNodeVersionId: idSchema.nullable(),
    note: z.string().nullable(),
    createdAt: isoDateTime,
    updatedAt: isoDateTime
  })
  .strict()

const taskTargetSchema = z
  .object({
    id: idSchema,
    taskSpecVersionId: idSchema,
    nodeId: idSchema.nullable(),
    nodeVersionId: idSchema.nullable(),
    position: z.number().int().nonnegative()
  })
  .strict()

const baselineItemSchema = z
  .object({
    id: idSchema,
    baselineId: idSchema,
    nodeVersionId: idSchema,
    position: z.number().int().nonnegative()
  })
  .strict()

const taskSpecAggregateSchema = z
  .object({
    spec: taskSpecSchema,
    targets: z.array(taskTargetSchema),
    criteria: z.array(acceptanceCriterionSchema)
  })
  .strict()

const baselineAggregateSchema = z
  .object({
    baseline: baselineSchema,
    items: z.array(baselineItemSchema)
  })
  .strict()

const projectStateViewSchema = z
  .object({
    project: projectSchema,
    nodes: z.array(nodeSchema),
    nodeDrafts: z.array(nodeDraftSchema),
    nodeVersions: z.array(nodeVersionSchema),
    edges: z.array(edgeSchema),
    tasks: z.array(taskSchema),
    taskSpecs: z.array(taskSpecAggregateSchema),
    baselines: z.array(baselineAggregateSchema),
    activeBaseline: baselineSchema.nullable()
  })
  .strict()
export type ProjectStateView = z.infer<typeof projectStateViewSchema>

// --- Command error (command failure, not dispatch outcome) ------------------

export const commandErrorNameSchema = z.enum([
  'RequestValidationError',
  'NotFoundError',
  'ValidationError',
  'ConcurrencyError',
  'ImmutableWriteError',
  'PersistenceError',
  'HostUnavailableError',
  'InternalError'
])
export type CommandErrorName = z.infer<typeof commandErrorNameSchema>

export const commandErrorSchema = z
  .object({
    name: commandErrorNameSchema,
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional()
  })
  .strict()
export type CommandError = z.infer<typeof commandErrorSchema>

// --- Command map ------------------------------------------------------------

export interface CommandMap {
  'project.create': { request: z.infer<typeof projectCreateSchema>; response: z.infer<typeof projectSchema> }
  'project.get': { request: z.infer<typeof projectGetSchema>; response: z.infer<typeof projectSchema> }
  'project.list': { request: z.infer<typeof projectListRequestSchema>; response: z.infer<typeof projectSchema>[] }
  'project.state': { request: z.infer<typeof projectStateRequestSchema>; response: z.infer<typeof projectStateViewSchema> }
  'node.create': { request: z.infer<typeof nodeCreateSchema>; response: z.infer<typeof nodeSchema> }
  'nodeDraft.upsert': { request: z.infer<typeof nodeDraftUpsertSchema>; response: z.infer<typeof nodeDraftSchema> }
  'nodeVersion.publish': { request: z.infer<typeof nodeVersionPublishSchema>; response: z.infer<typeof nodeVersionSchema> }
  'task.create': { request: z.infer<typeof taskCreateSchema>; response: z.infer<typeof taskSchema> }
  'taskSpec.publish': { request: z.infer<typeof taskSpecPublishSchema>; response: z.infer<typeof taskSpecPublishResultSchema> }
  'baseline.createDraft': { request: z.infer<typeof baselineCreateDraftSchema>; response: z.infer<typeof baselineSchema> }
  'baseline.activate': { request: z.infer<typeof baselineActivateSchema>; response: z.infer<typeof baselineActivateResultSchema> }
  'revision.current': { request: z.infer<typeof emptyObjectSchema>; response: z.infer<typeof repositoryRevisionRowSchema> }
  'snapshot.freeze': { request: z.infer<typeof snapshotFreezeSchema>; response: z.infer<typeof snapshotFreezeResultSchema> }
  'context.resolve': { request: z.infer<typeof contextResolveSchema>; response: z.infer<typeof contextResolveResultSchema> }
  'execution.dispatch': { request: z.infer<typeof executionDispatchRequestSchema>; response: DispatchResult }
  'execution.cancel': { request: z.infer<typeof executionCancelSchema>; response: z.infer<typeof cancelResultSchema> }
}

export type WorkspaceCommand = keyof CommandMap
export type CommandInput<K extends WorkspaceCommand> = CommandMap[K]['request']
export type CommandOutput<K extends WorkspaceCommand> = CommandMap[K]['response']

export type CommandRequest<K extends WorkspaceCommand = WorkspaceCommand> = K extends WorkspaceCommand
  ? { requestId: string; schemaVersion: 1; command: K; payload: CommandMap[K]['request'] }
  : never

export type CommandResponse<K extends WorkspaceCommand = WorkspaceCommand> =
  | { requestId: string; schemaVersion: 1; ok: true; command: K; data: CommandMap[K]['response'] }
  | { requestId: string; schemaVersion: 1; ok: false; command: K; error: CommandError }

// --- Envelope schemas -------------------------------------------------------

function commandRequestMember<K extends WorkspaceCommand>(
  command: K,
  payload: z.ZodType<CommandMap[K]['request']>
) {
  return z
    .object({
      requestId: idSchema,
      schemaVersion: z.literal(1),
      command: z.literal(command),
      payload
    })
    .strict()
}

export const commandRequestSchema = z.discriminatedUnion('command', [
  commandRequestMember('project.create', projectCreateSchema),
  commandRequestMember('project.get', projectGetSchema),
  commandRequestMember('project.list', projectListRequestSchema),
  commandRequestMember('project.state', projectStateRequestSchema),
  commandRequestMember('node.create', nodeCreateSchema),
  commandRequestMember('nodeDraft.upsert', nodeDraftUpsertSchema),
  commandRequestMember('nodeVersion.publish', nodeVersionPublishSchema),
  commandRequestMember('task.create', taskCreateSchema),
  commandRequestMember('taskSpec.publish', taskSpecPublishSchema),
  commandRequestMember('baseline.createDraft', baselineCreateDraftSchema),
  commandRequestMember('baseline.activate', baselineActivateSchema),
  commandRequestMember('revision.current', emptyObjectSchema),
  commandRequestMember('snapshot.freeze', snapshotFreezeSchema),
  commandRequestMember('context.resolve', contextResolveSchema),
  commandRequestMember('execution.dispatch', executionDispatchRequestSchema),
  commandRequestMember('execution.cancel', executionCancelSchema)
])

// --- Response schemas (command-correlated, no z.unknown data) ----------------

function commandResponseMember<K extends WorkspaceCommand>(
  command: K,
  output: z.ZodType<CommandMap[K]['response']>
) {
  const ok = z
    .object({
      requestId: idSchema,
      schemaVersion: z.literal(1),
      ok: z.literal(true),
      command: z.literal(command),
      data: output
    })
    .strict()
  const error = z
    .object({
      requestId: idSchema,
      schemaVersion: z.literal(1),
      ok: z.literal(false),
      command: z.literal(command),
      error: commandErrorSchema
    })
    .strict()
  return z.union([ok, error])
}

export const commandResponseSchemas = {
  'project.create': commandResponseMember('project.create', projectSchema),
  'project.get': commandResponseMember('project.get', projectSchema),
  'project.list': commandResponseMember('project.list', z.array(projectSchema)),
  'project.state': commandResponseMember('project.state', projectStateViewSchema),
  'node.create': commandResponseMember('node.create', nodeSchema),
  'nodeDraft.upsert': commandResponseMember('nodeDraft.upsert', nodeDraftSchema),
  'nodeVersion.publish': commandResponseMember('nodeVersion.publish', nodeVersionSchema),
  'task.create': commandResponseMember('task.create', taskSchema),
  'taskSpec.publish': commandResponseMember('taskSpec.publish', taskSpecPublishResultSchema),
  'baseline.createDraft': commandResponseMember('baseline.createDraft', baselineSchema),
  'baseline.activate': commandResponseMember('baseline.activate', baselineActivateResultSchema),
  'revision.current': commandResponseMember('revision.current', repositoryRevisionRowSchema),
  'snapshot.freeze': commandResponseMember('snapshot.freeze', snapshotFreezeResultSchema),
  'context.resolve': commandResponseMember('context.resolve', contextResolveResultSchema),
  'execution.dispatch': commandResponseMember('execution.dispatch', dispatchResultSchema),
  'execution.cancel': commandResponseMember('execution.cancel', cancelResultSchema)
} as const

// --- Runtime route-registry skeleton (main process fills `execute`) ----------

export const commandSchemas = {
  'project.create': { input: projectCreateSchema, output: projectSchema },
  'project.get': { input: projectGetSchema, output: projectSchema },
  'project.list': { input: projectListRequestSchema, output: z.array(projectSchema) },
  'project.state': { input: projectStateRequestSchema, output: projectStateViewSchema },
  'node.create': { input: nodeCreateSchema, output: nodeSchema },
  'nodeDraft.upsert': { input: nodeDraftUpsertSchema, output: nodeDraftSchema },
  'nodeVersion.publish': { input: nodeVersionPublishSchema, output: nodeVersionSchema },
  'task.create': { input: taskCreateSchema, output: taskSchema },
  'taskSpec.publish': { input: taskSpecPublishSchema, output: taskSpecPublishResultSchema },
  'baseline.createDraft': { input: baselineCreateDraftSchema, output: baselineSchema },
  'baseline.activate': { input: baselineActivateSchema, output: baselineActivateResultSchema },
  'revision.current': { input: emptyObjectSchema, output: repositoryRevisionRowSchema },
  'snapshot.freeze': { input: snapshotFreezeSchema, output: snapshotFreezeResultSchema },
  'context.resolve': { input: contextResolveSchema, output: contextResolveResultSchema },
  'execution.dispatch': { input: executionDispatchRequestSchema, output: dispatchResultSchema },
  'execution.cancel': { input: executionCancelSchema, output: cancelResultSchema }
}
