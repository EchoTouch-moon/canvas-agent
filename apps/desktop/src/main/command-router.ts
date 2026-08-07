import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { DESKTOP_CHANNELS } from '@canvas-agent/contracts'
import { buildRoutes, handleCommand, type CommandDeps } from './command-core'
import { isTrustedSender } from './security'

export function registerCommandRouter(deps: CommandDeps): void {
  const routes = buildRoutes(deps)

  ipcMain.handle(DESKTOP_CHANNELS.command, (event: IpcMainInvokeEvent, payload: unknown) => {
    if (!isTrustedSender(event.senderFrame)) {
      throw new Error('Rejected IPC request from an untrusted renderer')
    }
    return handleCommand(routes, payload)
  })
}
