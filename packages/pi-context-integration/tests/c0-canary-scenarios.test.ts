import { describe, expect, it } from 'vitest'
import {
  C0_BUDGETS,
  C0_E1_DISTRACTOR_ELIMINATION,
  C0_E2_WRONG_PATH_RECOVERY,
  C0_E3_PHASE_SHIFT,
  C0_E4_SUPERSEDED_EVIDENCE,
  C0_POLICY_VERSION,
  C0_RUN_ID_PATTERN,
  C0_SCENARIOS,
  C0ScenarioExecutor,
  evaluateC0StopConditions,
  finalizeScenarioRun,
  isValidC0RunId,
  parseC0ScenarioSubset,
  runScenarioOnScriptedMessages,
  runScriptedTurns,
  suggestC0RunId,
  type C0StopLedgers
} from '../src/smoke/c0-scenarios'

// CSPV-C0 canary scenario tests. Credential-free, network-free: the E1-E4
// scripts run through the SAME executor -> REAL policy-v0 planWorkingSet ->
// Gate D evaluator wiring the smoke runner uses. Provider calls: 0.

const ZERO_LEDGERS: C0StopLedgers = {
  providerCallRecords: 0,
  scenarioRunsCompleted: 0,
  elapsedMs: 0,
  replayMismatches: 0,
  mandatoryEvictions: 0,
  unexplainedDecisions: 0,
  orphanRehydrates: 0
}

describe('run identity (contract section 2)', () => {
  it('accepts the c0-<ISO-date>-<8-hex> format only', () => {
    expect(isValidC0RunId('c0-20260827-3f9a2c1d')).toBe(true)
    expect(isValidC0RunId('c0-20260827-00000000')).toBe(true)
    expect(isValidC0RunId('c0-2026-08-27-3f9a2c1d')).toBe(false) // dashed date
    expect(isValidC0RunId('c0-20260827-3F9A2C1D')).toBe(false) // uppercase hex
    expect(isValidC0RunId('c0-20260827-3f9a2c1')).toBe(false) // 7 hex chars
    expect(isValidC0RunId('c0-20260827-3f9a2c1de')).toBe(false) // 9 hex chars
    expect(isValidC0RunId('b0-20260827-3f9a2c1d')).toBe(false) // wrong prefix
    expect(isValidC0RunId('cspv-b0:s1')).toBe(false) // deterministic-suite id, not a run
    expect(isValidC0RunId(undefined)).toBe(false)
    expect(C0_RUN_ID_PATTERN.test('c0-20260827-3f9a2c1d')).toBe(true)
  })

  it('suggests fresh identities matching the pattern', () => {
    for (let index = 0; index < 8; index += 1) {
      const suggestion = suggestC0RunId()
      expect(isValidC0RunId(suggestion)).toBe(true)
    }
  })
})

describe('budget stop logic (contract sections 7-8)', () => {
  it('trips S-7 when the provider-call ledger passes the budget', () => {
    const at = evaluateC0StopConditions({
      ...ZERO_LEDGERS,
      providerCallRecords: C0_BUDGETS.maxProviderCalls
    })
    expect(at.stop).toBe(false)
    const past = evaluateC0StopConditions({
      ...ZERO_LEDGERS,
      providerCallRecords: C0_BUDGETS.maxProviderCalls + 1
    })
    expect(past.stop).toBe(true)
    if (past.stop) {
      expect(past.condition).toBe('S-7')
      expect(past.reason).toContain('provider-call budget')
    }
  })

  it('trips S-7 on scenario-run and wall-clock breaches', () => {
    const scenarios = evaluateC0StopConditions({ ...ZERO_LEDGERS, scenarioRunsCompleted: 5 })
    expect(scenarios.stop).toBe(true)
    if (scenarios.stop) expect(scenarios.condition).toBe('S-7')

    const clock = evaluateC0StopConditions({
      ...ZERO_LEDGERS,
      elapsedMs: C0_BUDGETS.maxWallClockMs + 1
    })
    expect(clock.stop).toBe(true)
    if (clock.stop) expect(clock.condition).toBe('S-7')
  })

  it('trips evidence stop conditions S-3, S-4 and S-6', () => {
    const replay = evaluateC0StopConditions({ ...ZERO_LEDGERS, replayMismatches: 1 })
    expect(replay.stop).toBe(true)
    if (replay.stop) expect(replay.condition).toBe('S-3')

    const eviction = evaluateC0StopConditions({ ...ZERO_LEDGERS, mandatoryEvictions: 1 })
    expect(eviction.stop).toBe(true)
    if (eviction.stop) expect(eviction.condition).toBe('S-4')

    const unexplained = evaluateC0StopConditions({ ...ZERO_LEDGERS, unexplainedDecisions: 1 })
    expect(unexplained.stop).toBe(true)
    if (unexplained.stop) expect(unexplained.condition).toBe('S-6')

    const orphan = evaluateC0StopConditions({ ...ZERO_LEDGERS, orphanRehydrates: 1 })
    expect(orphan.stop).toBe(true)
    if (orphan.stop) {
      expect(orphan.condition).toBe('S-6')
      expect(orphan.reason).toContain('orphan REHYDRATE')
    }
  })

  it('keeps all four scenarios within the current provider-call budget', () => {
    let records = 0
    for (const scenario of C0_SCENARIOS) {
      const result = runScenarioOnScriptedMessages(scenario)
      records += result.boundaries.length
    }
    expect(C0_SCENARIOS).toHaveLength(C0_BUDGETS.maxScenarioRuns)
    expect(records).toBeLessThanOrEqual(C0_BUDGETS.maxProviderCalls)
    expect(records).toBe(12)
  })
})

