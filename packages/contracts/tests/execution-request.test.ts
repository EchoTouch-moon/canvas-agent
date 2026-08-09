import { describe, expect, it } from 'vitest'
import {
  executionContextBundleV2Schema,
  executionContextItemV2Schema,
  executionRequestSchema,
  executionRequestV1Schema,
  executionRequestV2Schema,
  MAX_EXECUTION_CONTEXT_BYTES,
  MAX_EXECUTION_CONTEXT_ITEMS,
  type ExecutionContextItemV2,
  type ExecutionRequestContractV1,
  type ExecutionRequestContractV2
} from '../src'

function sha256(content: string): string {
  // The contract schemas only validate the 64-hex format; real hashing is done
  // by worker-runtime semantic validation. Use a deterministic 64-hex stand-in
  // so the contracts package stays free of node:crypto/Buffer types.
  return content.length.toString(16).padStart(64, '0')
}

function utf8Bytes(content: string): number {
  let bytes = 0
  for (const ch of content) {
    const code = ch.codePointAt(0) ?? 0
    bytes += code > 0xffff ? 4 : code > 0x7ff ? 3 : code > 0x7f ? 2 : 1
  }
  return bytes
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    const body = keys
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')
    return `{${body}}`
  }
  return JSON.stringify(value)
}

function computeRequestHash(request: unknown): string {
  return sha256(stableStringify(request))
}

const contentHashOf = (content: string): string => sha256(content)

function item(overrides: Partial<ExecutionContextItemV2> = {}): ExecutionContextItemV2 {
  return {
    position: 0,
    itemType: 'NODE_VERSION',
    sourceRef: 'repo://docs/goal.md',
    resolvedContent: '# Goal\n',
    contentHash: contentHashOf('# Goal\n'),
    authority: 'PROJECT_FACT',
    priority: 'P1',
    tokenEstimate: 10,
    ...overrides
  }
}

function taskInstruction(): ExecutionContextItemV2 {
  return item({
    itemType: 'USER_INPUT',
    sourceRef: 'task://spec_1',
    resolvedContent: 'Implement X',
    contentHash: contentHashOf('Implement X'),
    authority: 'TASK_INSTRUCTION',
    priority: 'P0'
  })
}

function bundle(items: ExecutionContextItemV2[]): {
  items: ExecutionContextItemV2[]
  canonicalItems: string
  totalBytes: number
  contentHash: string
} {
  const canonicalItems = stableStringify(items)
  return {
    items,
    canonicalItems,
    totalBytes: utf8Bytes(canonicalItems),
    contentHash: contentHashOf(canonicalItems)
  }
}

function v2Request(): ExecutionRequestContractV2 {
  const b = bundle([taskInstruction()])
  const base = {
    executionRequestId: 'req_v2_1',
    runId: 'run_1',
    workerAttemptNumber: 1,
    taskSpecVersionId: 'spec_1',
    contextSnapshotId: 'snap_1',
    expectedRepositoryRevision: {
      baseCommit: 'a'.repeat(40),
      treeHash: 'b'.repeat(40),
      workingTreePatchHash: null
    },
    checkpointId: null,
    requiredCapabilities: ['git', 'node'],
    agentConfiguration: { provider: 'codex-cli', model: 'configured-by-user' },
    toolPolicy: {
      allowedTools: ['write_file', 'run_command'],
      deniedPaths: [],
      allowNetwork: false,
      allowShell: true
    },
    workspaceStrategy: 'ISOLATED_WORKTREE' as const,
    resourceBudget: { maxDurationMs: 900_000, maxToolCalls: 100, maxDiskBytes: 1_000_000_000 },
    schemaVersion: 2 as const,
    contextBundle: { items: b.items, totalBytes: b.totalBytes, contentHash: b.contentHash },
    expiresAt: '2099-01-01T00:00:00.000Z'
  }
  return { ...base, requestHash: computeRequestHash(base) }
}

