import { describe, expect, it } from 'vitest'
import {
  MAX_EXECUTION_CONTEXT_BYTES,
  MAX_EXECUTION_CONTEXT_ITEMS,
  type ExecutionContextItemV2,
  type ExecutionRequestContractV2
} from '@canvas-agent/contracts'
import {
  assertValidExecutionContextBundle,
  computeExecutionContextBundle,
  computeRequestHash,
  validateExecutionRequest,
  RequestValidationError,
  type ComputedExecutionContextBundle
} from '../src'
import { buildRequest } from './helpers'

function sha256(content: string): string {
  return require('node:crypto').createHash('sha256').update(content, 'utf8').digest('hex')
}

function item(overrides: Partial<ExecutionContextItemV2> = {}): ExecutionContextItemV2 {
  return {
    position: 0,
    itemType: 'NODE_VERSION',
    sourceRef: 'repo://docs/goal.md',
    resolvedContent: '# Goal\n',
    contentHash: sha256('# Goal\n'),
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
    contentHash: sha256('Implement X'),
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
  const canonicalItems = computeExecutionContextBundle(items).canonicalItems
  const computed = computeExecutionContextBundle(items)
  return { items, canonicalItems, totalBytes: computed.totalBytes, contentHash: computed.contentHash }
}

function v2RequestWith(b: {
  items: ExecutionContextItemV2[]
  totalBytes: number
  contentHash: string
}): ExecutionRequestContractV2 {
  const base = {
    ...buildRequest(),
    schemaVersion: 2 as const,
    contextBundle: { items: b.items, totalBytes: b.totalBytes, contentHash: b.contentHash }
  }
  const { requestHash, ...rest } = base
  void requestHash
  const recomputed = computeRequestHash(rest)
  return { ...rest, requestHash: recomputed }
}

describe('ExecutionContextBundle validation (Worker + Main shared)', () => {
  it('accepts a valid v2 bundle and validates the outer request hash', () => {
    const b = bundle([taskInstruction()])
    const request = v2RequestWith(b)
    const parsed = validateExecutionRequest(request, { capabilities: ['git', 'node'] })
    expect(parsed.schemaVersion).toBe(2)
    if (parsed.schemaVersion === 2) {
      expect(parsed.contextBundle.contentHash).toBe(b.contentHash)
    }
  })

  it('rejects content tampering with a stale item hash', () => {
    const b = bundle([taskInstruction(), item({ position: 1, resolvedContent: 'ORIGINAL' })])
    b.items[1] = {
      ...b.items[1]!,
      resolvedContent: 'TAMPERED',
      contentHash: sha256('ORIGINAL')
    }
    expect(() => assertValidExecutionContextBundle(b as never)).toThrow(RequestValidationError)
  })

  it('rejects bundle totalBytes and contentHash tampering', () => {
    const b = bundle([taskInstruction()])
    expect(() =>
      assertValidExecutionContextBundle({ ...b, totalBytes: b.totalBytes + 1 } as never)
    ).toThrow(RequestValidationError)
    expect(() =>
      assertValidExecutionContextBundle({
        ...b,
        contentHash: '0'.repeat(64)
      } as never)
    ).toThrow(RequestValidationError)
  })

  it('rejects a missing P0 TASK_INSTRUCTION', () => {
    const b = bundle([item(), item({ position: 1, resolvedContent: 'c', contentHash: sha256('c') })])
    expect(() => assertValidExecutionContextBundle(b as never)).toThrow(
      /missing P0 task instruction/
    )
  })

  it('rejects non-contiguous positions', () => {
    const b = bundle([
      taskInstruction(),
      item({ position: 2, resolvedContent: 'skip1', contentHash: sha256('skip1') })
    ])
    expect(() => assertValidExecutionContextBundle(b as never)).toThrow(
      /positions must be contiguous/
    )
  })

  it('rejects a canonical bundle exceeding the byte cap', () => {
    const bigContent = 'x'.repeat(MAX_EXECUTION_CONTEXT_BYTES + 1000)
    const b = bundle([
      taskInstruction(),
      item({
        position: 1,
        resolvedContent: bigContent,
        contentHash: sha256(bigContent),
        tokenEstimate: 1
      })
    ])
    expect(() => assertValidExecutionContextBundle(b as never)).toThrow(
      /exceeds byte limit/
    )
  })

  it('rejects more than MAX_EXECUTION_CONTEXT_ITEMS items', () => {
    const items = Array.from({ length: MAX_EXECUTION_CONTEXT_ITEMS + 1 }, (_, i) => {
      const content = `c${i}`
      return i === 0
        ? taskInstruction()
        : item({ position: i, resolvedContent: content, contentHash: sha256(content) })
    })
    const b = bundle(items)
    expect(() => assertValidExecutionContextBundle(b as never)).toThrow(
      /item count out of range/
    )
  })

  it('rejects an empty item list', () => {
    expect(() => assertValidExecutionContextBundle({ items: [], totalBytes: 0, contentHash: '' } as never)).toThrow(
      /item count out of range/
    )
  })

  it('computes the same canonical hash regardless of object key insertion order', () => {
    const left = item()
    const right = {
      tokenEstimate: left.tokenEstimate,
      position: left.position,
      sourceRef: left.sourceRef,
      authority: left.authority,
      priority: left.priority,
      contentHash: left.contentHash,
      resolvedContent: left.resolvedContent,
      itemType: left.itemType
    }
    const a: ComputedExecutionContextBundle = computeExecutionContextBundle([left])
    const b: ComputedExecutionContextBundle = computeExecutionContextBundle([right as never])
    expect(a.canonicalItems).toBe(b.canonicalItems)
    expect(a.contentHash).toBe(b.contentHash)
  })

  it('changes the bundle hash when items are reordered', () => {
    const first = taskInstruction()
    const second = item({ position: 1, resolvedContent: 'c', contentHash: sha256('c') })
    const ordered = computeExecutionContextBundle([first, second])
    const reordered = computeExecutionContextBundle([second, first])
    expect(ordered.contentHash).not.toBe(reordered.contentHash)
  })

  it('rejects a v2 request whose outer hash does not cover the bundle', () => {
    const b = bundle([taskInstruction()])
    const request = v2RequestWith(b)
    const tampered: ExecutionRequestContractV2 = {
      ...request,
      contextBundle: { ...request.contextBundle, items: [] }
    }
    expect(() =>
      validateExecutionRequest(tampered, { capabilities: ['git', 'node'] })
    ).toThrow(RequestValidationError)
  })

  it('still validates historical v1 requests without a bundle', () => {
    const v1 = buildRequest()
    const parsed = validateExecutionRequest(v1, { capabilities: ['git', 'node'] })
    expect(parsed.schemaVersion).toBe(1)
  })
})
