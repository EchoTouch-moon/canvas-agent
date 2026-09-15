import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  adjudicateConstructRepairV1,
  assertHistoricalNonInterference,
  loadConstructRepairSyntheticCorpus,
  type ConstructRepairAdjudication
} from '../src/feasibility-construct-repair/adjudicate.ts'

describe('C1_FEASIBILITY_CONSTRUCT_REPAIR_V1 synthetic validation', () => {
  const corpus = loadConstructRepairSyntheticCorpus()

  it('loads zero-provider corpus without historical run IDs', () => {
    expect(corpus.corpusId).toBe('C1_FEASIBILITY_CONSTRUCT_REPAIR_V1_SYNTHETIC_CORPUS')
    const blob = JSON.stringify(corpus)
    expect(blob).not.toMatch(/c1-f1-32-20260915-run-/)
    expect(blob).not.toMatch(/11df369c/)
    expect(blob).not.toMatch(/VALID_INFEASIBLE/)
  })

  it('deterministically adjudicates every corpus case to its expected label', () => {
    for (const testCase of corpus.cases) {
      const first = adjudicateConstructRepairV1(testCase.fixture)
      const second = adjudicateConstructRepairV1(testCase.fixture)
      expect(first).toEqual(second)
      expect(first.label).toBe(testCase.expectedLabel)
      if (testCase.expectedLayers) {
        expect(first.semanticFeasibility).toBe(testCase.expectedLayers.semanticFeasibility)
        expect(first.trajectoryRecoveryOutcome).toBe(
          testCase.expectedLayers.trajectoryRecoveryOutcome
        )
        expect(first.linkageCompleteness).toBe(testCase.expectedLayers.linkageCompleteness)
        expect(first.overallExecutionFeasibility).toBe(
          testCase.expectedLayers.overallExecutionFeasibility
        )
        expect(first.observabilityQuality).toBe(testCase.expectedLayers.observabilityQuality)
      }
    }
  })

  it('separates the four primary quadrants into distinct labels', () => {
    const byQuadrant = new Map<string, string>()
    for (const testCase of corpus.cases) {
      if (!['A', 'B', 'C', 'D'].includes(testCase.quadrant as string)) continue
      const result = adjudicateConstructRepairV1(testCase.fixture)
      byQuadrant.set(testCase.quadrant as string, result.label)
    }
    expect(byQuadrant.get('A')).toBe('FEASIBLE')
    expect(byQuadrant.get('B')).toBe('FEASIBLE_PLUS_OBSERVABILITY_DEFECT')
    expect(byQuadrant.get('C')).toBe('INFEASIBLE')
    expect(byQuadrant.get('D')).toBe('INFEASIBLE_PLUS_OBSERVABILITY_DEFECT')
    expect(new Set(byQuadrant.values()).size).toBe(4)
  })

  it('keeps isomorphic referee pattern feasible with observability defect', () => {
    const referee = corpus.cases.find((c) => c.caseId === 'SX-REF-LINKAGE-GAP')
    expect(referee).toBeTruthy()
    const result = adjudicateConstructRepairV1(referee!.fixture)
    expect(result.semanticFeasibility).toBe('PASS')
    expect(result.trajectoryRecoveryOutcome).toBe('RECOVERED')
    expect(result.linkageCompleteness).toBe('INCOMPLETE')
    expect(result.overallExecutionFeasibility).toBe('PASS')
    expect(result.observabilityQuality).toBe('FAIL')
    expect(result.label).toBe('FEASIBLE_PLUS_OBSERVABILITY_DEFECT')
    expect(result.legalStateTrajectoryRecoveredWithIncompleteLinkage).toBe(true)
  })

  it('never maps Layer-3 incomplete alone to overall infeasible when Layer-1 passes', () => {
    const result = adjudicateConstructRepairV1({
      terminationStatus: 'TERMINAL_COMPLETE',
      objectiveOracleStatus: 'PASS',
      regressionOracleStatus: 'PASS',
      evidenceStatus: 'COMPLETE',
      provenanceStatus: 'COMPLETE',
      toolFailureObserved: true,
      reachedTerminalComplete: true,
      strictPerToolRecoveryLinkageComplete: false,
      missingRecoveryOfToolCallId: true,
      recoveryAttemptOrdinalIntegrity: false
    })
    expect(result.overallExecutionFeasibility).toBe('PASS')
    expect(result.observabilityQuality).toBe('FAIL')
  })

  it('treats pure task/oracle miss without tool failure as infeasible, not linkage', () => {
    const result = adjudicateConstructRepairV1(
      corpus.cases.find((c) => c.caseId === 'SX-F-FAIL-NO-TOOL-FAILURE')!.fixture
    )
    expect(result.trajectoryRecoveryOutcome).toBe('NOT_APPLICABLE')
    expect(result.linkageCompleteness).toBe('NOT_APPLICABLE')
    expect(result.overallExecutionFeasibility).toBe('FAIL')
    expect(result.label).toBe('INFEASIBLE_NO_TOOL_FAILURE')
  })

  it('is byte-stable for identical fixtures (deterministic adjudication property)', () => {
    const fixture = corpus.cases[0]!.fixture
    const hash = (value: ConstructRepairAdjudication) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex')
    expect(hash(adjudicateConstructRepairV1(fixture))).toBe(
      hash(adjudicateConstructRepairV1(fixture))
    )
  })

  it('records historical non-interference guard for forbidden live paths', () => {
    expect(() =>
      assertHistoricalNonInterference([
        'research/context-benchmarks/construct-repair/synthetic/corpus.v1.json'
      ])
    ).not.toThrow()
    expect(() =>
      assertHistoricalNonInterference([
        'research/context-benchmarks/.live-output/c1-f1-32-live/c1-f1-32-20260915-11df369c/run-manifest.json'
      ])
    ).toThrow(/historical_non_interference_violated/)
  })

  it('freeze-candidate contract declares zero-provider and historical mutation forbidden', () => {
    const contract = JSON.parse(
      readFileSync(
        new URL('../construct-repair/c1-feasibility-construct-repair-v1.freeze-candidate.json', import.meta.url),
        'utf8'
      )
    )
    expect(contract.status).toBe('READY_FOR_SYNTHETIC_VALIDATION_FREEZE')
    expect(contract.executionMode).toBe('ZERO_PROVIDER')
    expect(contract.historicalOutcomeMutation).toBe('FORBIDDEN')
    expect(contract.liveExecution).toBe('FORBIDDEN')
    expect(contract.routeLocks.f1_40Live).toBe('NO_GO')
  })
})
