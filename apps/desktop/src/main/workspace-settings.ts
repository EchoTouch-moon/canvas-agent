import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { WorkspaceErrorReason } from '@canvas-agent/contracts'

export const workspaceSettingsSchema = z
  .object({
    schemaVersion: z.literal(1),
    lastRepositoryPath: z.string().min(1).nullable()
  })
  .strict()

export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>

export type ReadSettingsResult =
  | { ok: true; settings: WorkspaceSettings }
  | { ok: false; reasonCode: Extract<WorkspaceErrorReason, 'SETTINGS_INVALID'>; message: string }

export class WorkspaceSettingsStore {
  constructor(private readonly userData: string) {}

  private filePath(): string {
    return join(this.userData, 'settings-v1.json')
  }

  async read(): Promise<ReadSettingsResult> {
    let raw: string
    try {
      raw = await readFile(this.filePath(), 'utf8')
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') {
        return { ok: true, settings: { schemaVersion: 1, lastRepositoryPath: null } }
      }
      return {
        ok: false,
        reasonCode: 'SETTINGS_INVALID',
        message: `settings file is not readable: ${this.filePath()}`
      }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return {
        ok: false,
        reasonCode: 'SETTINGS_INVALID',
        message: `settings file is not valid JSON (preserved for diagnosis): ${this.filePath()}`
      }
    }

    const validated = workspaceSettingsSchema.safeParse(parsed)
    if (!validated.success) {
      return {
        ok: false,
        reasonCode: 'SETTINGS_INVALID',
        message: `settings file failed validation (preserved for diagnosis): ${this.filePath()}`
      }
    }
    return { ok: true, settings: validated.data }
  }

  async writeLast(lastRepositoryPath: string | null): Promise<void> {
    const settings: WorkspaceSettings = { schemaVersion: 1, lastRepositoryPath }
    const file = this.filePath()
    await mkdir(dirname(file), { recursive: true })
    const temp = join(dirname(file), `.settings-v1.json.${process.pid}.${Date.now()}.tmp`)
    try {
      await writeFile(temp, JSON.stringify(settings, null, 2), 'utf8')
      await rename(temp, file)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw new SettingsWriteError(`settings write failed: ${describe(error)}`)
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export class SettingsWriteError extends Error {
  override readonly name = 'SettingsWriteError'
}
