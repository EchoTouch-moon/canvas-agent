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
  try {
    applyMigrations(persistence, migrationsFolder)
  } catch (error) {
    closeDatabase(persistence)
    throw error
  }
  return persistence
}

export function closeWorkspaceDatabase(persistence: Persistence): void {
  closeDatabase(persistence)
}
