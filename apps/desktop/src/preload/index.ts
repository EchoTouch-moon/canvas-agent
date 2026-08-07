import { contextBridge, ipcRenderer } from 'electron'
import {
  DESKTOP_CHANNELS,
  commandRequestSchema,
  commandResponseSchemas,
  runtimeInfoSchema,
  type CanvasAgentDesktopApi,
  type CommandRequest,
  type CommandResponse
} from '@canvas-agent/contracts'

// Custom APIs for renderer
const canvasAgentApi: CanvasAgentDesktopApi = {
  async getRuntimeInfo() {
    const response: unknown = await ipcRenderer.invoke(DESKTOP_CHANNELS.runtimeInfo)
    return runtimeInfoSchema.parse(response)
  },
  async command(request: CommandRequest): Promise<CommandResponse> {
    commandRequestSchema.parse(request)
    const response: unknown = await ipcRenderer.invoke(DESKTOP_CHANNELS.command, request)
    return commandResponseSchemas[request.command].parse(response)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (!process.contextIsolated) {
  throw new Error('Canvas Agent requires Electron context isolation')
}

contextBridge.exposeInMainWorld('canvasAgent', canvasAgentApi)
