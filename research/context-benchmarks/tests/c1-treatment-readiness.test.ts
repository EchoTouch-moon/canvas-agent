import { describe, expect, it } from 'vitest'
import {
  C1_C_FAILURE_INJECTIONS,
  C1_C_REQUIRED_GATES,
  C1_C_READINESS_ID,
  runC1TreatmentFailureProbes,
  runC1TreatmentReadiness,
  type C1ReadinessGate,
  type C1TreatmentReadinessReport
} from '../src'

function gateOf(report: C1TreatmentReadinessReport, gateId: string): C1ReadinessGate {
  if (!C1_C_REQUIRED_GATES.includes(gateId as (typeof C1_C_REQUIRED_GATES)[number])) {
    throw new Error(`unknown readiness gate ${gateId}`)
  }
  return report[gateId as (typeof C1_C_REQUIRED_GATES)[number]]
}

describe('C1-C credential-free treatment readiness', () => {
  it('passes every hard gate without provider usage', () => {
    const report = runC1TreatmentReadiness()

    expect(report.readinessId).toBe(C1_C_READINESS_ID)
    expect(report.overallVerdict).toBe('PASS')
    expect(report.status).toBe('PASS')
    expect(report.providerCalls).toBe(0)
    expect(report.usage).toEqual({
      status: 'NOT_OBSERVED_IN_READINESS',
      providerCalls: 0,
      providerReportedTokens: 'NOT_APPLICABLE',
      cost: 'NOT_APPLICABLE'
    })
    expect(report.requiredGates).toEqual([...C1_C_REQUIRED_GATES])
    expect(C1_C_REQUIRED_GATES.every((gateId) => report[gateId].verdict === 'PASS')).toBe(true)
  })

  it('proves the Native/Runtime treatment and evidence joins', () => {
    const report = runC1TreatmentReadiness()

    expect(gateOf(report, 'nativeFidelity').checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: 'native_observer_request_fingerprint_unchanged',
          verdict: 'PASS'
        })
      ])
    )
    expect(gateOf(report, 'runtimeTreatmentActive').checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          checkId: 'runtime_semantic_fingerprint_differs_from_native',
          verdict: 'PASS'
        }),
        expect.objectContaining({
          checkId: 'provider_bound_sources_match_materialized_working_set',
          verdict: 'PASS'
        })
      ])
    )
    expect(gateOf(report, 'structuralPreservation').verdict).toBe('PASS')
    expect(gateOf(report, 'evidenceJoin').verdict).toBe('PASS')
  })

  it('requires all five injected Runtime failures to terminate before fallback or capture', () => {
    const probes = runC1TreatmentFailureProbes()

    expect(probes.map((probe) => probe.injection)).toEqual([...C1_C_FAILURE_INJECTIONS])
    for (const probe of probes) {
      expect(probe.status).toBe('TERMINAL_FAILURE')
      expect(probe.fallbackSent).toBe(false)
      expect(probe.capturedProviderBoundRequests).toBe(0)
      expect(probe.killSwitchTripped).toBe(true)
    }
  })

  it('keeps the deterministic T4 REMOVE-to-REHYDRATE chain admissible', () => {
    const report = runC1TreatmentReadiness()
    const t4 = gateOf(report, 't4LifecycleChain')

    expect(t4.verdict).toBe('PASS')
    const exactVersion = t4.checks.find(
      (check) => check.checkId === 't4_remove_rehydrate_exact_source_version'
    )
    expect(exactVersion).toMatchObject({
      checkId: 't4_remove_rehydrate_exact_source_version',
      verdict: 'PASS'
    })
    expect(exactVersion?.observed).toContain('REMOVE=repository/file://src/parser/evaluate.js')
    expect(exactVersion?.observed).toContain('REHYDRATE=REHYDRATE')
    expect(exactVersion?.observed).toContain('exact_version=true')

    const coldProviderBound = t4.checks.find(
      (check) => check.checkId === 't4_cold_provider_bound_excludes_evaluate'
    )
    expect(coldProviderBound).toMatchObject({
      checkId: 't4_cold_provider_bound_excludes_evaluate',
      verdict: 'PASS'
    })
    expect(coldProviderBound?.observed).toContain('evaluate_present=false')

    const restoredProviderBound = t4.checks.find(
      (check) => check.checkId === 't4_rehydrated_provider_bound_restores_evaluate'
    )
    expect(restoredProviderBound).toMatchObject({
      checkId: 't4_rehydrated_provider_bound_restores_evaluate',
      verdict: 'PASS'
    })
    expect(restoredProviderBound?.observed).toContain('evaluate_present=true')
  })

  it('is replay-stable for the readiness artifact', () => {
    expect(runC1TreatmentReadiness()).toEqual(runC1TreatmentReadiness())
  })
})
