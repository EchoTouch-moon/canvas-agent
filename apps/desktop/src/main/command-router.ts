import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { DESKTOP_CHANNELS } from '@canvas-agent/contracts'
import { buildRoutes, handleCommand, type CommandDeps } from './command-core'
import { isTrustedSender } from './security'

export function registerCommandRouter(deps: CommandDeps): void {
  const routes = buildRoutes(deps)

  ipcMain.handle(DESKTOP_CHANNELS.command, (event: IpcMainInvokeEvent, payload: unknown) => {
    if (!isTrustedSender(event.senderFrame)) {
      throw new Error('Rejected IPC request from an untrusted renderer')
    }
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Rejected IPC request from a non-main renderer frame')
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    return handleCommand(routes, payload, { window: window ?? undefined })
  })
}
