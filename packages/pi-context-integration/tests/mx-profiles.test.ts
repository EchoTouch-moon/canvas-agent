import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  MX_EXPERIMENT_PROFILES,
  MX_LATEST_PROFILE,
  MxProfileError,
  assertMxProfileBindable,
  mxProfileForRunId,
  mxProvenanceWarnings,
  mxRunIdSeriesOf,
  readMxProfileContract,
  validateMxShapeAgainstProfile
} from '../src/smoke/mx-profiles'
import { analyzeMatrix, scriptedMxLegRecords, writeMxLegEvidence } from '../src/smoke/matrix-core'

// CR-004 hardening — EXPERIMENT PROFILE / CONTRACT BINDING tests.
//
// The registry binds every M-series to its contract file, design label and
// shape bounds; an unknown series (M7+) is REFUSED until a profile + contract
// are deliberately added, the contract file must EXIST at startup, env-knob
// shapes are validated against the bounds, and the analyzer cross-checks
// manifests against the run-id series (the historical M4 mislabel — contract
// says M3, run id says M4 — must surface WITHOUT rewriting evidence).

const M4_RUN_ID = 'cr004-m4-20260827-d0cec2f5'

describe('MX_EXPERIMENT_PROFILES registry', () => {
  it('registers M1..M6 (history, M5 replication, and the M6 mechanism screen) with distinct contracts and designs', () => {
    expect(MX_EXPERIMENT_PROFILES.map((profile) => profile.series)).toEqual(['M1', 'M2', 'M3', 'M4', 'M5', 'M6'])
    const contracts = new Set(MX_EXPERIMENT_PROFILES.map((profile) => profile.contractPath))
    const designs = new Set(MX_EXPERIMENT_PROFILES.map((profile) => profile.matrixDesign))
    expect(contracts.size).toBe(6)
    expect(designs.size).toBe(6)
    // The registry records the shapes history actually ran.
    const m4 = mxProfileForRunId(M4_RUN_ID)!
    expect(m4.contractPath).toBe('docs/plan/cr004-m4-confirmatory-run-contract-2026-08-27.md')
    expect(m4.matrixDesign).toBe('M4-confirmatory')
    expect(m4.allowedTasks).toEqual(['L1', 'L2'])
    expect(m4.allowedArms).toEqual(['NATIVE', 'ACTIVE_V2'])
    expect(m4.maxReps).toBe(8)
    expect(MX_LATEST_PROFILE.series).toBe('M6')
    const m6 = mxProfileForRunId('cr004-m6-20260830-01234567')!
    expect(m6.matrixDesign).toBe('M6-mechanism-screen')
    expect(m6.allowedArms).toEqual(['NATIVE', 'ACTIVE_V2', 'ACTIVE_V3', 'ACTIVE_V4'])
    expect(m6.maxReps).toBe(4)
    expect(m6.maxProviderCallRecords).toBe(1400)
    expect(m6.runWallClockMs).toBe(18_000_000)
    expect(mxRunIdSeriesOf(M4_RUN_ID)).toBe('M4')
    expect(mxRunIdSeriesOf('cr004-m5-20260901-00000000')).toBe('M5')
  })

  it('assertMxProfileBindable refuses unregistered series with a deliberate-act message', () => {
    expect(() =>
      assertMxProfileBindable('cr004-m7-20260901-00000000', { repoRoot: '/tmp' })
    ).toThrow(MxProfileError)
    expect(() =>
      assertMxProfileBindable('cr004-m7-20260901-00000000', { repoRoot: '/tmp' })
    ).toThrow(/no experiment profile registered.*deliberate act/)
  })

  it('assertMxProfileBindable refuses when the contract file is missing on disk (fs gate)', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'canvas-mx-profiles-'))
    try {
      expect(() => assertMxProfileBindable(M4_RUN_ID, { repoRoot })).toThrow(
        /experiment profile M4 contract missing on disk/
      )
      // Creating the contract at the repo-root-relative path unblocks binding.
      const relative = mxProfileForRunId(M4_RUN_ID)!.contractPath.split('/')
      let dir = repoRoot
      for (const segment of relative.slice(0, -1)) {
        dir = join(dir, segment)
        await mkdir(dir, { recursive: true })
      }
      await writeFile(join(repoRoot, ...relative), '# contract\n', 'utf8')
      const profile = assertMxProfileBindable(M4_RUN_ID, { repoRoot })
      expect(profile.series).toBe('M4')
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  it('readMxProfileContract hashes the on-disk contract content', async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), 'canvas-mx-profiles-'))
    try {
      const content = '# M4 confirmatory contract (synthetic)\n'
      await mkdir(join(repoRoot, 'docs', 'plan'), { recursive: true })
      await writeFile(
        join(repoRoot, 'docs', 'plan', 'cr004-m4-confirmatory-run-contract-2026-08-27.md'),
        content,
        'utf8'
      )
      const binding = await readMxProfileContract(mxProfileForRunId(M4_RUN_ID)!, { repoRoot })
      expect(binding.absolutePath).toBe(
        join(repoRoot, 'docs', 'plan', 'cr004-m4-confirmatory-run-contract-2026-08-27.md')
      )
      expect(binding.contractSha256).toBe(
        createHash('sha256').update(content, 'utf8').digest('hex')
      )
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })

  it('validateMxShapeAgainstProfile enforces the series bounds on env knobs', () => {
    const m4 = mxProfileForRunId(M4_RUN_ID)!
    expect(() =>
      validateMxShapeAgainstProfile({ tasks: ['L1', 'L2'], strategies: ['NATIVE', 'ACTIVE_V2'], repetitions: 8 }, m4)
    ).not.toThrow()
    expect(() =>
      validateMxShapeAgainstProfile({ tasks: ['L3'], strategies: ['NATIVE'], repetitions: 3 }, m4)
    ).toThrow(/task slot 'L3' is outside experiment profile M4 bounds/)
    expect(() =>
      validateMxShapeAgainstProfile({ tasks: ['L1'], strategies: ['ACTIVE_V3'], repetitions: 3 }, m4)
    ).toThrow(/arm 'ACTIVE_V3' is outside experiment profile M4 bounds/)
    expect(() =>
      validateMxShapeAgainstProfile({ tasks: ['L1'], strategies: ['NATIVE'], repetitions: 9 }, m4)
    ).toThrow(/repetitions 9 exceed experiment profile M4 max 8/)
  })
})

