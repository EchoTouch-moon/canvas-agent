import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/node-sqlite'
import type { NodeSQLiteDatabase } from 'drizzle-orm/node-sqlite'
import { migrate } from 'drizzle-orm/node-sqlite/migrator'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { defaultServices, type SystemServices } from './services'

export interface DatabaseOptions {
  path: string
  busyTimeoutMs?: number
  services?: SystemServices
}

export interface Persistence {
  readonly db: DatabaseSync
  readonly drizzle: NodeSQLiteDatabase
  readonly services: SystemServices
}

const migrationFolder = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

export function openDatabase(options: DatabaseOptions): Persistence {
  const db = new DatabaseSync(options.path)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? 5000}`)
  return {
    db,
    drizzle: drizzle({ client: db }),
    services: options.services ?? defaultServices
  }
}

export function applyMigrations(p: Persistence): void {
  migrate(p.drizzle, { migrationsFolder: migrationFolder })
  installGuards(p)
}

export function closeDatabase(p: Persistence): void {
  p.db.close()
}

function installGuards(p: Persistence): void {
  p.db.exec(`
    CREATE TRIGGER IF NOT EXISTS guard_node_version_no_update
    BEFORE UPDATE ON node_version
    BEGIN
      SELECT RAISE(ABORT, 'node_version rows are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS guard_node_version_no_delete
    BEFORE DELETE ON node_version
    BEGIN
      SELECT RAISE(ABORT, 'node_version rows are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS guard_task_spec_version_no_update
    BEFORE UPDATE ON task_spec_version
    BEGIN
      SELECT RAISE(ABORT, 'task_spec_version rows are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS guard_task_spec_version_no_delete
    BEFORE DELETE ON task_spec_version
    BEGIN
      SELECT RAISE(ABORT, 'task_spec_version rows are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS guard_frozen_snapshot_no_update
    BEFORE UPDATE ON context_snapshot
    WHEN OLD.status = 'FROZEN'
    BEGIN
      SELECT RAISE(ABORT, 'frozen context_snapshot rows are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS guard_frozen_snapshot_no_delete
    BEFORE DELETE ON context_snapshot
    WHEN OLD.status = 'FROZEN'
    BEGIN
      SELECT RAISE(ABORT, 'frozen context_snapshot rows are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS guard_frozen_snapshot_item_no_insert
    BEFORE INSERT ON context_snapshot_item
    WHEN EXISTS (SELECT 1 FROM context_snapshot WHERE id = NEW.context_snapshot_id AND status = 'FROZEN')
    BEGIN
      SELECT RAISE(ABORT, 'frozen context_snapshot items are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS guard_frozen_snapshot_item_no_update
    BEFORE UPDATE ON context_snapshot_item
    WHEN EXISTS (SELECT 1 FROM context_snapshot WHERE id = OLD.context_snapshot_id AND status = 'FROZEN')
    BEGIN
      SELECT RAISE(ABORT, 'frozen context_snapshot items are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS guard_frozen_snapshot_item_no_delete
    BEFORE DELETE ON context_snapshot_item
    WHEN EXISTS (SELECT 1 FROM context_snapshot WHERE id = OLD.context_snapshot_id AND status = 'FROZEN')
    BEGIN
      SELECT RAISE(ABORT, 'frozen context_snapshot items are immutable');
    END;

    CREATE TRIGGER IF NOT EXISTS guard_audit_log_append_only_update
    BEFORE UPDATE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log is append-only');
    END;

    CREATE TRIGGER IF NOT EXISTS guard_audit_log_append_only_delete
    BEFORE DELETE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'audit_log is append-only');
    END;
  `)
}

export function withTransaction<R>(p: Persistence, work: () => R): R {
  p.db.exec('BEGIN IMMEDIATE')
  try {
    const result = work()
    p.db.exec('COMMIT')
    return result
  } catch (error) {
    p.db.exec('ROLLBACK')
    throw error
  }
}
