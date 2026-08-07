import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { DESKTOP_CHANNELS, type CommandResponse } from '@canvas-agent/contracts'
import { buildRoutes, handleCommand, type CommandDeps } from './command-core'
import { isTrustedSender } from './security'

export function registerCommandRouter(deps: CommandDeps): void {
  const routes = buildRoutes(deps)

  ipcMain.handle(DESKTOP_CHANNELS.command, (event: IpcMainInvokeEvent, payload: unknown) => {
    if (!isTrustedSender(event.senderFrame)) {
      const response: CommandResponse = {
        requestId: '',
        schemaVersion: 1,
        ok: false,
        command: 'project.create',
        error: {
          name: 'RequestValidationError',
          message: 'Rejected IPC request from an untrusted renderer'
        }
      }
      return response
    }
    return handleCommand(routes, payload)
  })
}