describe('E1 Distractor Elimination', () => {
  const result = runScenarioOnScriptedMessages(C0_E1_DISTRACTOR_ELIMINATION)

  it('produces the manifest ADD -> REMOVE/RULED_OUT chain', () => {
    expect(result.chainSatisfied).toBe(true)
    expect(result.chainFailures).toEqual([])
    const removes = result.chain.filter(
      (decision) => decision.kind === 'REMOVE' && decision.reasonCodes.includes('RULED_OUT')
    )
    expect(removes).toHaveLength(2)
    expect(
      removes.every((decision) => decision.sourceKey.includes('c0-e1-distractor-a'))
    ).toBe(true)
  })

  it('keeps the ruled-out distractor out of the final working set', () => {
    expect(result.finalActiveSourceKeys).not.toContain('run/tool-result://c0-e1-distractor-a')
    expect(result.finalActiveSourceKeys).toContain('run/tool-result://c0-e1-target')
    expect(result.finalActiveSourceKeys).toContain('run/tool-result://c0-e1-distractor-b')
  })

  it('evaluates with clean observable Gate D evidence', () => {
    expect(result.evaluator.counts.removeObserved).toBeGreaterThan(0)
    expect(result.evaluator.counts.mandatoryEvictions).toBe(0)
    expect(result.evaluator.counts.unexplainedDecisions).toBe(0)
    expect(result.evaluator.counts.reasonCodeCoverage).toBe(1)
    expect(result.evaluator.counts.provenanceRetained).toBe(1)
    expect(result.evaluator.criteria.REMOVE_OBSERVED).toBe('PASS')
    expect(result.evaluator.criteria.REASON_CODE_COVERAGE).toBe('PASS')
    expect(result.scenarioVerdict).toBe('PASS')
    expect(result.stopCondition).toBeNull()
  })

  it('documents the honest divergence: no REHYDRATE in the nominal E1 chain', () => {
    // The manifest expects no later-need evidence for the distractor; the
    // evaluator therefore reports REHYDRATE_AFTER_REMOVE NOT_OBSERVED and its
    // overall stays FAIL by design (a readiness gate needs positive evidence).
    expect(result.evaluator.counts.rehydrateObserved).toBe(0)
    expect(result.evaluator.criteria.REHYDRATE_AFTER_REMOVE).toBe('NOT_OBSERVED')
    expect(result.evaluator.criteria.NO_UNEXPLAINED_MATERIALIZATION_FAILURE).toBe('NOT_OBSERVED')
    expect(result.evaluator.overall).toBe('FAIL')
  })
})

