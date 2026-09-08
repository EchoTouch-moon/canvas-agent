import type {
  C1LiveBindingCheckpoint,
  C1LiveBindingResponseReceipt,
  C1LiveToolExecution
} from './c1-live-binding'

/** Derived metadata view. Never counts permits as responses or fills missing usage. */
export function deriveC1CallAccounting(
  checkpoints: readonly C1LiveBindingCheckpoint[],
  completedRunIds: ReadonlySet<string>,
  checkpointWriteFailed: boolean
) {
  const calls = new Map<
    string,
    {
      runId: string
      callOrdinal: number
      permit: Extract<C1LiveBindingCheckpoint, { phase: 'OUTBOUND_PERMITTED' }>['capture']
      receipt: C1LiveBindingResponseReceipt | null
      tools: C1LiveToolExecution[]
      responseRecorded: boolean
    }
  >()
  const key = (runId: string, ordinal: number): string => JSON.stringify([runId, ordinal])
  for (const [index, checkpoint] of checkpoints.entries()) {
    if (checkpoint.checkpointOrdinal !== index + 1)
      throw new Error('C1 accounting checkpoint sequence gap')
    if (checkpoint.phase === 'OUTBOUND_PERMITTED') {
      if (calls.has(key(checkpoint.capture.runId, checkpoint.callOrdinal)))
        throw new Error('duplicate C1 accounting permit')
      calls.set(key(checkpoint.capture.runId, checkpoint.callOrdinal), {
        runId: checkpoint.capture.runId,
        callOrdinal: checkpoint.callOrdinal,
        permit: checkpoint.capture,
        receipt: null,
        tools: [],
        responseRecorded: false
      })
      continue
    }
    const runId =
      checkpoint.phase === 'RESPONSE_RECEIVED'
        ? checkpoint.receipt.runId
        : checkpoint.phase === 'RESPONSE_RECORDED'
          ? checkpoint.evidence.runId
          : checkpoint.runId
    const call = calls.get(key(runId, checkpoint.callOrdinal))
    if (call === undefined) throw new Error('C1 accounting event has no outbound permit')
    if (checkpoint.phase === 'RESPONSE_RECEIVED') {
      if (
        call.receipt !== null ||
        checkpoint.receipt.callOrdinal !== call.callOrdinal ||
        checkpoint.receipt.studyId !== call.permit.studyId ||
        checkpoint.receipt.modelCallId !== call.permit.modelCallId
      ) {
        throw new Error('duplicate or mismatched C1 response receipt')
      }
      call.receipt = checkpoint.receipt
    }
    if (checkpoint.phase === 'TOOL_EXECUTION_RECORDED') {
      const request = call.receipt?.toolRequestEvidence.find(
        (item) => item.toolCallId === checkpoint.execution.toolCallId
      )
      if (
        !request ||
        request.toolName !== checkpoint.execution.toolName ||
        call.responseRecorded ||
        call.tools.some((tool) => tool.toolCallId === checkpoint.execution.toolCallId)
      )
        throw new Error('invalid C1 accounting tool event')
      call.tools.push(checkpoint.execution)
    }
    if (checkpoint.phase === 'RESPONSE_RECORDED') {
      if (
        call.receipt === null ||
        call.responseRecorded ||
        JSON.stringify(call.tools) !== JSON.stringify(checkpoint.evidence.toolEvents)
      ) {
        throw new Error(
          'missing receipt or inconsistent C1 final response; legacy checkpoints require offline reconciliation'
        )
      }
      call.responseRecorded = true
    }
  }
  const rows = [...calls.values()].map((call) => ({
    studyId: call.permit.studyId,
    taskId: call.permit.taskId,
    stratum: call.permit.stratum,
    pairId: call.permit.pairId,
    arm: call.permit.arm,
    runId: call.runId,
    callOrdinal: call.callOrdinal,
    turnId: call.permit.turnId,
    modelCallId: call.permit.modelCallId,
    legStatus: completedRunIds.has(call.runId) ? ('COMPLETED' as const) : ('INCOMPLETE' as const),
    finalOracle: completedRunIds.has(call.runId) ? 'SEE_LEG_MANIFEST' : 'UNOBSERVED',
    responseStatus: call.receipt === null ? 'NOT_RECORDED' : 'NORMALIZED_RESPONSE_RECEIVED',
    // Receipt excludes raw messages/arguments. Its usage preserves tagged cache availability.
    receipt: call.receipt,
    toolEvents: call.tools,
    toolExecutionsNotRecorded:
      call.receipt === null ? null : call.receipt.toolCalls - call.tools.length,
    responseRecorded: call.responseRecorded
  }))
  function totals(subset: typeof rows) {
    const received = subset.flatMap((row) => (row.receipt === null ? [] : [row.receipt]))
    return {
      outboundPermits: subset.length,
      normalizedResponses: received.length,
      permitsWithoutRecordedResponse: subset.length - received.length,
      responseRecorded: subset.filter((row) => row.responseRecorded).length,
      toolRequests: received.reduce((sum, row) => sum + row.toolCalls, 0),
      recordedToolExecutions: subset.reduce((sum, row) => sum + row.toolEvents.length, 0),
      // This is recorded-response usage, not total provider billing when receipt is missing.
      recordedResponseUsage: {
        inputTokens: received.reduce((sum, row) => sum + row.usage.inputTokens, 0),
        outputTokens: received.reduce((sum, row) => sum + row.usage.outputTokens, 0),
        totalTokens: received.reduce((sum, row) => sum + row.usage.totalTokens, 0)
      }
    }
  }
  return {
    schemaVersion: 1,
    scope: 'ALL_ACKNOWLEDGED_CHECKPOINTS' as const,
    checkpointWriteFailed,
    completeness: checkpointWriteFailed
      ? 'UNKNOWN_AFTER_WRITE_FAILURE'
      : 'ACKNOWLEDGED_EVENTS_ONLY',
    legacyManifestCountersScope: 'COMPLETED_LEGS_ONLY',
    allRecorded: totals(rows),
    completedLegsOnly: totals(rows.filter((row) => row.legStatus === 'COMPLETED')),
    incompleteLegsOnly: totals(rows.filter((row) => row.legStatus === 'INCOMPLETE')),
    calls: rows
  }
}