describe('mxProvenanceWarnings (manifest vs run-id series)', () => {
  it('surfaces the historical M4 mislabel: contract says M3, run id says M4', () => {
    // The REAL M4 manifest shape (contract + matrixDesign were hardcoded M3).
    const warnings = mxProvenanceWarnings(
      {
        runId: M4_RUN_ID,
        contract: 'docs/plan/cr004-m3-matrix-run-contract-2026-08-27.md',
        matrixDesign: 'M3-verify-window-dedup',
        design: { tasks: ['L1', 'L2'], strategies: ['NATIVE', 'ACTIVE_V2'], repetitions: 8 }
      },
      { runIdFallback: basename(M4_RUN_ID) }
    )
    expect(warnings.some((warning) => warning.includes('contract mismatch') && warning.includes('cr004-m4-matrix-run-contract') === false && warning.includes("series M4 is bound to 'docs/plan/cr004-m4-confirmatory-run-contract-2026-08-27.md'"))).toBe(true)
    expect(warnings.some((warning) => warning.includes('matrixDesign mismatch') && warning.includes("'M4-confirmatory'"))).toBe(true)
    // The recorded design SHAPE was within M4 bounds (only the labels lied).
    expect(warnings.some((warning) => warning.includes('outside series M4 bounds'))).toBe(false)
    expect(warnings).toHaveLength(2)
  })

  it('emits no warnings for a correctly labeled manifest of any series', () => {
    const m3 = mxProfileForRunId('cr004-m3-20260827-9f6fb390')!
    expect(
      mxProvenanceWarnings({
        runId: 'cr004-m3-20260827-9f6fb390',
        contract: m3.contractPath,
        matrixDesign: m3.matrixDesign,
        design: { tasks: ['L1', 'L2', 'L3'], strategies: ['NATIVE', 'ACTIVE_V2', 'ACTIVE_V3'], repetitions: 3 }
      })
    ).toEqual([])
    const m2 = mxProfileForRunId('cr004-m2-20260827-eba91805')!
    expect(
      mxProvenanceWarnings({
        runId: 'cr004-m2-20260827-eba91805',
        contract: m2.contractPath,
        matrixDesign: m2.matrixDesign,
        design: { tasks: ['L1', 'L2', 'L3'], strategies: ['NATIVE', 'ACTIVE', 'ACTIVE_V2'], repetitions: 3 }
      })
    ).toEqual([])
  })

  it('warns on unknown series, missing contract, and out-of-bounds recorded shapes', () => {
    expect(mxProvenanceWarnings({ runId: 'cr004-m7-20260901-00000000' })).toEqual([
      'runId series M7 has no experiment profile registered'
    ])
    expect(mxProvenanceWarnings({ runId: M4_RUN_ID })).toEqual([
      "manifest records no contract path; series M4 expects 'docs/plan/cr004-m4-confirmatory-run-contract-2026-08-27.md'"
    ])
    expect(
      mxProvenanceWarnings(
        { design: { tasks: ['L3'], strategies: ['ACTIVE_V3'], repetitions: 9 } },
        { runIdFallback: M4_RUN_ID }
      ).some((warning) => warning.includes('outside series M4 bounds'))
    ).toBe(true)
  })
})

