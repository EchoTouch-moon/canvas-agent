import { z } from 'zod'

/**
 * Worker-owned final response contract for the Codex adapter. The JSON Schema
 * string is written by the adapter and passed to `codex exec --output-schema`;
 * the Zod mirror validates the parsed final `agent_message`. The frozen SHA-256
 * keeps the JSON Schema and the Zod parser from drifting apart. The bytes match
 * `docs/architecture/codex-argv-schema-fixture-review/fixtures/final-response.schema.json`.
 */
export const CODEX_FINAL_RESPONSE_SCHEMA_JSON = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://canvas-agent.local/schemas/codex-final-response-v1.json",
  "title": "Codex final response (Canvas Agent v1)",
  "type": "object",
  "additionalProperties": false,
  "required": ["summary", "changes", "tool_calls_observed", "tests_run", "success"],
  "properties": {
    "summary": { "type": "string", "minLength": 1 },
    "changes": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["file", "change_type", "description"],
        "properties": {
          "file": { "type": "string", "minLength": 1 },
          "change_type": { "enum": ["created", "modified", "deleted"] },
          "description": { "type": "string" }
        }
      }
    },
    "tool_calls_observed": { "type": "integer", "minimum": 0 },
    "tests_run": { "type": "array", "items": { "type": "string" } },
    "success": { "type": "boolean" }
  }
}
`

export const CODEX_FINAL_RESPONSE_SCHEMA_SHA256 =
  '86855a2c1c755597f340a13b2dd7279936023a65fddcf41b55d35676917b0050'

const codexChangeSchema = z
  .object({
    file: z.string().min(1),
    change_type: z.enum(['created', 'modified', 'deleted']),
    description: z.string()
  })
  .strict()

export const codexFinalResponseSchema = z
  .object({
    summary: z.string().min(1),
    changes: z.array(codexChangeSchema),
    tool_calls_observed: z.number().int().min(0),
    tests_run: z.array(z.string()),
    success: z.boolean()
  })
  .strict()

export type CodexFinalResponse = z.infer<typeof codexFinalResponseSchema>
