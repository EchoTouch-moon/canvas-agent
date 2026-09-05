import { describe, expect, it } from 'vitest'
import {
  C1_TREATMENT_ENTRY_AUDIT_ID,
  C1_C_TREATMENT_REVISION,
  runC1TreatmentEntryAudit
} from '../src'

describe('C1 formal treatment entry audit', () => {
  it('binds the formal Native/Runtime factory entry without provider execution', async () => {
    const report = await runC1TreatmentEntryAudit()

    expect(report.auditId).toBe(C1_TREATMENT_ENTRY_AUDIT_ID)
    expect(report.status).toBe('PASS')
    expect(report.providerCalls).toBe(0)
    expect(report.networkRequests).toBe(0)
    expect(report.providerExecution).toBe('NOT_AUTHORIZED')
    expect(report.binding.treatmentRevision).toBe(C1_C_TREATMENT_REVISION)
    expect(report.formalEntryPoint).toMatchObject({
      className: 'C1StudyOrchestrator',
      method: 'run',
      responseSourceFactory: 'INJECTED',
      observationSourceFactory: 'INJECTED',
      toolExecutorFactory: 'INJECTED'
    })
    expect(report.dryRunBoundary).toEqual({
      scriptedSourcesAreWrapperOnly: true,
      lifecycleInjectionIsNotFormalEntryBehavior: true
    })
    expect(report.gates.every((item) => item.verdict === 'PASS')).toBe(true)
  })
})
