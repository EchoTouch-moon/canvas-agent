# Model Provider Layer

Status: bounded experiment infrastructure, not a general routing platform.

The provider layer gives Pi-based experiments one model configuration seam for
OpenAI-compatible endpoints. A provider is described by an endpoint URL, a
model id/name, and the environment variable that contains its credential. The
credential is resolved into memory only; it is never part of a safe selection
record or durable research evidence.

## Built-in profiles

| Provider    | Endpoint                               | Model               | Credential environment variable |
| ----------- | -------------------------------------- | ------------------- | ------------------------------- |
| `step-plan` | `https://api.stepfun.com/step_plan/v1` | `step-3.7-flash`    | `STEP_PLAN_API_KEY`             |
| `deepseek`  | `https://api.deepseek.com`             | `deepseek-v4-flash` | `DEEPSEEK_API_KEY`              |

Step Plan is the new primary for the provider-layer entry points. DeepSeek is
the default pre-call fallback when Step Plan credentials are unavailable or a
local provider catalog rejects the selected model. The Step model endpoint and
account entitlement must still be verified before a live experiment; local
provider registration alone does not prove remote model availability.

## Selection and fallback contract

Selection happens before the first model call:

```text
Step Plan configured and available
  -> select Step Plan

Step Plan credentials unavailable before session start
  -> select DeepSeek

Local model registration rejects Step Plan
  -> select DeepSeek

Provider failure after the first model call
  -> abort the run; never switch providers mid-run
```

Mid-run switching is deliberately excluded. A Native/Shadow record must have
one selected provider so a run cannot silently mix model behavior, latency, or
cost attribution. The selected provider and model may be recorded through
`safeProviderSelection`; the API key must not be recorded.

## Environment configuration

The default selection uses `step-plan` as primary and `deepseek` as fallback.
The following variables can override that choice:

```sh
CANVAS_MODEL_PROVIDER=step-plan
CANVAS_MODEL_FALLBACK_PROVIDER=deepseek
STEP_PLAN_API_KEY=...
DEEPSEEK_API_KEY=...
```

An explicit OpenAI-compatible provider can be supplied without adding code:

```sh
CANVAS_MODEL_PROVIDER=research-gateway
CANVAS_MODEL_BASE_URL=https://gateway.example.test/v1
CANVAS_MODEL_ID=research-model-v1
CANVAS_MODEL_NAME=Research\ Model
CANVAS_MODEL_API_KEY_ENV=RESEARCH_GATEWAY_API_KEY
RESEARCH_GATEWAY_API_KEY=...
```

Remote endpoints must use HTTPS. HTTP is accepted only for local loopback
development endpoints. Credentials must be named through an environment
variable; putting a literal key in provider metadata or a URL is rejected.

## Scope boundary

This layer does not change the frozen CR-005 manifests, Wave A identity gate,
historical DeepSeek records, or existing `smoke:deepseek` commands. The new
`smoke:model-provider` entry point is opt-in and still requires
`CANVAS_CONTEXT_LIVE_SMOKE=1`.

It also does not implement request retry routing, cost optimization, provider
ranking, or a UI registry. Those remain future multi-provider routing work and
require separate measured evidence. A live Step Plan experiment requires a
separate authorization and a new run identity.
