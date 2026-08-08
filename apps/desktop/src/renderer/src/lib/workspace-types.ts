import type {
  CommandOutput,
  ProjectStateView as ContractProjectStateView
} from '@canvas-agent/contracts'

export type {
  CommandErrorName,
  CommandInput,
  CommandOutput,
  CommandRequest,
  CommandResponse,
  WorkspaceCommand
} from '@canvas-agent/contracts'

export type ProjectStateView = ContractProjectStateView
export type ProjectRecord = ProjectStateView['project']
export type NodeRecord = ProjectStateView['nodes'][number]
export type NodeDraftRecord = ProjectStateView['nodeDrafts'][number]
export type NodeVersionRecord = ProjectStateView['nodeVersions'][number]
export type EdgeRecord = ProjectStateView['edges'][number]
export type TaskRecord = ProjectStateView['tasks'][number]
export type TaskSpecAggregate = ProjectStateView['taskSpecs'][number]
export type TaskSpecVersionRecord = TaskSpecAggregate['spec']
export type AcceptanceCriterionRecord = TaskSpecAggregate['criteria'][number]
export type TaskTargetRecord = TaskSpecAggregate['targets'][number]
export type BaselineAggregate = ProjectStateView['baselines'][number]
export type ProjectBaselineRecord = BaselineAggregate['baseline']
export type BaselineItemRecord = BaselineAggregate['items'][number]

export type RepositoryRevisionRecord = CommandOutput<'revision.current'>
export type ContextSnapshotRecord = CommandOutput<'snapshot.freeze'>['snapshot']
export type ContextSnapshotItemRecord = CommandOutput<'snapshot.freeze'>['items'][number]
export type SnapshotFreezeResult = CommandOutput<'snapshot.freeze'>
export type FrozenSnapshotView = ContextSnapshotRecord & {
  readonly items: readonly ContextSnapshotItemRecord[]
}

export type DispatchResult = CommandOutput<'execution.dispatch'>['result']
export type DispatchOutcome = DispatchResult['outcome']
export type CancellationResult = CommandOutput<'execution.cancel'>
export type VerificationCommandResult = NonNullable<DispatchResult['verificationResults']>[number]
export type ArtifactDescriptor = NonNullable<DispatchResult['artifacts']>[number]

export type ResolvedContextItem = CommandOutput<'context.resolve'>['items'][number]

export type RunSummary = CommandOutput<'run.list'>[number]
export type RunAggregateView = CommandOutput<'run.get'>
export type ExecutionRequestRecordView = RunAggregateView['executionRequests'][number]
export type RunEventView = RunAggregateView['events'][number]
export type ArtifactView = RunAggregateView['artifacts'][number]

export type AcceptanceEvaluationAggregate = CommandOutput<'acceptance.evaluate'>
export type AcceptanceEvaluationRecord = AcceptanceEvaluationAggregate['evaluation']
export type AcceptanceEvaluationItemRecord = AcceptanceEvaluationAggregate['items'][number]
export type CriterionVerdict = AcceptanceEvaluationItemRecord['verdict']

export type ArtifactApplicationAggregate = CommandOutput<'artifact.apply'>
export type ArtifactApplicationEventView = ArtifactApplicationAggregate['events'][number]
export type BaselineCandidateAggregate = CommandOutput<'baseline.createCandidateFromTask'>