describe('ExecutionRequest v1/v2 (PROPOSAL-028A)', () => {
  it('parses a historical v1 request unchanged', () => {
    const v1Base = {
      executionRequestId: 'req_v1',
      runId: 'run_1',
      workerAttemptNumber: 1,
      taskSpecVersionId: 'spec_1',
      contextSnapshotId: 'snap_1',
      expectedRepositoryRevision: {
        baseCommit: 'a'.repeat(40),
        treeHash: 'b'.repeat(40),
        workingTreePatchHash: null
      },
      checkpointId: null,
      requiredCapabilities: ['git', 'node'],
      agentConfiguration: { provider: 'fixture', model: 'deterministic' },
      toolPolicy: {
        allowedTools: ['write_file'],
        deniedPaths: [],
        allowNetwork: false,
        allowShell: true
      },
      workspaceStrategy: 'ISOLATED_WORKTREE' as const,
      resourceBudget: { maxDurationMs: 30_000, maxToolCalls: 20, maxDiskBytes: 1_000_000_000 },
      schemaVersion: 1 as const,
      expiresAt: '2099-01-01T00:00:00.000Z'
    }
    const request: ExecutionRequestContractV1 = {
      ...v1Base,
      requestHash: computeRequestHash(v1Base)
    }
    const parsed = executionRequestSchema.parse(request)
    expect(parsed.schemaVersion).toBe(1)
    expect(executionRequestV1Schema.parse(request).schemaVersion).toBe(1)
  })

  it('round-trips a valid v2 request with a context bundle', () => {
    const request = v2Request()
    const parsed = executionRequestSchema.parse(request)
    expect(parsed.schemaVersion).toBe(2)
    if (parsed.schemaVersion === 2) {
      expect(parsed.contextBundle.items).toHaveLength(1)
      expect(parsed.contextBundle.totalBytes).toBe(request.contextBundle.totalBytes)
      expect(parsed.contextBundle.contentHash).toBe(request.contextBundle.contentHash)
    }
    expect(executionRequestV2Schema.parse(request).contextBundle.items[0]?.authority).toBe(
      'TASK_INSTRUCTION'
    )
  })

  it('rejects v1 with a bundle and v2 without a bundle', () => {
    const v2 = v2Request()
    const v1WithBundle = { ...v2, schemaVersion: 1 }
    expect(executionRequestSchema.safeParse(v1WithBundle as unknown).success).toBe(false)

    const v2WithoutBundle = { ...v2 }
    delete (v2WithoutBundle as { contextBundle?: unknown }).contextBundle
    v2WithoutBundle.schemaVersion = 2
    expect(executionRequestSchema.safeParse(v2WithoutBundle as unknown).success).toBe(false)
  })

  it('enforces the item and bundle shapes and limits', () => {
    expect(() =>
      executionContextItemV2Schema.parse(item({ position: -1 }))
    ).toThrow()
    expect(() =>
      executionContextItemV2Schema.parse(
        item({ authority: 'TASK_INSTRUCTION', priority: 'P9' as 'P0' })
      )
    ).toThrow()
    const many = Array.from({ length: MAX_EXECUTION_CONTEXT_ITEMS + 1 }, (_, i) =>
      item({ position: i, resolvedContent: `c${i}`, contentHash: contentHashOf(`c${i}`) })
    )
    expect(() =>
      executionContextBundleV2Schema.parse({
        items: many,
        totalBytes: 1,
        contentHash: '0'.repeat(64)
      })
    ).toThrow()
    expect(() =>
      executionContextBundleV2Schema.parse({
        items: [taskInstruction()],
        totalBytes: MAX_EXECUTION_CONTEXT_BYTES + 1,
        contentHash: '0'.repeat(64)
      })
    ).toThrow()
  })

  it('keeps the union discriminant on schemaVersion and exports the limits', () => {
    expect(MAX_EXECUTION_CONTEXT_ITEMS).toBe(256)
    expect(MAX_EXECUTION_CONTEXT_BYTES).toBe(4 * 1024 * 1024)
    const v1 = { ...v2Request(), schemaVersion: 1 }
    delete (v1 as { contextBundle?: unknown }).contextBundle
    const parsed = executionRequestSchema.safeParse(v1 as unknown)
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.schemaVersion).toBe(1)
  })
})
