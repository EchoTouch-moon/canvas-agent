import { describe, expect, it } from 'vitest'
import * as stable from '../src'
import * as experimental from '../src/experimental'

// CR-004 hardening — PUBLIC SURFACE ISOLATION.
//
// The stable root (`.`) must not export any research symbol: nothing from
// the Active rewrite seam (v1/v2/v3 policies, composer, guard, kill switch,
// committed-context adapter, capability profile) and no C0/S1/M-series
// harness helper. Those live exclusively behind the explicit
// `@canvas-agent/pi-context-integration/experimental` entry (src/experimental.ts,
// wired through the package.json `exports` map).

const MOVED_VALUE_SYMBOLS = [
  // Active rewrite seam + policies
  'createActiveRewriteExtension',
  'InMemoryActiveRewriteEvidenceCollector',
  'composeActiveRewrite',
  'assertRewriteSafe',
  'createRunKillSwitch',
  'createLc1RuntimeAdmissionPiExtension',
  'createLc1ActiveRewriteExtension',
  'checkCapability',
  'PiCommittedContextAdapter',
  'analyzeNativeMessages',
  'activeMessagesHash',
  'detectInterventionBoundaries',
  'scanEditReadStructure',
  'scanDuplicateReads',
  'isVerificationWindowOpen',
  'applyCarriedRemovals',
  'readTargetHashOf',
  // C0/S1/M-series harness helpers
  'C0ScenarioExecutor',
  'C0_E4_SUPERSEDED_EVIDENCE',
  'runScenarioOnScriptedMessages',
  'S1PairStateMachine',
  'loadC1TaskDefinition',
  'MatrixStateMachine',
  'scriptedMxLegRecords',
  'analyzeMatrix',
  'MX_EXPERIMENT_PROFILES',
  'runPromptWithDeadline',
  'writeMxEvidenceRoot',
  'verifyMxEvidenceRoot'
] as const

const STABLE_VALUE_SYMBOLS = [
  'mapPiMessage',
  'mapPiMessages',
  'PiContextShadowObserver',
  'createPiContextShadowExtension',
  'EnrichedPiShadowObserver',
  'ShadowPlannerObserver',
  'createShadowPlannerPiExtension',
  'createPiRequestParityExtension',
  'InMemoryModelRequestCapture',
  'compareContextParity',
  'prepareModelProvider',
  'safeProviderSelection',
  'computeProviderConfigHash'
] as const

describe('pi-context-integration public surface isolation', () => {
  it('the stable root exports none of the moved research symbols', () => {
    const root = stable as unknown as Record<string, unknown>
    for (const symbol of MOVED_VALUE_SYMBOLS) {
      expect(root[symbol], `stable root must not export ${symbol}`).toBeUndefined()
    }
  })

  it('the stable root keeps the stable integration surface intact', () => {
    const root = stable as unknown as Record<string, unknown>
    for (const symbol of STABLE_VALUE_SYMBOLS) {
      expect(root[symbol], `stable root must keep exporting ${symbol}`).toBeDefined()
    }
  })

  it('the experimental entry exports the full research surface', () => {
    const entry = experimental as unknown as Record<string, unknown>
    for (const symbol of MOVED_VALUE_SYMBOLS) {
      expect(entry[symbol], `experimental entry must export ${symbol}`).toBeDefined()
    }
  })
})
