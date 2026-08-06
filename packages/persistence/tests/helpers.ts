import { createHash } from 'node:crypto'
import { applyMigrations, openDatabase, type Persistence } from '../src'

export const FIXED_NOW = '2026-08-06T00:00:00.000Z'

export function createTestPersistence(now: string = FIXED_NOW): Persistence {
  let counter = 0
  const persistence = openDatabase({
    path: ':memory:',
    services: {
      now: () => now,
      nextId: (prefix: string) => `${prefix}_${++counter}`
    }
  })
  applyMigrations(persistence)
  return persistence
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export function canonical(title: string, body: string): string {
  return JSON.stringify({ title, body })
}
