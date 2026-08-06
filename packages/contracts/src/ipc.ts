import { z } from 'zod'

export const DESKTOP_CHANNELS = {
  runtimeInfo: 'canvas-agent:runtime-info'
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
}
