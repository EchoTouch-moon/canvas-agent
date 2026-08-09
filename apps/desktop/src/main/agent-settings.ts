import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'

export const agentSettingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    codexCliLauncherPath: z.string().min(1).nullable()
  })
  .strict()

export type AgentSettings = z.infer<typeof agentSettingsSchema>

export class AgentSettingsStore {
  constructor(private readonly userData: string) {}

  private filePath(): string {
    return join(this.userData, 'agent-settings-v1.json')
  }

  async read(): Promise<AgentSettings> {
    try {
      const raw = await readFile(this.filePath(), 'utf8')
      const parsed = agentSettingsSchema.safeParse(JSON.parse(raw))
      if (parsed.success) {
        return parsed.data
      }
    } catch {
      // missing or corrupt -> fall back to discovery
    }
    return { schemaVersion: 1, codexCliLauncherPath: null }
  }

  async writeLauncher(codexCliLauncherPath: string | null): Promise<void> {
    const file = this.filePath()
    await mkdir(dirname(file), { recursive: true })
    const temp = join(dirname(file), `.agent-settings-v1.json.${process.pid}.${Date.now()}.tmp`)
    try {
      await writeFile(
        temp,
        JSON.stringify({ schemaVersion: 1, codexCliLauncherPath }, null, 2),
        'utf8'
      )
      await rename(temp, file)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
  }
}
