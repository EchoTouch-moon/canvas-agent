import { mkdir, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
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

// Narrow writer for the real-repository side effect. The renderer never passes
// repo paths / argv / messages / working directories; Main decides everything.
// Controlled identity/hooks/signing; dates come from authorizedAt; no push.
export class GitRepositoryWriter {
  private readonly hooksDir: string

  constructor(private readonly sourceRepositoryPath: string) {
    this.hooksDir = join(tmpdir(), 'canvas-agent-hooks')
  }

  async applyAcceptedPatch(input: ApplyAcceptedPatchInput): Promise<AppliedRevision> {
    await mkdir(this.hooksDir, { recursive: true })
    const patchFile = join(tmpdir(), `canvas-agent-patch-${input.applicationId}.diff`)
    await writeFile(patchFile, input.patchContent, 'utf8')
    try {
      await this.runGit(['apply', '--check', patchFile], input.authorizedAt)
      await this.runGit(['apply', '--index', patchFile], input.authorizedAt)
      await this.runGit(['commit', '-m', this.commitMessage(input)], input.authorizedAt)
    } finally {
      await rm(patchFile, { force: true }).catch(() => undefined)
    }
    const revision = await this.readRevision()
    if (revision.workingTreePatchHash !== null) {
      throw new ValidationError('adoption commit left a dirty working tree')
    }
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
    return this.readRevision()
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
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
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

  private async readRevision(): Promise<AppliedRevision> {
    const baseCommit = (await this.gitOutput(['rev-parse', 'HEAD'])).trim()
    const treeHash = (await this.gitOutput(['rev-parse', 'HEAD^{tree}'])).trim()
    const status = (await this.gitOutput(['status', '--porcelain'])).trim()
    return { baseCommit, treeHash, workingTreePatchHash: status.length === 0 ? null : 'dirty' }
  }
}