describe('E2 Wrong Path Recovery', () => {
  const result = runScenarioOnScriptedMessages(C0_E2_WRONG_PATH_RECOVERY)

  it('produces REMOVE/RULED_OUT -> REHYDRATE with the manifest reasons', () => {
    expect(result.chainSatisfied).toBe(true)
    expect(result.chainFailures).toEqual([])
    const rehydrates = result.chain.filter((decision) => decision.kind === 'REHYDRATE')
    expect(rehydrates).toHaveLength(2)
    for (const decision of rehydrates) {
      expect(decision.reasonCodes).toContain('REHYDRATION_TRIGGERED')
      expect(
        decision.reasonCodes.includes('NEW_FAILURE_EVIDENCE') ||
          decision.reasonCodes.includes('DETAIL_REQUIRED')
      ).toBe(true)
    }
    const full = rehydrates.find(
      (decision) => decision.sourceKey === 'run/tool-result://c0-e2-reopen-a'
    )
    expect(full?.representationKind).toBe('FULL')
  })

  it('re-admits the exact removed SourceVersion within the horizon', () => {
    const counts = result.evaluator.counts
    expect(counts.removeObserved).toBe(2)
    expect(counts.rehydrateAfterRemoveObserved).toBe(2)
    expect(counts.orphanRehydrates).toBe(0)
    expect(counts.wrongVersionRehydrates).toBe(0)
    expect(counts.falseRemovalCandidates).toHaveLength(2)
    for (const candidate of counts.falseRemovalCandidates) {
      expect(candidate.modelCallDistance).toBe(1)
      expect(candidate.transitionDistance).toBe(1)
      expect(candidate.priority).toBe('HIGH_PRIORITY')
    }
    expect(result.evaluator.criteria.EXACT_SOURCE_VERSION_REHYDRATION).toBe('PASS')
    expect(result.evaluator.criteria.FALSE_REMOVAL_AUDITABLE).toBe('PASS')
  })

  it('evaluates every observable criterion positive and the scenario PASS', () => {
    expect(result.evaluator.counts.mandatoryEvictions).toBe(0)
    expect(result.evaluator.counts.unexplainedDecisions).toBe(0)
    expect(result.evaluator.counts.reasonCodeCoverage).toBe(1)
    expect(result.evaluator.counts.provenanceRetained).toBe(1)
    expect(result.scenarioVerdict).toBe('PASS')
    expect(result.evaluator.criteria.NO_UNEXPLAINED_MATERIALIZATION_FAILURE).toBe('NOT_OBSERVED')
    expect(result.evaluator.overall).toBe('FAIL')
  })
})

describe('E3 Phase Shift', () => {
  const result = runScenarioOnScriptedMessages(C0_E3_PHASE_SHIFT)

  it('produces REMOVE/PHASE_IRRELEVANT -> REHYDRATE/DETAIL_REQUIRED (FULL)', () => {
    expect(result.chainSatisfied).toBe(true)
    expect(result.chainFailures).toEqual([])
    const removes = result.chain.filter(
      (decision) => decision.kind === 'REMOVE' && decision.reasonCodes.includes('PHASE_IRRELEVANT')
    )
    expect(removes).toHaveLength(2)
    const rehydrates = result.chain.filter(
      (decision) => decision.kind === 'REHYDRATE' && decision.reasonCodes.includes('DETAIL_REQUIRED')
    )
    expect(rehydrates).toHaveLength(2)
    expect(
      rehydrates.find((d) => d.sourceKey === 'run/tool-result://c0-e3-phase-detail')
        ?.representationKind
    ).toBe('FULL')
  })

  it('carries the phase-signal provenance into rehydrate-after-remove evidence', () => {
    expect(result.evaluator.counts.rehydrateAfterRemoveObserved).toBe(2)
    expect(result.evaluator.counts.orphanRehydrates).toBe(0)
    expect(result.evaluator.counts.wrongVersionRehydrates).toBe(0)
    expect(result.scenarioVerdict).toBe('PASS')
    expect(result.finalActiveSourceKeys).toContain('run/tool-result://c0-e3-phase-detail')
  })
})

describe('E4 Superseded Evidence', () => {
  const result = runScenarioOnScriptedMessages(C0_E4_SUPERSEDED_EVIDENCE)

  it('produces REMOVE/SUPERSEDED and ADD/NEW_FAILURE_EVIDENCE at one boundary', () => {
    expect(result.chainSatisfied).toBe(true)
    expect(result.chainFailures).toEqual([])
    const superseded = result.chain.filter(
      (decision) => decision.kind === 'REMOVE' && decision.reasonCodes.includes('SUPERSEDED')
    )
    expect(superseded).toHaveLength(2)
    expect(superseded.every((d) => d.sourceKey.includes('c0-e4-failure-old'))).toBe(true)
    const added = result.chain.find(
      (decision) =>
        decision.kind === 'ADD' && decision.sourceKey === 'run/tool-result://c0-e4-failure-new'
    )
    expect(added?.reasonCodes).toContain('NEW_FAILURE_EVIDENCE')
  })

  it('drops the superseded source and keeps the new failure active', () => {
    expect(result.finalActiveSourceKeys).not.toContain('run/tool-result://c0-e4-failure-old')
    expect(result.finalActiveSourceKeys).toContain('run/tool-result://c0-e4-failure-new')
    expect(result.evaluator.counts.removeObserved).toBe(2)
    expect(result.evaluator.counts.mandatoryEvictions).toBe(0)
    expect(result.evaluator.counts.reasonCodeCoverage).toBe(1)
    expect(result.evaluator.counts.provenanceRetained).toBe(1)
    expect(result.scenarioVerdict).toBe('PASS')
  })
})

