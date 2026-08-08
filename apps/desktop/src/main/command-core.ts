import {
  commandRequestSchema,
  commandResponseSchemas,
  commandSchemas,
  type CommandError,
  type CommandInput,
  type CommandResponse,
  type WorkspaceCommand
} from '@canvas-agent/contracts'
import { mapCommandError, WorkspaceUnavailableError } from './command-errors'
import type { WorkspaceService } from './workspace-service'
import type { ExecutionCoordinator } from './execution-coordinator'

export interface CommandRoute {
  execute: (payload: unknown) => Promise<unknown>
}

export interface CommandDeps {
  workspace: WorkspaceService | null
  coordinator: ExecutionCoordinator | null
}

const INTERNAL_FAILURE = 'Internal command failure'

export function buildRoutes(deps: CommandDeps): Record<string, CommandRoute> {
  const routes: Record<string, CommandRoute> = {}

  const workspaceRoute = <K extends WorkspaceCommand>(
    name: K,
    run: (workspace: WorkspaceService, payload: CommandInput<K>) => unknown
  ): void => {
    routes[name] = {
      execute: async (payload: unknown) => {
        if (!deps.workspace) {
          throw new WorkspaceUnavailableError('Workspace is not configured (set CANVAS_AGENT_REPO)')
        }
        return run(deps.workspace, payload as CommandInput<K>)
      }
    }
  }

  const coordinatorRoute = <K extends WorkspaceCommand>(
    name: K,
    run: (coordinator: ExecutionCoordinator, payload: CommandInput<K>) => unknown
  ): void => {
    routes[name] = {
      execute: async (payload: unknown) => {
        if (!deps.coordinator) {
          throw new WorkspaceUnavailableError('Workspace is not configured (set CANVAS_AGENT_REPO)')
        }
        return run(deps.coordinator, payload as CommandInput<K>)
      }
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
  coordinatorRoute('execution.dispatch', (coordinator, payload) => coordinator.dispatch(payload))
  coordinatorRoute('execution.cancel', (coordinator, payload) => coordinator.cancel(payload))

  return routes
}

export async function handleCommand(
  routes: Record<string, CommandRoute>,
  payload: unknown
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
    data = await route.execute(parsed.data.payload)
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
