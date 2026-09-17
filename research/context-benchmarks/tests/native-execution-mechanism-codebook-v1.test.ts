import { describe, expect, it } from 'vitest'
import {
  adjudicateMechanismCoding,
  adjudicateRuntimeActionableV1,
  assertHardSeparations,
  loadMechanismCalibrationCorpus,
  loadMechanismCodebook,
  refereeDualCoding,
  type MechanismCode
} from '../mechanism-study/adjudicate'

describe('C1_NATIVE_EXECUTION_MECHANISM_CODEBOOK_V1 freeze candidate', () => {
  const codebook = loadMechanismCodebook()
  const corpus = loadMechanismCalibrationCorpus()

  it('declares freeze-candidate status and hard separations', () => {
    expect(codebook.codebookId).toBe('C1_NATIVE_EXECUTION_MECHANISM_CODEBOOK_V1')
    expect(codebook.status).toBe('FREEZE_CANDIDATE')
    assertHardSeparations(codebook)
    expect(codebook.runtimeActionable.ruleId).toBe('RUNTIME_ACTIONABLE_V1')
    expect(
      codebook.runtimeActionable.evidenceClasses['SEALED_OFFLINE_ONLY']!.maySupportActionability
    ).toBe(false)
    expect(
      codebook.runtimeActionable.evidenceClasses['RUNTIME_VISIBLE']!.maySupportActionability
    ).toBe(true)
  })

  it('keeps calibration synthetic and free of historical markers', () => {
    expect(corpus.corpusId).toBe('C1_NATIVE_EXECUTION_MECHANISM_CODEBOOK_V1_CALIBRATION')
    const blob = JSON.stringify(corpus)
    expect(blob).not.toMatch(/11df369c/)
    expect(blob).not.toMatch(/VALID_INFEASIBLE/)
    expect(blob).not.toMatch(/\.live-output/)
  })

  it('adjudicates every calibration case to expected primary and actionability', () => {
    for (const testCase of corpus.cases) {
      const result = adjudicateMechanismCoding(testCase.coding, testCase.dual)
      expect(result.accepted, testCase.caseId).toBe(testCase.expected.accepted)
      expect(result.primaryMechanismCode, testCase.caseId).toBe(
        testCase.expected.primaryMechanismCode
      )
      expect(result.runtimeActionable, testCase.caseId).toBe(testCase.expected.runtimeActionable)
    }
  })

  it('does not treat mechanism attribution as runtime actionability', () => {
    const thrash = corpus.cases.find((c) => c.caseId === 'CAL-EDIT-THRASH-NO-ACTIONABLE')!
    const result = adjudicateMechanismCoding(thrash.coding)
    expect(result.primaryMechanismCode).toBe('EDIT_THRASH')
    expect(result.runtimeActionable).toBe(false)
  })

  it('fail-closes soft-leap and sealed-offline actionability claims', () => {
    const soft = adjudicateRuntimeActionableV1({
      interventionId: 'maybe-add-context',
      decisionPointId: 'after-failure',
      irreversibilityNotYetReached: false,
      attributionEvidenceClass: 'POST_HOC_NARRATIVE'
    })
    expect(soft.runtimeActionable).toBe(false)
    expect(soft.clauseFailures.length).toBeGreaterThan(0)

    const sealed = adjudicateRuntimeActionableV1({
      observableStateId: 'partial-diff',
      interventionId: 'nudge',
      decisionPointId: 'mid',
      irreversibilityNotYetReached: true,
      attributionEvidenceClass: 'SEALED_OFFLINE_ONLY'
    })
    expect(sealed.runtimeActionable).toBe(false)
    expect(sealed.clauseFailures).toContain('C4_NO_UNAVAILABLE_GROUND_TRUTH')
  })

  it('referees dual-coding on the main adjudication path', () => {
    expect(
      refereeDualCoding({
        runId: 'r1',
        coderA: 'OBJECTIVE_MISS',
        coderB: 'INSUFFICIENT_CONVERGENCE'
      })
    ).toBe('MULTI_MECHANISM')

    expect(
      refereeDualCoding({
        runId: 'r2',
        coderA: 'EDIT_THRASH',
        coderB: 'UNKNOWN'
      })
    ).toBe('UNKNOWN')

    const dualCase = corpus.cases.find((c) => c.caseId === 'CAL-DUAL-DISAGREE-MULTI')!
    expect(dualCase.dual).toBeTruthy()
    expect(refereeDualCoding(dualCase.dual!)).toBe(dualCase.expected.refereePrimary)
    const integrated = adjudicateMechanismCoding(dualCase.coding, dualCase.dual)
    expect(integrated.accepted).toBe(true)
    expect(integrated.primaryMechanismCode).toBe('MULTI_MECHANISM')
    expect(integrated.notes.some((n) => n.startsWith('dual_referee_override:'))).toBe(true)
  })

  it('freezes multi-seed event promotion as MULTI without priority unique-winner', () => {
    const multi = corpus.cases.find((c) => c.caseId === 'CAL-MULTI-FROM-SPLIT-EVENTS')!
    const result = adjudicateMechanismCoding(multi.coding)
    expect(result.primaryMechanismCode).toBe('MULTI_MECHANISM')
    expect(result.accepted).toBe(true)
    expect(codebook.promotionRules.priorityTableRole).toBe('DOCUMENTATION_AND_DISPLAY_ORDER_ONLY')

    const duplicateCoding = {
      ...multi.coding,
      primaryMechanismCode: 'MULTI_MECHANISM' as const,
      competingSeedCodes: ['EDIT_THRASH', 'EDIT_THRASH'] as const
    }
    delete duplicateCoding.events
    const duplicate = adjudicateMechanismCoding(duplicateCoding)
    expect(duplicate.accepted).toBe(false)
    expect(duplicate.primaryMechanismCode).toBe('UNKNOWN')
  })

  it('rejects Layer-1 PASS records for mechanism coding', () => {
    const pass = corpus.cases.find((c) => c.caseId === 'CAL-LAYER1-PASS-REJECTED')!
    const result = adjudicateMechanismCoding(pass.coding)
    expect(result.accepted).toBe(false)
    expect(result.primaryMechanismCode).toBe('UNKNOWN')
  })

  it('requires OTHER rationale and rejected seeds', () => {
    const bad = corpus.cases.find((c) => c.caseId === 'CAL-OTHER-REQUIRES-RATIONALE')!
    const good = corpus.cases.find((c) => c.caseId === 'CAL-OTHER-VALID')!
    expect(adjudicateMechanismCoding(bad.coding).accepted).toBe(false)
    expect(adjudicateMechanismCoding(good.coding).primaryMechanismCode).toBe('OTHER')
  })

  it('passes four-clause actionability only when all fields are honest', () => {
    const ok = corpus.cases.find((c) => c.caseId === 'CAL-ACTIONABLE-FOUR-CLAUSE-PASS')!
    const result = adjudicateMechanismCoding(ok.coding)
    expect(result.accepted).toBe(true)
    expect(result.runtimeActionable).toBe(true)
    expect(result.primaryMechanismCode as MechanismCode).toBe('INCORRECT_FILE_TARGETING')
  })
})
