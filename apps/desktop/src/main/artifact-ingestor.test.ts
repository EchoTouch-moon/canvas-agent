import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as path from 'node:path'
import { sha256Hex, ValidationError } from '@canvas-agent/persistence'
import { ArtifactIngestor, isStrictDescendant } from './artifact-ingestor'
import { cleanupTempDirs, trackTempDir } from './testing/git-fixture'

async function runtimeDir(): Promise<string> {
  return trackTempDir(await mkdtemp(join(tmpdir(), 'ca-ingest-')))
}

describe('isStrictDescendant (cross-platform)', () => {
  it('POSIX semantics', () => {
    expect(isStrictDescendant('/a/b/c', '/a/b', path.posix)).toBe(true)
    expect(isStrictDescendant('/a/b2', '/a/b', path.posix)).toBe(false)
    expect(isStrictDescendant('/a/b', '/a/b', path.posix)).toBe(false)
    expect(isStrictDescendant('/a', '/a/b', path.posix)).toBe(false)
  })

  it('Windows semantics', () => {
    expect(isStrictDescendant('C:\\a\\b\\c', 'C:\\a\\b', path.win32)).toBe(true)
    expect(isStrictDescendant('C:\\a\\b2', 'C:\\a\\b', path.win32)).toBe(false)
    expect(isStrictDescendant('C:\\a\\b', 'C:\\a\\b', path.win32)).toBe(false)
    expect(isStrictDescendant('C:\\a', 'C:\\a\\b', path.win32)).toBe(false)
  })
})

