import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  InMemoryObservationSink,
  JsonlObservationSink,
  buildObservation,
  type NormalizedMessageInput
} from '../src'

const temporaryDirectories: string[] = []

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-context-runtime-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

function observation(sequence: number, messages: NormalizedMessageInput[]) {
  return buildObservation({
    runtimeSessionId: 'session-001',
    sequence,
    observedAt: `2026-08-11T00:00:0${sequence}.000Z`,
    harness: 'PI',
    messages
  })
}

describe('InMemoryObservationSink', () => {
  it('collects observations without touching the filesystem', () => {
    const sink = new InMemoryObservationSink()
    sink.write(observation(1, [{ role: 'user', category: 'USER', contentType: 'text', fingerprintText: 'a' }]))
    sink.write(observation(2, [{ role: 'user', category: 'USER', contentType: 'text', fingerprintText: 'b' }]))
    expect(sink.count).toBe(2)
    expect(sink.last()?.sequence).toBe(2)
    sink.clear()
    expect(sink.count).toBe(0)
  })
})

describe('JsonlObservationSink', () => {
  it('writes one metadata-only line per observation', async () => {
    const directory = await tempDirectory()
    const sink = new JsonlObservationSink({ directory, sessionId: 'session-001' })
    sink.write(
      observation(1, [
        { role: 'user', category: 'USER', contentType: 'text', fingerprintText: 'instructions' },
        { role: 'assistant', category: 'ASSISTANT', contentType: 'text', fingerprintText: 'reply' }
      ])
    )
    await sink.flush()
    const content = await readFile(join(directory, 'session-001.jsonl'), 'utf8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]!)
    expect(parsed.kind).toBe('model-call')
    expect(parsed.runtimeSessionId).toBe('session-001')
    expect(parsed.sequence).toBe(1)
    expect(parsed.harness).toBe('PI')
    expect(parsed.messageCount).toBe(2)
    expect(parsed.rawCapture).toBe(false)
  })

  it('default serialized observation contains no credentials and no raw text', async () => {
    const directory = await tempDirectory()
    const sink = new JsonlObservationSink({ directory, sessionId: 's2' })
    const secret = 'sk-supersecret-abcdef123456'
    sink.write(
      observation(1, [{ role: 'user', category: 'USER', contentType: 'text', fingerprintText: secret }])
    )
    await sink.flush()
    const content = await readFile(join(directory, 's2.jsonl'), 'utf8')
    expect(content).not.toContain(secret)
    const parsed = JSON.parse(content.trim())
    expect(parsed.messageDescriptors[0].rawPreview).toBeUndefined()
  })

  it('serialization is deterministic for identical input', async () => {
    const directory = await tempDirectory()
    const a = new JsonlObservationSink({ directory, sessionId: 'sa' })
    const b = new JsonlObservationSink({ directory, sessionId: 'sb' })
    const messages = [{ role: 'user', category: 'USER' as const, contentType: 'text', fingerprintText: 'same' }]
    a.write(observation(1, messages))
    b.write(observation(1, messages))
    await a.flush()
    await b.flush()
    const ca = await readFile(join(directory, 'sa.jsonl'), 'utf8')
    const cb = await readFile(join(directory, 'sb.jsonl'), 'utf8')
    const pa = JSON.parse(ca.trim())
    const pb = JSON.parse(cb.trim())
    expect(pa).toEqual(pb)
  })

  it('flush is idempotent and preserves line order', async () => {
    const directory = await tempDirectory()
    const sink = new JsonlObservationSink({ directory, sessionId: 's3' })
    sink.write(observation(1, [{ role: 'user', category: 'USER', contentType: 'text', fingerprintText: 'first' }]))
    sink.write(observation(2, [{ role: 'user', category: 'USER', contentType: 'text', fingerprintText: 'second' }]))
    await sink.flush()
    await sink.flush()
    const content = await readFile(join(directory, 's3.jsonl'), 'utf8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]!).sequence).toBe(1)
    expect(JSON.parse(lines[1]!).sequence).toBe(2)
  })

  it('keeps buffered observations on disk failure and retries them on the next flush', async () => {
    const directory = await tempDirectory()
    const sink = new JsonlObservationSink({ directory, sessionId: 's4' })
    sink.write(observation(1, [{ role: 'user', category: 'USER', contentType: 'text', fingerprintText: 'kept' }]))
    // Block the sink file with a directory so appendFile fails.
    await mkdir(join(directory, 's4.jsonl'))
    await expect(sink.flush()).rejects.toThrow()
    await rm(join(directory, 's4.jsonl'), { recursive: true, force: true })
    await sink.flush()
    const content = await readFile(join(directory, 's4.jsonl'), 'utf8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0]!).sequence).toBe(1)
  })

  it('concurrent flush calls do not duplicate buffered lines', async () => {
    const directory = await tempDirectory()
    const sink = new JsonlObservationSink({ directory, sessionId: 's5' })
    sink.write(observation(1, [{ role: 'user', category: 'USER', contentType: 'text', fingerprintText: 'a' }]))
    sink.write(observation(2, [{ role: 'user', category: 'USER', contentType: 'text', fingerprintText: 'b' }]))
    await Promise.all([sink.flush(), sink.flush()])
    const content = await readFile(join(directory, 's5.jsonl'), 'utf8')
    expect(content.trim().split('\n')).toHaveLength(2)
  })

  it('closeAndFlush drains the buffer before sealing the sink', async () => {
    const directory = await tempDirectory()
    const sink = new JsonlObservationSink({ directory, sessionId: 's6' })
    sink.write(observation(1, [{ role: 'user', category: 'USER', contentType: 'text', fingerprintText: 'sealed' }]))
    await sink.closeAndFlush()
    const content = await readFile(join(directory, 's6.jsonl'), 'utf8')
    expect(content.trim().split('\n')).toHaveLength(1)
    expect(() =>
      sink.write(observation(2, [{ role: 'user', category: 'USER', contentType: 'text', fingerprintText: 'late' }]))
    ).toThrow('JsonlObservationSink is closed')
  })
})
