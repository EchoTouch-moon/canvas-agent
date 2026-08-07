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
    const stdout = await this.execGitBytes(['cat-file', 'blob', `${baseCommit}:${path}`])
    let content: string
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(stdout)
    } catch {
      throw new ValidationError('repository_content_not_utf8')
    }
    return { content }
  }

  private execGitBytes(args: readonly string[]): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
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
      const succeed = (buffer: Buffer): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(buffer)
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
          fail(
            new NotFoundError(
              `Repository file ${args[args.length - 1] ?? ''} is not available at the pinned revision`,
              ''
            )
          )
          return
        }
        succeed(Buffer.concat(chunks))
      })
    })
  }
}