describe('ArtifactIngestor', () => {
  afterEach(async () => {
    await cleanupTempDirs()
  })

  it('ingests a verified artifact matching size and hash', async () => {
    const runtime = await runtimeDir()
    await mkdir(join(runtime, 'artifacts', 'exec-1'), { recursive: true })
    const content = '# patch\n+line\n'
    await writeFile(join(runtime, 'artifacts', 'exec-1', 'patch.diff'), content, 'utf8')
    const ingestor = new ArtifactIngestor(runtime)

    const inputs = await ingestor.ingest('exec-1', [
      {
        kind: 'PATCH',
        fileName: 'patch.diff',
        contentHash: sha256Hex(content),
        sizeBytes: Buffer.byteLength(content, 'utf8')
      }
    ])

    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({ kind: 'PATCH', content })
    expect(inputs[0]?.contentHash).toBe(sha256Hex(content))
  })

  it('rejects a hash mismatch', async () => {
    const runtime = await runtimeDir()
    await mkdir(join(runtime, 'artifacts', 'exec-1'), { recursive: true })
    await writeFile(join(runtime, 'artifacts', 'exec-1', 'patch.diff'), 'hello', 'utf8')
    const ingestor = new ArtifactIngestor(runtime)

    await expect(
      ingestor.ingest('exec-1', [
        { kind: 'PATCH', fileName: 'patch.diff', contentHash: '0'.repeat(64), sizeBytes: 5 }
      ])
    ).rejects.toThrow(/artifact_hash_mismatch/)
  })

  it('rejects a size mismatch', async () => {
    const runtime = await runtimeDir()
    await mkdir(join(runtime, 'artifacts', 'exec-1'), { recursive: true })
    await writeFile(join(runtime, 'artifacts', 'exec-1', 'patch.diff'), 'hello', 'utf8')
    const ingestor = new ArtifactIngestor(runtime)

    await expect(
      ingestor.ingest('exec-1', [
        { kind: 'PATCH', fileName: 'patch.diff', contentHash: sha256Hex('hello'), sizeBytes: 99 }
      ])
    ).rejects.toThrow(/artifact_size_mismatch/)
  })

  it('rejects non-UTF-8 content', async () => {
    const runtime = await runtimeDir()
    await mkdir(join(runtime, 'artifacts', 'exec-1'), { recursive: true })
    await writeFile(
      join(runtime, 'artifacts', 'exec-1', 'patch.diff'),
      Buffer.from([0xff, 0xfe, 0xff])
    )
    const ingestor = new ArtifactIngestor(runtime)

    await expect(
      ingestor.ingest('exec-1', [
        { kind: 'PATCH', fileName: 'patch.diff', contentHash: '0'.repeat(64), sizeBytes: 3 }
      ])
    ).rejects.toThrow(/artifact_not_utf8/)
  })

  it('rejects traversal file names', async () => {
    const runtime = await runtimeDir()
    await mkdir(join(runtime, 'artifacts', 'exec-1'), { recursive: true })
    const ingestor = new ArtifactIngestor(runtime)

    await expect(
      ingestor.ingest('exec-1', [
        { kind: 'PATCH', fileName: '../outside.diff', contentHash: '0'.repeat(64), sizeBytes: 1 }
      ])
    ).rejects.toThrow(/artifact_invalid_file_name|artifact_path_escape/)
  })

  it('rejects a symlinked artifact file even when the target is inside the execution dir', async () => {
    const runtime = await runtimeDir()
    const outside = await mkdtemp(join(tmpdir(), 'ca-ingest-outside-'))
    await writeFile(join(outside, 'secret.txt'), 'secret', 'utf8')
    await mkdir(join(runtime, 'artifacts', 'exec-1'), { recursive: true })
    await symlink(join(outside, 'secret.txt'), join(runtime, 'artifacts', 'exec-1', 'patch.diff'))
    const ingestor = new ArtifactIngestor(runtime)

    await expect(
      ingestor.ingest('exec-1', [
        { kind: 'PATCH', fileName: 'patch.diff', contentHash: '0'.repeat(64), sizeBytes: 6 }
      ])
    ).rejects.toThrow(/artifact_symlink_unsupported/)
  })

  it('rejects an in-directory symlink artifact', async () => {
    const runtime = await runtimeDir()
    await mkdir(join(runtime, 'artifacts', 'exec-1'), { recursive: true })
    await writeFile(join(runtime, 'artifacts', 'exec-1', 'real.diff'), 'real', 'utf8')
    await symlink('real.diff', join(runtime, 'artifacts', 'exec-1', 'patch.diff'))
    const ingestor = new ArtifactIngestor(runtime)

    await expect(
      ingestor.ingest('exec-1', [
        { kind: 'PATCH', fileName: 'patch.diff', contentHash: '0'.repeat(64), sizeBytes: 4 }
      ])
    ).rejects.toThrow(/artifact_symlink_unsupported/)
  })

  it('rejects an artifact larger than the cap before buffering it', async () => {
    const runtime = await runtimeDir()
    await mkdir(join(runtime, 'artifacts', 'exec-1'), { recursive: true })
    await writeFile(join(runtime, 'artifacts', 'exec-1', 'big.diff'), 'x'.repeat(17 * 1024 * 1024))
    const ingestor = new ArtifactIngestor(runtime)

    await expect(
      ingestor.ingest('exec-1', [
        {
          kind: 'PATCH',
          fileName: 'big.diff',
          contentHash: '0'.repeat(64),
          sizeBytes: 17 * 1024 * 1024
        }
      ])
    ).rejects.toThrow(/artifact_too_large/)
  })

  it('rejects an execution directory that is itself a symlink outside the root', async () => {
    const runtime = await runtimeDir()
    const outside = await mkdtemp(join(tmpdir(), 'ca-ingest-outside-'))
    await mkdir(join(runtime, 'artifacts'), { recursive: true })
    await symlink(outside, join(runtime, 'artifacts', 'exec-1'))
    await writeFile(join(outside, 'patch.diff'), 'x', 'utf8')
    const ingestor = new ArtifactIngestor(runtime)

    await expect(
      ingestor.ingest('exec-1', [
        { kind: 'PATCH', fileName: 'patch.diff', contentHash: '0'.repeat(64), sizeBytes: 1 }
      ])
    ).rejects.toThrow(/artifact_execution_dir_escape|artifact_path_escape/)
  })

  it('short-circuits when there are no descriptors', async () => {
    const runtime = await runtimeDir()
    const ingestor = new ArtifactIngestor(runtime)
    await expect(ingestor.ingest('exec-1', [])).resolves.toEqual([])
  })
})

describe('ArtifactIngestor error types', () => {
  it('ValidationError is thrown for integrity failures', async () => {
    const runtime = await runtimeDir()
    await mkdir(join(runtime, 'artifacts', 'exec-1'), { recursive: true })
    await writeFile(join(runtime, 'artifacts', 'exec-1', 'patch.diff'), 'hello', 'utf8')
    const ingestor = new ArtifactIngestor(runtime)
    try {
      await ingestor.ingest('exec-1', [
        { kind: 'PATCH', fileName: 'patch.diff', contentHash: '0'.repeat(64), sizeBytes: 5 }
      ])
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
    }
  })
})
