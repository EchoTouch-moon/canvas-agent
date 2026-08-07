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

export type DispatchResult = CommandOutput<'execution.dispatch'>
export type DispatchOutcome = DispatchResult['outcome']
export type CancellationResult = CommandOutput<'execution.cancel'>
export type VerificationCommandResult = NonNullable<DispatchResult['verificationResults']>[number]
export type ArtifactDescriptor = NonNullable<DispatchResult['artifacts']>[number]
