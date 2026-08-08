import { mkdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { ValidationError } from '@canvas-agent/persistence'

export interface ApplyAcceptedPatchInput {
  applicationId: string
  baseCommit: string
  patchContent: string
  patchHash: string
  taskId: string
  runId: string
  artifactId: string
  authorizedAt: string
}

export interface AppliedRevision {
  baseCommit: string
  treeHash: string
  workingTreePatchHash: string | null
}

export interface HeadInspection {
  baseCommit: string
  parent: string | null
  message: string
  clean: boolean
}

const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null'

// Narrow writer for the real-repository side effect. The renderer never passes
// repo paths / argv / messages / working directories; Main decides everything.
// The expected base commit is a real precondition: before any mutation HEAD must
// equal it and be clean, and the resulting commit's parent must be it. Commit
// failures are safely compensated (reset to the expected base) when possible.
export class GitRepositoryWriter {
  private readonly hooksDir: string

  constructor(
    private readonly sourceRepositoryPath: string,
    private readonly runtimeDirectory: string
  ) {
    // Private, freshly created, verified-empty trusted hooks directory — never a
    // shared predictable path that could pre-exist with hostile hooks. Created
    // lazily inside applyAcceptedPatch so the error surfaces in the apply path.
    this.hooksDir = join(runtimeDirectory, `adoption-hooks-${randomBytes(8).toString('hex')}`)
  }

  async applyAcceptedPatch(input: ApplyAcceptedPatchInput): Promise<AppliedRevision> {
    await mkdir(this.hooksDir, { recursive: true })
    const patchFile = join(this.runtimeDirectory, `adoption-patch-${input.applicationId}.diff`)
    await writeFile(patchFile, input.patchContent, 'utf8')
    try {
      // P0-4: exact-base CAS before any mutation.
      await this.assertHeadEquals(input.baseCommit)
      await this.runGit(['apply', '--check', patchFile], input.authorizedAt)
      try {
        await this.runGit(['apply', '--index', patchFile], input.authorizedAt)
        await this.runGit(['commit', '-m', this.commitMessage(input)], input.authorizedAt)
      } catch (error) {
        // P0-5: safe compensation if we are still at the expected base.
        await this.compensateIfPossible(input.baseCommit)
        throw error
      }
    } finally {
      await rm(patchFile, { force: true }).catch(() => undefined)
    }
    const head = await this.inspectHead()
    if (head.parent !== input.baseCommit) {
      throw new ValidationError('adoption commit parent does not match the expected base')
    }
    if (!head.clean) {
      throw new ValidationError('adoption commit left a dirty working tree')
    }
    const revision = await this.currentRevision()
    return revision
  }

  async inspectHead(): Promise<HeadInspection> {
    const baseCommit = (await this.gitOutput(['rev-parse', 'HEAD'])).trim()
    const parent = (await this.gitOutput(['log', '-1', '--format=%P'])).trim()
    const message = await this.gitOutput(['log', '-1', '--format=%B'])
    const status = (await this.gitOutput(['status', '--porcelain'])).trim()
    return {
      baseCommit,
      parent: parent.length === 0 ? null : parent,
      message,
      clean: status.length === 0
    }
  }

  async currentRevision(): Promise<AppliedRevision> {
    const baseCommit = (await this.gitOutput(['rev-parse', 'HEAD'])).trim()
    const treeHash = (await this.gitOutput(['rev-parse', 'HEAD^{tree}'])).trim()
    const status = (await this.gitOutput(['status', '--porcelain'])).trim()
    return { baseCommit, treeHash, workingTreePatchHash: status.length === 0 ? null : 'dirty' }
  }

  private async assertHeadEquals(expectedBaseCommit: string): Promise<void> {
    const head = await this.inspectHead()
    if (head.baseCommit !== expectedBaseCommit) {
      throw new ValidationError('adoption_base_changed')
    }
    if (!head.clean) {
      throw new ValidationError('adoption_base_dirty')
    }
  }

  private async compensateIfPossible(expectedBaseCommit: string): Promise<void> {
    const head = await this.inspectHead()
    if (head.baseCommit !== expectedBaseCommit) {
      return
    }
    await this.runGit(['reset', '--hard', expectedBaseCommit], new Date().toISOString()).catch(
      () => undefined
    )
    const after = await this.inspectHead()
    if (after.baseCommit !== expectedBaseCommit || !after.clean) {
      throw new ValidationError('adoption_compensation_failed')
    }
  }

  private commitMessage(input: ApplyAcceptedPatchInput): string {
    return [
      `canvas-agent: adopt ${input.taskId}`,
      '',
      `Canvas-Agent-Application: ${input.applicationId}`,
      `Canvas-Agent-Run: ${input.runId}`,
      `Canvas-Agent-Artifact: ${input.artifactId}`,
      `Canvas-Agent-Patch-SHA256: ${input.patchHash}`
    ].join('\n')
  }

  private gitEnv(authorizedAt: string): Record<string, string> {
    return {
      GIT_CONFIG_GLOBAL: NULL_DEVICE,
      GIT_CONFIG_SYSTEM: NULL_DEVICE,
      GIT_AUTHOR_NAME: 'Canvas Agent',
      GIT_AUTHOR_EMAIL: 'agent@canvas-agent.local',
      GIT_COMMITTER_NAME: 'Canvas Agent',
      GIT_COMMITTER_EMAIL: 'agent@canvas-agent.local',
      GIT_AUTHOR_DATE: authorizedAt,
      GIT_COMMITTER_DATE: authorizedAt
    }
  }

  private commonArgs(): readonly string[] {
    return ['-c', 'commit.gpgSign=false', '-c', `core.hooksPath=${this.hooksDir}`]
  }

  private runGit(args: readonly string[], authorizedAt: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', [...this.commonArgs(), ...args], {
        cwd: this.sourceRepositoryPath,
        env: { ...process.env, ...this.gitEnv(authorizedAt) },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stderr = ''
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      child.on('error', (error) => reject(new Error(`git unavailable: ${error.message}`)))
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`))
        } else {
          resolve()
        }
      })
    })
  }

  private gitOutput(args: readonly string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('git', [...this.commonArgs(), ...args], {
        cwd: this.sourceRepositoryPath,
        env: { ...process.env, ...this.gitEnv('now') },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      child.on('error', (error) => reject(new Error(`git unavailable: ${error.message}`)))
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`git ${args.join(' ')} failed: ${stderr.trim()}`))
        } else {
          resolve(stdout)
        }
      })
    })
  }
}