describe('analyzeMatrix provenance cross-check (read-only on evidence)', () => {
  it('analyzes an M4-labeled dir with the historical M3 mislabel and reports it', async () => {
    const reportDir = await mkdtemp(join(tmpdir(), 'canvas-mx-report-'))
    try {
      await mkdir(join(reportDir, 'legs'), { recursive: true })
      // Two scripted legs only — the analyzer aggregates whatever is present.
      for (const record of scriptedMxLegRecords(M4_RUN_ID, {
        tasks: ['L1'],
        strategies: ['NATIVE', 'ACTIVE_V2'],
        repetitions: 1
      })) {
        await writeMxLegEvidence(reportDir, record, [])
      }
      await writeFile(
        join(reportDir, 'manifest.json'),
        JSON.stringify({
          runId: M4_RUN_ID,
          contract: 'docs/plan/cr004-m3-matrix-run-contract-2026-08-27.md',
          matrixDesign: 'M3-verify-window-dedup',
          design: { tasks: ['L1'], strategies: ['NATIVE', 'ACTIVE_V2'], repetitions: 1 }
        }),
        'utf8'
      )
      const { analysis, markdown } = await analyzeMatrix(reportDir)
      expect(analysis.legsAnalyzed).toBe(2)
      expect(analysis.provenanceWarnings).toHaveLength(2)
      expect(analysis.provenanceWarnings[0]).toContain('contract mismatch')
      expect(analysis.provenanceWarnings[1]).toContain('matrixDesign mismatch')
      expect(markdown).toContain('## Provenance warnings')
      expect(markdown).toContain('- WARNING: contract mismatch')
      // The manifest evidence file itself is untouched by the analyzer.
      const manifest = JSON.parse(await readFile(join(reportDir, 'manifest.json'), 'utf8'))
      expect(manifest.contract).toBe('docs/plan/cr004-m3-matrix-run-contract-2026-08-27.md')
    } finally {
      await rm(reportDir, { recursive: true, force: true })
    }
  })
})
