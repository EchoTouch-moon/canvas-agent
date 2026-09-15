import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  ConstructRepairContractError,
  adjudicateConstructRepairV1,
  assertHistoricalNonInterference,
  fixtureFromTruthTableRow,
  loadConstructRepairFreezeContract,
  loadConstructRepairSyntheticCorpus,
  type ConstructRepairAdjudication,
  type ObservabilityQuality
} from '../src/feasibility-construct-repair/adjudicate'

describe('C1_FEASIBILITY_CONSTRUCT_REPAIR_V1 synthetic validation', () => {
  const corpus = loadConstructRepairSyntheticCorpus()
  const contract = loadConstructRepairFreezeContract()

  it('loads zero-provider corpus without historical run IDs', () => {
    expect(corpus.corpusId).toBe('C1_FEASIBILITY_CONSTRUCT_REPAIR_V1_SYNTHETIC_CORPUS')
    const blob = JSON.stringify(corpus)
    expect(blob).not.toMatch(/c1-f1-32-20260915-run-/)
    expect(blob).not.toMatch(/11df369c/)
    expect(blob).not.toMatch(/VALID_INFEASIBLE/)
    expect(blob).not.toMatch(/reachedTerminalComplete/)
  })

  it('binds adjudicator outputs to contract crossLayerTruthTable rows', () => {
    expect(contract.contractId).toBe('C1_FEASIBILITY_CONSTRUCT_REPAIR_V1')
    expect(contract.composition.overallExecutionFeasibility.illegalState).toContain(
      'PASS AND trajectoryRecoveryOutcome == UNRECOVERED'
    )

    for (const row of contract.crossLayerTruthTable) {
      const fixture = fixtureFromTruthTableRow(row)
      const result = adjudicateConstructRepairV1(fixture)
      expect(result.label).toBe(row.label)
      expect(result.overallExecutionFeasibility).toBe(row.overallExecutionFeasibility)

      if (row.semanticFeasibility !== 'UNKNOWN') {
        expect(result.semanticFeasibility).toBe(row.semanticFeasibility)
      } else {
        expect(result.semanticFeasibility).toBe('UNKNOWN')
      }

      if (row.linkageCompleteness !== 'ANY') {
        expect(result.linkageCompleteness).toBe(row.linkageCompleteness)
      }

      if (row.observabilityQuality === 'DERIVE_FROM_LINKAGE_OR_UNKNOWN') {
        const expectedObs: ObservabilityQuality =
          result.linkageCompleteness === 'COMPLETE'
            ? 'PASS'
            : result.linkageCompleteness === 'INCOMPLETE'
              ? 'FAIL'
              : 'NOT_APPLICABLE'
        expect(result.observabilityQuality).toBe(expectedObs)
      } else {
        expect(result.observabilityQuality).toBe(row.observabilityQuality)
      }

      if (row.id === 'TT-B') {
        expect(result.trajectoryRecoveryOutcome).toBe('RECOVERED')
        expect(result.legalStateTrajectoryRecoveredWithIncompleteLinkage).toBe(true)
      }
    }
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
      if (!testCase.quadrant || !['A', 'B', 'C', 'D'].includes(testCase.quadrant)) continue
      const result = adjudicateConstructRepairV1(testCase.fixture)
      byQuadrant.set(testCase.quadrant, result.label)
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
    expect(result.reachedTerminalCompleteDerived).toBe(true)
  })

  it('derives reachedTerminalComplete from terminationStatus and rejects L1/L2 contradiction class', () => {
    const consistent = adjudicateConstructRepairV1({
      terminationStatus: 'TERMINAL_COMPLETE',
      objectiveOracleStatus: 'PASS',
      regressionOracleStatus: 'PASS',
      evidenceStatus: 'COMPLETE',
      provenanceStatus: 'COMPLETE',
      toolFailureObserved: true,
      strictPerToolRecoveryLinkageComplete: false,
      missingRecoveryOfToolCallId: true,
      recoveryAttemptOrdinalIntegrity: true
    })
    expect(consistent.reachedTerminalCompleteDerived).toBe(true)
    expect(consistent.trajectoryRecoveryOutcome).toBe('RECOVERED')
    expect(consistent.overallExecutionFeasibility).toBe('PASS')

    // Former contradiction class is no longer expressible: TERMINAL_COMPLETE
    // always derives reachedTerminalComplete=true, so L2 cannot be UNRECOVERED
    // when L1 PASS.
    expect(consistent.semanticFeasibility).toBe('PASS')
    expect(consistent.trajectoryRecoveryOutcome).not.toBe('UNRECOVERED')
  })

  it('never maps Layer-3 incomplete alone to overall infeasible when Layer-1 passes', () => {
    const result = adjudicateConstructRepairV1({
      terminationStatus: 'TERMINAL_COMPLETE',
      objectiveOracleStatus: 'PASS',
      regressionOracleStatus: 'PASS',
      evidenceStatus: 'COMPLETE',
      provenanceStatus: 'COMPLETE',
      toolFailureObserved: true,
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

  it('fail-closes corpus loader against historical live-output paths', () => {
    expect(() =>
      loadConstructRepairSyntheticCorpus(
        '/Users/v/Documents/V/research/context-benchmarks/.live-output/c1-f1-32-live/c1-f1-32-20260915-11df369c/run-manifest.json'
      )
    ).toThrow(ConstructRepairContractError)

    expect(() =>
      loadConstructRepairSyntheticCorpus('/tmp/c1-f1-32-20260915-11df369c/owner-authorization.json')
    ).toThrow(/historical_non_interference_violated/)

    expect(() =>
      assertHistoricalNonInterference(['construct-repair/synthetic/corpus.v1.json'])
    ).not.toThrow()

    expect(() =>
      assertHistoricalNonInterference([
        '.live-output/c1-f1-32-live/c1-f1-32-20260915-11df369c/run-manifest.json'
      ])
    ).toThrow(/historical_non_interference_violated/)
  })

  it('freeze-candidate contract declares zero-provider and historical mutation forbidden', () => {
    expect(contract.status).toBe('READY_FOR_SYNTHETIC_VALIDATION_FREEZE')
    expect(contract.contractId).toBe('C1_FEASIBILITY_CONSTRUCT_REPAIR_V1')
    expect(contract.layers.layer2RecoveryTrajectory.explicitLegalState.name).toBe(
      'TRAJECTORY_RECOVERED_WITH_INCOMPLETE_TOOL_LINKAGE'
    )
  })
})
