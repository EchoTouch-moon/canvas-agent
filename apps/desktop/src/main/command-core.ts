import type { BrowserWindow } from 'electron'
import {
  commandRequestSchema,
  commandResponseSchemas,
  commandSchemas,
  type CommandError,
  type CommandInput,
  type CommandResponse,
  type WorkspaceCommand
} from '@canvas-agent/contracts'
import { AgentNotReadyError, mapCommandError, WorkspaceUnavailableError } from './command-errors'
import type { WorkspaceService } from './workspace-service'
import type { WorkspaceRuntimeManager } from './workspace-runtime-manager'
import type { AgentRuntimeLocator } from './agent-runtime-locator'

export interface CommandRoute {
  execute: (payload: unknown, context?: CommandRouteContext) => Promise<unknown>
}

export interface CommandRouteContext {
  window?: BrowserWindow
}

export interface CommandDeps {
  manager: WorkspaceRuntimeManager
  agent: AgentRuntimeLocator
}

const INTERNAL_FAILURE = 'Internal command failure'

export function buildRoutes(deps: CommandDeps): Record<string, CommandRoute> {
  const routes: Record<string, CommandRoute> = {}

  const workspaceRoute = <K extends WorkspaceCommand>(
    name: K,
    run: (workspace: WorkspaceService, payload: CommandInput<K>) => unknown
  ): void => {
    routes[name] = {
      execute: async (payload: unknown) =>
        deps.manager.withReadyRuntime(async (runtime) =>
          run(runtime.workspace, payload as CommandInput<K>)
        )
    }
  }

  workspaceRoute('project.create', (ws, payload) => ws.createProject(payload))
  workspaceRoute('project.get', (ws, payload) => ws.getProject(payload))
  workspaceRoute('project.list', (ws) => ws.listProjects())
  workspaceRoute('project.state', (ws, payload) => ws.projectState(payload.projectId))
  workspaceRoute('node.create', (ws, payload) => ws.createNode(payload))
  workspaceRoute('nodeDraft.upsert', (ws, payload) => ws.upsertNodeDraft(payload))
  workspaceRoute('nodeVersion.publish', (ws, payload) => ws.publishNodeVersion(payload))
  workspaceRoute('task.create', (ws, payload) => ws.createTask(payload))
  workspaceRoute('taskSpec.publish', (ws, payload) => ws.publishTaskSpec(payload))
  workspaceRoute('baseline.createDraft', (ws, payload) => ws.createBaselineDraft(payload))
  workspaceRoute('baseline.activate', (ws, payload) => ws.activateBaseline(payload))
  workspaceRoute('revision.current', (ws) => ws.revisionCurrent())
  workspaceRoute('snapshot.freeze', (ws, payload) => ws.freezeSnapshot(payload))
  workspaceRoute('context.resolve', (ws, payload) => ws.resolveContext(payload))
  workspaceRoute('run.list', (ws, payload) => ws.listRuns(payload))
  workspaceRoute('run.get', (ws, payload) => ws.getRun(payload))
  workspaceRoute('acceptance.evaluate', (ws, payload) => ws.evaluateAcceptance(payload))
  workspaceRoute('acceptance.list', (ws, payload) => ws.listAcceptance(payload))
  workspaceRoute('task.complete', (ws, payload) => ws.completeTask(payload))
  workspaceRoute('artifact.apply', (ws, payload) => ws.applyArtifact(payload))
  workspaceRoute('artifactApplication.list', (ws, payload) => ws.listArtifactApplications(payload))
  workspaceRoute('baseline.createCandidateFromTask', (ws, payload) =>
    ws.createBaselineCandidate(payload)
  )

  routes['execution.dispatch'] = {
    execute: (payload: unknown) =>
      deps.manager.withActiveRun(async (runtime) => {
        // Main Agent READY gate inside the atomic run lease: mutually exclusive
        // with executable changes (withConfigurationChange) and checked before
        // createDispatchedRun, so a non-READY Agent never starts a Run.
        const agentStatus = await deps.agent.status()
        if (agentStatus.state !== 'READY') {
          throw new AgentNotReadyError(`AGENT_NOT_READY: codex runtime is ${agentStatus.state}`)
        }
        return runtime.coordinator.dispatch(payload as CommandInput<'execution.dispatch'>)
      })
  }

  // cancel is callable during an active run and must not acquire a new run lease.
  routes['execution.cancel'] = {
    execute: async (payload: unknown) => {
      const runtime = deps.manager.getReadyRuntime()
      if (!runtime) {
        throw new WorkspaceUnavailableError('Workspace is not READY')
      }
      return runtime.coordinator.cancel(payload as CommandInput<'execution.cancel'>)
    }
  }

  routes['workspace.status'] = {
    execute: async () => deps.manager.status()
  }
  routes['workspace.chooseRepository'] = {
    execute: async (_payload: unknown, context?: CommandRouteContext) =>
      deps.manager.chooseRepository(context?.window)
  }
  routes['workspace.reopenLast'] = {
    execute: async () => deps.manager.reopenLast()
  }
  routes['workspace.close'] = {
    execute: async () => deps.manager.close()
  }

  routes['agent.status'] = {
    execute: async () => deps.agent.status()
  }
  routes['agent.chooseExecutable'] = {
    execute: async (_payload: unknown, context?: CommandRouteContext) =>
      deps.agent.chooseExecutable(context?.window)
  }
  routes['agent.clearExecutable'] = {
    execute: async () => deps.agent.clearExecutable()
  }

  return routes
}

export async function handleCommand(
  routes: Record<string, CommandRoute>,
  payload: unknown,
  context: CommandRouteContext = {}
): Promise<CommandResponse> {
  const parsed = commandRequestSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('invalid command request')
  }

  const route = routes[parsed.data.command]
  if (!route) {
    throw new Error(`unknown command: ${parsed.data.command}`)
  }

  let data: unknown
  try {
    data = await route.execute(parsed.data.payload, context)
  } catch (error) {
    return finalize(parsed.data.requestId, parsed.data.command, {
      ok: false,
      error: mapCommandError(error)
    })
  }

  const validated = commandSchemas[parsed.data.command].output.safeParse(data)
  if (!validated.success) {
    console.error('[command] output failed schema validation', parsed.data.command)
    return finalize(parsed.data.requestId, parsed.data.command, {
      ok: false,
      error: { name: 'InternalError', message: INTERNAL_FAILURE }
    })
  }

  return finalize(parsed.data.requestId, parsed.data.command, {
    ok: true,
    data: validated.data
  })
}

function finalize<K extends WorkspaceCommand>(
  requestId: string,
  command: K,
  body: { ok: true; data: unknown } | { ok: false; error: CommandError }
): CommandResponse {
  const response = { requestId, schemaVersion: 1, command, ...body } as CommandResponse
  const validated = commandResponseSchemas[command].safeParse(response)
  if (!validated.success) {
    console.error('[command] response failed schema validation', command)
    return {
      requestId,
      schemaVersion: 1,
      ok: false,
      command,
      error: { name: 'InternalError', message: INTERNAL_FAILURE }
    }
  }
  return validated.data as CommandResponse
}
