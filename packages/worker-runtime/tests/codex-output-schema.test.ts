import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  CODEX_FINAL_RESPONSE_SCHEMA_JSON,
  CODEX_FINAL_RESPONSE_SCHEMA_SHA256,
  codexFinalResponseSchema
} from '../src'

describe('codex final response schema (worker-owned)', () => {
  it('matches the approved fixture schema SHA-256', () => {
    const hash = createHash('sha256').update(CODEX_FINAL_RESPONSE_SCHEMA_JSON).digest('hex')
    expect(hash).toBe(CODEX_FINAL_RESPONSE_SCHEMA_SHA256)
    expect(CODEX_FINAL_RESPONSE_SCHEMA_SHA256).toMatch(/^86855a2c1c755597f340a13b2dd7279936023a65fddcf41b55d35676917b0050$/)
  })

  it('is valid JSON matching the approved final-response.schema.json', () => {
    const json = JSON.parse(CODEX_FINAL_RESPONSE_SCHEMA_JSON)
    expect(json.type).toBe('object')
    expect(json.required).toEqual(['summary', 'changes', 'tool_calls_observed', 'tests_run', 'success'])
  })

  it('Zod parses a schema-conforming final message', () => {
    const message = {
      summary: 'added feature',
      changes: [{ file: 'a.txt', change_type: 'created', description: 'add' }],
      tool_calls_observed: 1,
      tests_run: ['make test'],
      success: true
    }
    const parsed = codexFinalResponseSchema.safeParse(message)
    expect(parsed.success).toBe(true)
  })

  it('Zod rejects a non-conforming final message', () => {
    expect(codexFinalResponseSchema.safeParse({ summary: 'only' }).success).toBe(false)
    expect(
      codexFinalResponseSchema.safeParse({
        summary: 'x',
        changes: [{ file: 'a', change_type: 'bogus', description: 'x' }],
        tool_calls_observed: 0,
        tests_run: [],
        success: true
      }).success
    ).toBe(false)
  })
})
