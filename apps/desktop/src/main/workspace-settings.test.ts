import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceSettingsStore } from './workspace-settings'

async function makeStore(): Promise<{ store: WorkspaceSettingsStore; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'ca-settings-'))
  return { store: new WorkspaceSettingsStore(dir), dir }
}

describe('WorkspaceSettingsStore', () => {
  it('returns no last path for a fresh install', async () => {
    const { store } = await makeStore()
    const read = await store.read()
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.settings).toEqual({ schemaVersion: 1, lastRepositoryPath: null })
    }
  })

  it('writes the last path atomically and reads it back', async () => {
    const { store, dir } = await makeStore()
    await store.writeLast('/tmp/repo-a')
    const read = await store.read()
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.settings.lastRepositoryPath).toBe('/tmp/repo-a')
    }
    const raw = await readFile(join(dir, 'settings-v1.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual({ schemaVersion: 1, lastRepositoryPath: '/tmp/repo-a' })
    const leftovers = (await readdir(dir)).filter((name) => name.includes('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('overwrites the last path on a later write', async () => {
    const { store } = await makeStore()
    await store.writeLast('/tmp/repo-a')
    await store.writeLast('/tmp/repo-b')
    const read = await store.read()
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.settings.lastRepositoryPath).toBe('/tmp/repo-b')
    }
  })

  it('reports SETTINGS_INVALID for a corrupt file and preserves it for diagnosis', async () => {
    const { store, dir } = await makeStore()
    await writeFile(join(dir, 'settings-v1.json'), '{ not valid json', 'utf8')
    const read = await store.read()
    expect(read.ok).toBe(false)
    if (!read.ok) {
      expect(read.reasonCode).toBe('SETTINGS_INVALID')
    }
    expect(await readFile(join(dir, 'settings-v1.json'), 'utf8')).toBe('{ not valid json')
    await rm(dir, { recursive: true, force: true })
  })

  it('reports SETTINGS_INVALID for a schema-violating file', async () => {
    const { store, dir } = await makeStore()
    await writeFile(join(dir, 'settings-v1.json'), JSON.stringify({ schemaVersion: 99 }), 'utf8')
    const read = await store.read()
    expect(read.ok).toBe(false)
    if (!read.ok) {
      expect(read.reasonCode).toBe('SETTINGS_INVALID')
    }
    await rm(dir, { recursive: true, force: true })
  })
})
