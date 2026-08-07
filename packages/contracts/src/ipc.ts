import { z } from 'zod'
import type { CommandRequest, CommandResponse } from './command'

export const DESKTOP_CHANNELS = {
  runtimeInfo: 'canvas-agent:runtime-info',
  command: 'canvas-agent:command'
} as const

export const runtimeInfoSchema = z
  .object({
    appVersion: z.string().min(1),
    electronVersion: z.string().min(1),
    platform: z.enum(['aix', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32']),
    connected: z.boolean()
  })
  .strict()

export type RuntimeInfo = z.infer<typeof runtimeInfoSchema>

export interface CanvasAgentDesktopApi {
  getRuntimeInfo(): Promise<RuntimeInfo>
  command(request: CommandRequest): Promise<CommandResponse>
}
