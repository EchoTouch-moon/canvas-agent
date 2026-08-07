import {
  applyMigrations,
  closeDatabase,
  openDatabase,
  type Persistence
} from '@canvas-agent/persistence'

export function openWorkspaceDatabase(
  path: string,
  services?: Persistence['services'],
  migrationsFolder?: string
): Persistence {
  const persistence = openDatabase({ path, services })
  applyMigrations(persistence, migrationsFolder)
  return persistence
}

export function closeWorkspaceDatabase(persistence: Persistence): void {
  closeDatabase(persistence)
}