describe('determinism and executor wiring', () => {
  it('replays a scenario into identical transition hashes (DETERMINISTIC_REPLAY)', () => {
    const first = runScenarioOnScriptedMessages(C0_E2_WRONG_PATH_RECOVERY)
    const second = runScenarioOnScriptedMessages(C0_E2_WRONG_PATH_RECOVERY)
    expect(first.boundaries.map((b) => b.transitionLogicalHash)).toEqual(
      second.boundaries.map((b) => b.transitionLogicalHash)
    )
    expect(first.records.map((r) => r.decisionId)).toEqual(second.records.map((r) => r.decisionId))
    expect(first.boundaries.every((b) => b.replayVerified)).toBe(true)
    expect(first.evaluator.criteria.DETERMINISTIC_REPLAY).toBe('PASS')
  })

  it('uses the shared executor -> finalize wiring identical to the runner', () => {
    const executor = new C0ScenarioExecutor({
      runtimeSessionId: 'c0-test:e4',
      now: () => '2026-08-27T00:00:00.000Z',
      policyVersion: C0_POLICY_VERSION
    })
    runScriptedTurns(C0_E4_SUPERSEDED_EVIDENCE, executor)
    const result = finalizeScenarioRun(C0_E4_SUPERSEDED_EVIDENCE, executor)
    const convenience = runScenarioOnScriptedMessages(C0_E4_SUPERSEDED_EVIDENCE, {
      runtimeSessionId: 'c0-test:e4'
    })
    expect(result.records.map((r) => r.decisionId)).toEqual(
      convenience.records.map((r) => r.decisionId)
    )
    expect(result.scenarioVerdict).toBe(convenience.scenarioVerdict)
  })

  it('marks every recorded decision replay-verified with a model-call sequence', () => {
    const result = runScenarioOnScriptedMessages(C0_E1_DISTRACTOR_ELIMINATION)
    expect(result.records.length).toBeGreaterThan(0)
    for (const record of result.records) {
      expect(record.replayVerified).toBe(true)
      expect(record.modelCallSequence).toBeGreaterThan(0)
      expect(record.transitionSequence).toBeGreaterThan(0)
    }
    // Provenance: every decision resolves against the observed Universe.
    const universeVersions = new Set(result.universeVersionIds)
    for (const record of result.records) {
      expect(universeVersions.has(record.sourceVersionId)).toBe(true)
    }
  })

  it('runs all four scenarios with zero provider calls by construction', () => {
    // The scripted path touches no ModelRuntime, no session, no network; the
    // only side effects are in-memory observations. This test pins the wiring
    // contract the DRY_RUN mode relies on.
    for (const scenario of C0_SCENARIOS) {
      const result = runScenarioOnScriptedMessages(scenario)
      expect(result.boundaries.length).toBeGreaterThan(0)
      expect(result.records.length).toBeGreaterThan(0)
      expect(result.scenarioVerdict).toBe('PASS')
    }
  })
})

describe('scenario subset parsing (contract amendment 2)', () => {
  it('defaults to all four scenarios when CANVAS_C0_ONLY is absent', () => {
    const result = parseC0ScenarioSubset(undefined)
    expect(result.error).toBeUndefined()
    expect(result.scenarios?.map((scenario) => scenario.id)).toEqual(['E1', 'E2', 'E3', 'E4'])
  })

  it('returns the requested subset in canonical order', () => {
    const result = parseC0ScenarioSubset('e4, e3')
    expect(result.error).toBeUndefined()
    expect(result.scenarios?.map((scenario) => scenario.id)).toEqual(['E3', 'E4'])
  })

  it('rejects unknown ids, duplicates and empty values', () => {
    expect(parseC0ScenarioSubset('E5').error).toBeDefined()
    expect(parseC0ScenarioSubset('E1,E1').error).toBeDefined()
    expect(parseC0ScenarioSubset('   ').error).toBeDefined()
  })
})
