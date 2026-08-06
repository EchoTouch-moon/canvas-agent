import { describe, expect, it } from 'vitest'
import { executionRequestSchema } from '../src'

const hash = 'a'.repeat(64)
const commit = 'b'.repeat(40)

describe('executionRequestSchema', () => {
  it('accepts the minimum immutable MVP request', () => {
    const parsed = executionRequestSchema.parse({
      executionRequestId: 'req_01',
      runId: 'run_01',
      workerAttemptNumber: 1,
      taskSpecVersionId: 'task_spec_01',
      contextSnapshotId: 'snapshot_01',
      expectedRepositoryRevision: {
        baseCommit: commit,
        treeHash: commit,
        workingTreePatchHash: null
      },
      checkpointId: null,
      requiredCapabilities: ['git', 'node'],
      agentConfiguration: { provider: 'local-cli', model: 'configured-by-user' },
      toolPolicy: {
        allowedTools: ['read_file', 'write_file', 'run_tests'],
        deniedPaths: ['.env'],
        allowNetwork: false,
        allowShell: true
      },
      workspaceStrategy: 'ISOLATED_WORKTREE',
      resourceBudget: {
        maxDurationMs: 900_000,
        maxToolCalls: 120,
        maxDiskBytes: 2_000_000_000
      },
      schemaVersion: 1,
      requestHash: hash,
      expiresAt: '2026-08-07T00:00:00.000Z'
    })

    expect(parsed.workspaceStrategy).toBe('ISOLATED_WORKTREE')
  })

  it('rejects mutable or unknown request fields', () => {
    expect(() =>
      executionRequestSchema.parse({
        executionRequestId: 'req_01',
        mutableInstructions: true
      })
    ).toThrow()
  })
})
