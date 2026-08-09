import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type MigrationRuntimeMode = 'source' | 'packaged'

export interface MigrationPathContext {
  mode: MigrationRuntimeMode
  appPath: string
  resourcesPath: string
}

export class MigrationFolderNotFoundError extends Error {
  readonly expectedPaths: readonly string[]

  constructor(expectedPaths: readonly string[]) {
    super(
      `migration folder not found; expected one of:\n${expectedPaths.map((p) => `  - ${p}`).join('\n')}`
    )
    this.name = 'MigrationFolderNotFoundError'
    this.expectedPaths = expectedPaths
  }
}

export function resolveMigrationFolder(context: MigrationPathContext): string {
  const candidates =
    context.mode === 'packaged'
      ? [join(context.resourcesPath, 'drizzle')]
      : [
          join(context.appPath, '..', '..', 'packages', 'persistence', 'drizzle'),
          join(context.appPath, 'drizzle')
        ]

  const existing = candidates.find((candidate) => existsSync(candidate))
  if (existing === undefined) {
    throw new MigrationFolderNotFoundError(candidates)
  }
  return existing
}
