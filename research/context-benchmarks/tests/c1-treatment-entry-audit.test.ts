import { describe, expect, it } from 'vitest'
import {
  C1_TREATMENT_ENTRY_AUDIT_ID,
  C1_C_TREATMENT_REVISION,
  nodeVersionSatisfiesC1Range,
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
    expect(report.binding.formalEntrySourceSha256).toMatch(/^[a-f0-9]{64}$/)
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
    expect(report.behaviorProbe.providerCalls).toBe(0)
    expect(report.behaviorProbe.networkRequests).toBe(0)
    if (nodeVersionSatisfiesC1Range()) {
      expect(report.behaviorProbe).toMatchObject({
        status: 'PASS',
        driverInstances: 1,
        legsAttempted: 2,
        legsCompleted: 2,
        structuralFingerprintEqual: true,
        providerConfigHashEqual: true,
        providerBoundContextChanged: true,
        fallbackSent: false,
        networkSent: false
      })
      expect(report.behaviorProbe.nativeProviderBoundSourceKeys).not.toEqual(
        report.behaviorProbe.runtimeProviderBoundSourceKeys
      )
    } else {
      expect(report.behaviorProbe.status).toBe('NOT_RUN_NODE_RANGE')
    }
    expect(report.gates.every((item) => item.verdict === 'PASS')).toBe(true)
  })
})
