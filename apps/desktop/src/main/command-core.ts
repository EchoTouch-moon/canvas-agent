import {
  commandRequestSchema,
  commandSchemas,
  type CommandInput,
  type CommandResponse,
  type ExecutionRequestContract,
  type WorkspaceCommand
} from '@canvas-agent/contracts'
import { mapCommandError, WorkspaceUnavailableError } from './command-errors'
import type { WorkspaceService } from './workspace-service'
import type { WorkerHost } from './worker-host'

export interface CommandRoute {
  execute: (payload: unknown) => Promise<unknown>
}

export interface CommandDeps {
  workspace: WorkspaceService | null
  worker: WorkerHost
}

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

  workspaceRoute('project.create', (ws, payload) => ws.createProject(payload))
  workspaceRoute('project.get', (ws, payload) => ws.getProject(payload))
  workspaceRoute('node.create', (ws, payload) => ws.createNode(payload))
  workspaceRoute('nodeDraft.upsert', (ws, payload) => ws.upsertNodeDraft(payload))
  workspaceRoute('nodeVersion.publish', (ws, payload) => ws.publishNodeVersion(payload))
  workspaceRoute('task.create', (ws, payload) => ws.createTask(payload))
  workspaceRoute('taskSpec.publish', (ws, payload) => ws.publishTaskSpec(payload))
  workspaceRoute('baseline.createDraft', (ws, payload) => ws.createBaselineDraft(payload))
  workspaceRoute('baseline.activate', (ws, payload) => ws.activateBaseline(payload))
  workspaceRoute('revision.current', (ws) => ws.revisionCurrent())
  workspaceRoute('snapshot.freeze', (ws, payload) => ws.freezeSnapshot(payload))

  routes['worker.dispatch'] = {
    execute: (payload) => deps.worker.dispatch(payload as ExecutionRequestContract)
  }
  routes['worker.cancel'] = {
    execute: async (payload) => {
      const { executionRequestId } = payload as { executionRequestId: string }
      return { cancelled: await deps.worker.cancel(executionRequestId) }
    }
  }

  return routes
}

export async function handleCommand(
  routes: Record<string, CommandRoute>,
  payload: unknown
): Promise<CommandResponse> {
  const parsed = commandRequestSchema.safeParse(payload)
  if (!parsed.success) {
    const raw = (typeof payload === 'object' && payload !== null ? payload : {}) as {
      requestId?: unknown
      command?: unknown
    }
    return {
      requestId: typeof raw.requestId === 'string' ? raw.requestId : '',
      schemaVersion: 1,
      ok: false,
      command: (typeof raw.command === 'string'
        ? raw.command
        : 'project.create') as WorkspaceCommand,
      error: {
        name: 'RequestValidationError',
        message: parsed.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join('; ')
      }
    }
  }

  const route = routes[parsed.data.command]
  if (!route) {
    return {
      requestId: parsed.data.requestId,
      schemaVersion: 1,
      ok: false,
      command: parsed.data.command,
      error: { name: 'RequestValidationError', message: `unknown command: ${parsed.data.command}` }
    }
  }

  let data: unknown
  try {
    data = await route.execute(parsed.data.payload)
  } catch (error) {
    return {
      requestId: parsed.data.requestId,
      schemaVersion: 1,
      ok: false,
      command: parsed.data.command,
      error: mapCommandError(error)
    }
  }

  const validated = commandSchemas[parsed.data.command].output.safeParse(data)
  if (!validated.success) {
    return {
      requestId: parsed.data.requestId,
      schemaVersion: 1,
      ok: false,
      command: parsed.data.command,
      error: { name: 'InternalError', message: 'command output failed schema validation' }
    }
  }

  return {
    requestId: parsed.data.requestId,
    schemaVersion: 1,
    ok: true,
    command: parsed.data.command,
    data: validated.data
  } as CommandResponse
}
