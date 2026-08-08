import type { ProjectStateView } from '@canvas-agent/contracts'
import type { WorkspaceService } from './workspace-service'
import type { ExecutionCoordinator } from './execution-coordinator'
import { buildRoutes, handleCommand } from './command-core'

interface Phase3SmokeDeps {
  workspace: WorkspaceService
  coordinator: ExecutionCoordinator
  projectId: string
}

function frame(command: string, payload: unknown): Record<string, unknown> {
  return { requestId: 'phase3-smoke', schemaVersion: 1, command, payload }
}

export async function runPhase3Smoke(deps: Phase3SmokeDeps): Promise<void> {
  const routes = buildRoutes({ workspace: deps.workspace, coordinator: deps.coordinator })
  const req = (command: string, payload: unknown): Record<string, unknown> =>
    frame(command, payload)

  const listed = await handleCommand(routes, req('project.list', {}))
  if (!listed.ok) throw new Error(`project.list failed: ${listed.error.message}`)

  const state = await handleCommand(routes, req('project.state', { projectId: deps.projectId }))
  if (!state.ok) throw new Error(`project.state failed: ${state.error.message}`)
  const view = state.data as ProjectStateView
  if (view.tasks.length === 0 || view.taskSpecs.length === 0 || view.nodeVersions.length === 0) {
    throw new Error('project.state did not include the demo graph')
  }
  if (view.activeBaseline === null) {
    throw new Error('project.state did not include an ACTIVE baseline')
  }
  console.error('[phase3-smoke] project hydration PASSED')

  const nodeVersion = view.nodeVersions[0] as { id: string; body: string }
  const spec = view.taskSpecs[0]?.spec as { id: string } | undefined
  const task = view.tasks[0] as { id: string } | undefined
  if (spec === undefined || task === undefined) {
    throw new Error('project.state missing task or task spec')
  }

  const revision = await handleCommand(routes, req('revision.current', {}))
  if (!revision.ok) throw new Error(`revision.current failed: ${revision.error.message}`)
  const revisionId = (revision.data as { id: string }).id

  const frozen = await handleCommand(
    routes,
    req('snapshot.freeze', {
      projectId: deps.projectId,
      taskId: task.id,
      taskSpecVersionId: spec.id,
      baseBaselineId: (view.activeBaseline as { id: string }).id,
      expectedRepositoryRevisionId: revisionId,
      selections: [
        {
          source: { kind: 'NODE_VERSION', nodeVersionId: nodeVersion.id },
          selectionReason: 'phase3 smoke'
        }
      ]
    })
  )
  if (!frozen.ok) throw new Error(`snapshot.freeze failed: ${frozen.error.message}`)
  const frozenData = frozen.data as { snapshot: { id: string }; items: Array<{ itemType: string }> }
  const snapshotId = frozenData.snapshot.id
  const itemTypes = new Set(frozenData.items.map((item) => item.itemType))
  if (!itemTypes.has('USER_INPUT') || !itemTypes.has('NODE_VERSION')) {
    throw new Error('snapshot.freeze did not materialize the pinned task spec + selection')
  }
  console.error('[phase3-smoke] snapshot frozen PASSED')

  const dispatch = await handleCommand(
    routes,
    req('execution.dispatch', {
      executionRequestId: `phase3-smoke-${Date.now()}`,
      contextSnapshotId: snapshotId
    })
  )
  if (!dispatch.ok)
    throw new Error(`execution.dispatch failed: ${dispatch.error.name}: ${dispatch.error.message}`)
  const response = dispatch.data as {
    runId: string
    executionRequestId: string
    result: {
      outcome: string
      patch?: string
      verificationResults?: Array<{ exitCode: number | null }>
    }
  }
  console.error(`[phase3-smoke] run=${response.runId} outcome=${response.result.outcome}`)
  if (response.result.outcome !== 'SUCCEEDED') {
    throw new Error(`execution outcome was ${response.result.outcome}`)
  }
  if (!(response.result.patch ?? '').includes('docs/phase2.md')) {
    throw new Error('execution patch did not contain the fixture file')
  }
  console.error('[phase3-smoke] patch evidence PASSED')
  if (response.result.verificationResults?.[0]?.exitCode !== 0) {
    throw new Error('execution verification did not exit 0')
  }
  console.error('[phase3-smoke] verification exit=0')
  console.error('[phase3-smoke] PASSED')
}
