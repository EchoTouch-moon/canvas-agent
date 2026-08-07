import { spawn } from 'node:child_process'
import { NotFoundError, ValidationError } from '@canvas-agent/persistence'

export const MAX_REPOSITORY_CONTENT_BYTES = 512 * 1024

interface ReadFileResult {
  content: string
}

// Byte-safe reader for pinned repository content. The shared worker-runtime git
// runner decodes stdout as UTF-8 strings with truncation semantics, which is not
// acceptable as an auditable file-content boundary, so this reads raw bytes and
// fails closed: too large -> error, not-UTF-8 -> error, never frozen partially.
export class GitRepositoryContentReader {
  constructor(private readonly sourceRepositoryPath: string) {}

  async readFileAtCommit(path: string, baseCommit: string): Promise<ReadFileResult> {
    // Verify the pinned commit object exists first: an unavailable/missing
    // commit or corrupted repository is an internal failure, not a missing file.
    const commit = await this.execGit(['cat-file', '-e', `${baseCommit}^{commit}`], 'check')
    if (!commit.ok) {
      throw new Error(`repository content: pinned commit ${baseCommit} is unavailable`)
    }
    const { stdout } = await this.execGit(['cat-file', 'blob', `${baseCommit}:${path}`], 'blob')
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(stdout))
    } catch {
      throw new ValidationError('repository_content_not_utf8')
    }
    return { content }
  }

  private execGit(
    args: readonly string[],
    mode: 'blob' | 'check'
  ): Promise<{ ok: boolean; stdout: Buffer }> {
    return new Promise<{ ok: boolean; stdout: Buffer }>((resolve, reject) => {
      const child = spawn('git', [...args], {
        cwd: this.sourceRepositoryPath,
        stdio: ['ignore', 'pipe', 'pipe']
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
      const finish = (ok: boolean, stdout: Buffer): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({ ok, stdout })
      }

      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        fail(new Error(`repository read timed out for ${args.join(' ')}`))
      }, 30_000)

      child.stdout.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_REPOSITORY_CONTENT_BYTES) {
          child.kill('SIGKILL')
          fail(new ValidationError('repository_content_too_large'))
          return
        }
        chunks.push(chunk)
      })
      child.stderr.on('data', () => {
        // git diagnostics are intentionally not surfaced to the renderer
      })
      child.on('error', (error) => {
        fail(new Error(`git binary or repository is unavailable: ${error.message}`))
      })
      child.on('close', (code) => {
        if (settled) return
        if (code !== 0) {
          if (mode === 'blob') {
            fail(
              new NotFoundError(
                `Repository file ${args[args.length - 1] ?? ''} is not available at the pinned revision`,
                ''
              )
            )
          } else {
            finish(false, Buffer.concat(chunks))
          }
          return
        }
        finish(true, Buffer.concat(chunks))
      })
    })
  }
}
