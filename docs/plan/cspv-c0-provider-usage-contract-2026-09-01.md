# CSPV-C0 Provider Usage Contract Amendment — C0-L1

## 1. Decision boundary

| Field                          | Value                                                                       |
| ------------------------------ | --------------------------------------------------------------------------- |
| Status                         | `DRAFT — PENDING LEAD REVIEW`                                               |
| Amendment                      | `C0_USAGE_CONTRACT_V1`                                                      |
| Purpose                        | Make provider usage evidence sufficient for an observability-only C0-L1 run |
| Grants                         | `NOTHING`. This amendment grants no provider execution and no live run      |
| Provider calls during drafting | `0`                                                                         |
| Applies to                     | Step Plan `step-3.7-flash` through the C0 runner only                       |
| Does not enable                | Wave A, Wave B, CR-004, Active Rewrite, or any fallback provider            |

This amendment is the minimum change required to move the C0 token/cost item
from an unresolved combined budget into two separately typed evidence fields.
It does not claim that Step Plan is free, cheap, more efficient, or better than
Native. A future cost study may add a separately reviewed monetary contract.

## 2. Provider usage evidence

For every terminal assistant `message_end` observed by the C0 live runner, the
runner records a metadata-only usage row:

```text
runId
scenarioId
turnLabel
assistantMessageSequence
inputTokens
outputTokens
cacheReadTokens
cacheWriteTokens
totalTokens
usageSource
reportedCost
costCurrency
costSource
```

`usageSource` is one of:

```text
PROVIDER_REPORTED
UNAVAILABLE
```

`PROVIDER_REPORTED` is used only when the assistant message contains finite,
non-negative provider usage fields and a positive token signal. The runner
preserves those numeric fields as received by the Pi runtime. It does not
recalculate them from local text or context estimators.

When usage is absent, malformed, or contains no usable token signal, the row
is still written with `usageSource=UNAVAILABLE` and nullable token fields. No
local estimate is promoted into provider usage.

Only metadata is persisted. Prompts, assistant text, tool arguments, tool
results, raw provider payloads, credentials, response IDs, and authorization
headers are never written to the usage artifact.

## 3. Monetary cost is independent

`reportedCost` and `costCurrency` are nullable. `costSource` is one of:

```text
PROVIDER_REPORTED
UNAVAILABLE
```

The current Step Plan model registration supplies zero pricing to the Pi
runtime. That configured value is not provider-reported monetary cost and MUST
be recorded as `UNAVAILABLE`, not as `$0`.

Therefore:

- monetary cost is optional evidence for C0-L1;
- cost unavailability does not stop an otherwise usage-observable run;
- C0-L1 reports no monetary savings or price comparison;
- provider-call and wall-clock limits remain hard operational bounds;
- any future monetary ceiling requires a separate contract amendment or a
  reviewed provider-reported cost ledger.

## 4. Missing usage and L1 adjudication

The runner must fail closed for interpretation, not invent data:

```text
all assistant responses have PROVIDER_REPORTED usage
  → usage evidence status = COMPLETE

one or more assistant responses have UNAVAILABLE usage
  → usage evidence status = INCOMPLETE
  → the run may be preserved for diagnosis, but it cannot pass C0-L1
```

`INCOMPLETE` is not a task failure and is not a cost result. It is an
observability result indicating that the provider/runtime usage seam did not
provide enough evidence. The run identity remains single-use and all evidence
is preserved.

## 5. C0-L1 success boundary

C0-L1 is successful only when the run can join, for each observed assistant
response:

```text
decision / transition
  → scenario and turn identity
  → provider usage row
  → tool/model behavior and latency
  → scenario outcome
```

This is an observability claim only. It does not establish:

- policy effectiveness;
- fewer tokens than Native;
- better tool selection;
- higher task success;
- causal impact from Shadow context selection;
- any monetary saving.

## 6. Implementation and verification requirements

The implementation must:

1. subscribe to the existing Pi `AgentSession` event stream at the
   `message_end` seam;
2. include only terminal assistant messages in the provider usage ledger;
3. write usage rows independently from transitions, decisions, binding, and
   manifest finalization;
4. record aggregate usage status and totals in the manifest without recording
   message content;
5. keep the existing provider-call, wall-clock, single-use identity, and
   kill-switch gates unchanged;
6. exercise `PROVIDER_REPORTED`, `UNAVAILABLE`, malformed usage, cost
   unavailable, and no-secret persistence paths with zero Provider calls.

The implementation is not live authorization. A separate Lead decision must
accept this amendment and authorize a new C0-L1 identity before any Step Plan
request is sent.
