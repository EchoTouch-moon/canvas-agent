# PROPOSAL-028C — Agent readiness command contract addendum

- **Status:** APPROVED — exact public shape frozen for DS-005/DS-006
- **Decision owner:** Lead architect
- **Date:** 2026-08-09
- **Parent:** `PROPOSAL-028B-local-agent-runtime-discovery.md`

## Schemas

Add to `packages/contracts/src/command.ts`:

```ts
const agentRuntimeStateSchema = z.enum([
  'READY',
  'NOT_FOUND',
  'UNSUPPORTED_VERSION',
  'AUTH_REQUIRED',
  'INTERPRETER_MISSING',
  'ERROR'
])

const agentRuntimeSourceSchema = z.enum(['USER_SELECTED', 'PATH', 'KNOWN_LOCATION'])

const agentRuntimeReasonSchema = z.enum([
  'EXECUTABLE_NOT_FOUND',
  'EXECUTABLE_NOT_READABLE',
  'EXECUTABLE_NOT_SUPPORTED',
  'INTERPRETER_MISSING',
  'AUTH_REQUIRED',
  'PROBE_TIMED_OUT',
  'ACTIVE_RUN_BLOCKS_CHANGE',
  'SETTINGS_INVALID',
  'UNKNOWN'
])

const agentRuntimeErrorSchema = z
  .object({
    reasonCode: agentRuntimeReasonSchema,
    recoverable: z.boolean()
  })
  .strict()

const agentRuntimeStatusSchema = z
  .object({
    provider: z.literal('codex-cli'),
    state: agentRuntimeStateSchema,
    version: z.string().min(1).nullable(),
    source: agentRuntimeSourceSchema.nullable(),
    displayPath: z.string().min(1).nullable(),
    lastError: agentRuntimeErrorSchema.nullable()
  })
  .strict()

const agentChooseExecutableResultSchema = z
  .object({
    cancelled: z.boolean(),
    status: agentRuntimeStatusSchema
  })
  .strict()
```

Export the inferred status enums/types needed by Renderer.

## CommandMap additions

```ts
'agent.status': { request: {}; response: AgentRuntimeStatus }
'agent.chooseExecutable': {
  request: {}
  response: { cancelled: boolean; status: AgentRuntimeStatus }
}
'agent.clearExecutable': { request: {}; response: AgentRuntimeStatus }
```

Every input is the strict empty-object schema. Provider is fixed to Codex for v0.2; no provider, path, argv, environment or credentials are accepted from Renderer.

## Semantic constraints

- READY requires non-null version/source/displayPath. It normally has null `lastError`, but may retain a recoverable candidate-selection/change error while the previous working launcher remains active.
- Any non-READY state requires a `lastError.reasonCode` appropriate to the state; diagnostic prose remains Main-internal or uses the existing sanitized command error detail channel.
- NOT_FOUND has null version/source/displayPath.
- Picker cancellation preserves the previous status and returns `cancelled: true`.
- A failed selected candidate does not overwrite a previously working saved launcher; the result remains READY on the previous launcher and reports the candidate failure in `lastError`.
- `agent.clearExecutable` clears only the saved user choice, then reruns safe auto-discovery; it may therefore return READY from PATH/KNOWN_LOCATION.
- While a Run is active, choose/clear preserves the current READY status, sets `lastError.reasonCode = ACTIVE_RUN_BLOCKS_CHANGE`, and leaves the launch plan unchanged.
- A displayPath returned to Renderer is informational only.

## Required contract tests

- strict empty inputs reject all extra/path/provider keys;
- status invariants above;
- picker cancellation shape;
- READY and each failure round trip;
- response map and correlation for all commands;
- no Preload API surface addition.
