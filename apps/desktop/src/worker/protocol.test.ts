import { describe, expect, it } from 'vitest'
import {
  workerHostRequestSchema,
  workerHostResponseSchema,
  type WorkerHostRequest
} from './protocol'

const HASH = 'a'.repeat(64)

function requestPayload(): Record<string, unknown> {
  return {
    executionRequestId: 'exec-1',
    runId: 'run-1',
    workerAttemptNumber: 1,
    taskSpecVersionId: 'spec-1',
    contextSnapshotId: 'snap-1',
    expectedRepositoryRevision: {
      baseCommit: 'b'.repeat(40),
      treeHash: 'c'.repeat(40),
      workingTreePatchHash: null
    },
    checkpointId: null,
    requiredCapabilities: ['git', 'node'],
    agentConfiguration: { provider: 'fixture', model: 'deterministic' },
    toolPolicy: {
      allowedTools: ['write_file', 'run_command'],
      deniedPaths: [],
      allowNetwork: false,
      allowShell: true
    },
    workspaceStrategy: 'ISOLATED_WORKTREE',
    resourceBudget: { maxDurationMs: 30_000, maxToolCalls: 20, maxDiskBytes: 1_000_000_000 },
    schemaVersion: 1,
    requestHash: HASH,
    expiresAt: '2099-01-01T00:00:00.000Z'
  }
}

describe('worker host protocol', () => {
  it('accepts valid request frames', () => {
    expect(() =>
      workerHostRequestSchema.parse({
        protocolVersion: 1,
        type: 'init',
        sourceRepositoryPath: '/repo',
        runtimeDirectory: '/runtime'
      })
    ).not.toThrow()
    expect(() =>
      workerHostRequestSchema.parse({
        protocolVersion: 1,
        type: 'dispatch',
        messageId: 'msg-1',
        executionRequestId: 'exec-1',
        request: requestPayload()
      })
    ).not.toThrow()
    expect(() =>
      workerHostRequestSchema.parse({
        protocolVersion: 1,
        type: 'cancel',
        messageId: 'msg-2',
        executionRequestId: 'exec-1'
      })
    ).not.toThrow()
  })

  it('rejects unknown fields and wrong protocolVersion', () => {
    expect(() =>
      workerHostRequestSchema.parse({
        protocolVersion: 1,
        type: 'dispatch',
        messageId: 'msg-1',
        executionRequestId: 'exec-1',
        request: requestPayload(),
        extra: true
      })
    ).toThrow()
    expect(() => workerHostRequestSchema.parse({ protocolVersion: 2, type: 'dispose' })).toThrow()
  })

  it('accepts response frames including errors and cancel acks', () => {
    expect(() =>
      workerHostResponseSchema.parse({
        protocolVersion: 1,
        type: 'dispatch:result',
        messageId: 'msg-1',
        executionRequestId: 'exec-1',
        result: { outcome: 'SUCCEEDED', claimGranted: true }
      })
    ).not.toThrow()
    expect(() =>
      workerHostResponseSchema.parse({
        protocolVersion: 1,
        type: 'cancel:result',
        messageId: 'msg-2',
        executionRequestId: 'exec-1',
        cancelled: true
      })
    ).not.toThrow()
    expect(() =>
      workerHostResponseSchema.parse({
        protocolVersion: 1,
        type: 'error',
        messageId: 'msg-3',
        executionRequestId: null,
        code: 'NOT_INITIALIZED',
        message: 'boom'
      })
    ).not.toThrow()
    expect(() =>
      workerHostResponseSchema.parse({
        protocolVersion: 1,
        type: 'error',
        messageId: null,
        executionRequestId: null,
        code: 'INVALID_FRAME',
        message: 'unattributable'
      })
    ).not.toThrow()
  })

  it('rejects a dispatch frame whose executionRequestId disagrees with the request', () => {
    expect(() =>
      workerHostRequestSchema.parse({
        protocolVersion: 1,
        type: 'dispatch',
        messageId: 'msg-1',
        executionRequestId: 'exec-A',
        request: { ...requestPayload(), executionRequestId: 'exec-B' }
      })
    ).toThrow()
  })

  it('keeps messageId and executionRequestId distinct identities', () => {
    const dispatch = workerHostRequestSchema.parse({
      protocolVersion: 1,
      type: 'dispatch',
      messageId: 'msg-101',
      executionRequestId: 'exec-7',
      request: { ...requestPayload(), executionRequestId: 'exec-7' }
    }) as Extract<WorkerHostRequest, { type: 'dispatch' }>
    const cancel = workerHostRequestSchema.parse({
      protocolVersion: 1,
      type: 'cancel',
      messageId: 'msg-102',
      executionRequestId: 'exec-7'
    }) as Extract<WorkerHostRequest, { type: 'cancel' }>
    expect(dispatch.messageId).toBe('msg-101')
    expect(cancel.messageId).toBe('msg-102')
    expect(dispatch.executionRequestId).toBe('exec-7')
    expect(cancel.executionRequestId).toBe('exec-7')
  })
})
