import { spawn } from 'node:child_process'
import { ISOLATED_GIT_ENV } from '@canvas-agent/worker-runtime'

// Byte-safe git blob reader for the Repository Observer. The shared
// worker-runtime git runner decodes stdout as UTF-8 strings with truncation
// semantics, which is not acceptable as an auditable file-content boundary, so
// this reads raw bytes and fails closed: too large -> error, not-UTF-8 -> error.
// Mirrors the desktop GitRepositoryContentReader safety conventions without
// importing desktop code (this package must stay reusable outside apps/desktop).

export const MAX_REPOSITORY_CONTENT_BYTES = 512 * 1024

export type BlobReadOutcome =
  | { readonly kind: 'content'; readonly content: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'too-large' }
  | { readonly kind: 'not-utf8' }
  | { readonly kind: 'failed'; readonly message: string }

export async function readGitBlob(
  repositoryPath: string,
  baseCommit: string,
  path: string
): Promise<BlobReadOutcome> {
  // Verify the pinned commit object exists first: an unavailable/missing commit
  // or corrupted repository is an internal failure, not a missing file.
  const commitExists = await execGit(repositoryPath, ['cat-file', '-e', `${baseCommit}^{commit}`])
  if (!commitExists.ok) {
    return { kind: 'failed', message: `pinned commit ${baseCommit} is unavailable` }
  }
  const blob = await execGit(repositoryPath, ['cat-file', 'blob', `${baseCommit}:${path}`])
  if (blob.status === 'absent') {
    return { kind: 'absent' }
  }
  if (!blob.ok) {
    return { kind: 'failed', message: blob.message }
  }
  if (blob.bytes.length > MAX_REPOSITORY_CONTENT_BYTES) {
    return { kind: 'too-large' }
  }
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(
      new Uint8Array(blob.bytes)
    )
    return { kind: 'content', content }
  } catch {
    return { kind: 'not-utf8' }
  }
}

interface ExecResult {
  readonly ok: boolean
  readonly bytes: Buffer
  readonly status: 'ok' | 'absent' | 'error'
  readonly message: string
}

function execGit(repositoryPath: string, args: readonly string[]): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve, reject) => {
    const child = spawn('git', [...args], {
      cwd: repositoryPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...ISOLATED_GIT_ENV }
    })
    const chunks: Buffer[] = []
    let size = 0
    let settled = false

    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const finish = (result: ExecResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      fail(new Error(`repository read timed out for ${args.join(' ')}`))
    }, 30_000)

    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      // Byte-safe bound: a file over the limit is UNAVAILABLE(FILE_TOO_LARGE),
      // never silently truncated into "content".
      if (size > MAX_REPOSITORY_CONTENT_BYTES) {
        child.kill('SIGKILL')
        finish({ ok: false, bytes: Buffer.alloc(0), status: 'error', message: 'repository_content_too_large' })
        return
      }
      chunks.push(chunk)
    })
    child.stderr.on('data', () => {
      // git diagnostics are not part of the observed content
    })
    child.on('error', (error) => {
      fail(new Error(`git binary or repository is unavailable: ${error.message}`))
    })
    child.on('close', (code) => {
      if (settled) return
      if (code !== 0) {
        if (args[0] === 'cat-file' && args[1] === 'blob') {
          // git cat-file blob returns non-zero when the path does not exist at
          // the pinned revision (authoritative ABSENT signal from git).
          finish({ ok: false, bytes: Buffer.alloc(0), status: 'absent', message: '' })
        } else {
          finish({ ok: false, bytes: Buffer.alloc(0), status: 'error', message: `git exited ${code}` })
        }
        return
      }
      finish({ ok: true, bytes: Buffer.concat(chunks), status: 'ok', message: '' })
    })
  })
}
