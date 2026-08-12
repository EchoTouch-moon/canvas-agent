import { spawn } from 'node:child_process'
import { ISOLATED_GIT_ENV } from '@canvas-agent/worker-runtime'

// Byte-safe pinned-tree hash reader for exact historical SourceVersion
// materialization (DS-014). It reads ONLY the pinned commit object's tree hash
// (`baseCommit^{tree}`) through a bounded, shell:false, allowlisted Git call.
// The mutable working tree and current HEAD are never consulted: an admitted
// clean revision stays materializable after the worktree becomes dirty or HEAD
// moves, because the pinned commit object is immutable and content-addressed.

export const MAX_PINNED_TREE_HASH_BYTES = 1024

export type PinnedTreeReadResult =
  | { readonly kind: 'tree-hash'; readonly treeHash: string }
  | { readonly kind: 'commit-unavailable' }
  | { readonly kind: 'failed' }

export async function readPinnedTreeHash(
  repositoryPath: string,
  baseCommit: string
): Promise<PinnedTreeReadResult> {
  return new Promise<PinnedTreeReadResult>((resolve) => {
    // shell:false: git runs directly with argv (no shell interpolation).
    // ISOLATED_GIT_ENV overrides GIT_CONFIG_GLOBAL/SYSTEM to /dev/null so no
    // hostile global git config or credential helper is inherited.
    const child = spawn('git', ['rev-parse', `${baseCommit}^{tree}`], {
      cwd: repositoryPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...ISOLATED_GIT_ENV },
      shell: false
    })
    const chunks: Buffer[] = []
    let size = 0
    let settled = false

    const finish = (result: PinnedTreeReadResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish({ kind: 'failed' })
    }, 30_000)

    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      // Byte-safe bound: the tree hash is a tiny fixed-size SHA; anything over
      // the bound is a failure, never a truncated "tree hash".
      if (size > MAX_PINNED_TREE_HASH_BYTES) {
        child.kill('SIGKILL')
        finish({ kind: 'failed' })
        return
      }
      chunks.push(chunk)
    })
    child.stderr.on('data', () => {
      // git diagnostics are not part of the verified tree hash
    })
    child.on('error', () => {
      finish({ kind: 'failed' })
    })
    child.on('close', (code) => {
      if (settled) return
      if (code !== 0) {
        // Non-zero exit: the pinned commit does not resolve. This is a
        // fail-closed signal that the pinned source of truth is unavailable.
        finish({ kind: 'commit-unavailable' })
        return
      }
      const treeHash = Buffer.concat(chunks).toString('utf8').trim()
      if (!/^[0-9a-f]{40}$/.test(treeHash) && !/^[0-9a-f]{64}$/.test(treeHash)) {
        finish({ kind: 'failed' })
        return
      }
      finish({ kind: 'tree-hash', treeHash })
    })
  })
}
