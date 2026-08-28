import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MX_EVIDENCE_ROOT_FILENAME,
  computeMxEvidenceRoot,
  findRepoRoot,
  verifyMxEvidenceRoot,
  writeMxEvidenceRoot,
  type MxEvidenceRootOptions
} from '../src/smoke/mx-evidence-root'

// CR-004 hardening — EVIDENCE ROOT HASH tests over a synthetic run dir.
// Deterministic: the git commit resolver is injected; provider calls: 0.

const COMMIT = 'd0cec2f5d0cec2f5d0cec2f5d0cec2f5d0cec2f5'
const FIXED_NOW = '2026-08-27T00:00:00.000Z'

function sha256Of(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

const MANIFEST = {
  runId: 'cr004-m4-20260827-d0cec2f5',
  mode: 'LIVE',
  contract: 'docs/plan/cr004-m4-confirmatory-run-contract-2026-08-27.md',
  provider: {
    experimentBinding: {
      runIdentity: 'cr004-m4-20260827-d0cec2f5',
      providerConfigHash: 'dbcbff3eb4549710faaa018aab784dbb56c3082dae673931c50cb15d999eabc8'
    }
  }
}

const CONTRACT_CONTENT = '# M4 confirmatory contract (synthetic)\n'

async function buildRunDir(): Promise<{ runDir: string; repoRoot: string }> {
  const repoRoot = await mkdtemp(join(tmpdir(), 'canvas-mx-root-repo-'))
  const runDir = join(repoRoot, 'research', 'context-benchmarks', 'reports', 'cr004-matrix', 'run')
  await mkdir(join(repoRoot, '.git'), { recursive: true })
  await mkdir(join(runDir, 'legs', 'L1-NATIVE-rep1'), { recursive: true })
  await mkdir(join(repoRoot, 'docs', 'plan'), { recursive: true })
  await writeFile(
    join(repoRoot, 'docs', 'plan', 'cr004-m4-confirmatory-run-contract-2026-08-27.md'),
    CONTRACT_CONTENT,
    'utf8'
  )
  await writeFile(join(runDir, 'manifest.json'), `${JSON.stringify(MANIFEST, null, 2)}\n`, 'utf8')
  await writeFile(
    join(runDir, 'legs', 'L1-NATIVE-rep1', 'leg.json'),
    '{"legIndex":0,"status":"COMPLETED"}\n',
    'utf8'
  )
  await writeFile(
    join(runDir, 'legs', 'L1-NATIVE-rep1', 'observations.jsonl'),
    '{"sequence":1}\n{"sequence":2}\n',
    'utf8'
  )
  await writeFile(join(runDir, 'analysis.json'), '{"legsAnalyzed":1}\n', 'utf8')
  return { runDir, repoRoot }
}

const ROOT_OPTIONS = (): MxEvidenceRootOptions => ({
  gitRev: () => COMMIT,
  now: () => FIXED_NOW
})

describe('computeMxEvidenceRoot', () => {
  it('hashes every field of a synthetic run dir (legsRoot excludes itself)', async () => {
    const { runDir, repoRoot } = await buildRunDir()
    try {
      const root = await computeMxEvidenceRoot(runDir, { ...ROOT_OPTIONS(), repoRoot })
      expect(root.runId).toBe('cr004-m4-20260827-d0cec2f5')
      expect(root.codeCommit).toBe(COMMIT)
      expect(root.contractPath).toBe('docs/plan/cr004-m4-confirmatory-run-contract-2026-08-27.md')
      expect(root.contractSha256).toBe(sha256Of(CONTRACT_CONTENT))
      expect(root.manifestSha256).toBe(
        sha256Of(await readFile(join(runDir, 'manifest.json'), 'utf8'))
      )
      expect(root.providerConfigHash).toBe(MANIFEST.provider.experimentBinding.providerConfigHash)
      expect(root.analysisSha256).toBe(sha256Of('{"legsAnalyzed":1}\n'))
      // legsRoot = sha256 over sorted "<rel>:<sha256>" of the OTHER files.
      const expectedFiles = [
        'analysis.json',
        'legs/L1-NATIVE-rep1/leg.json',
        'legs/L1-NATIVE-rep1/observations.jsonl',
        'manifest.json'
      ].sort()
      const expectedListing: string[] = []
      for (const rel of expectedFiles) {
        expectedListing.push(`${rel}:${sha256Of(await readFile(join(runDir, rel), 'utf8'))}`)
      }
      expect(root.legsRoot).toBe(sha256Of(expectedListing.join('\n')))
    } finally {
      await rm(join(runDir, '..', '..', '..', '..'), { recursive: true, force: true })
    }
  })

  it('findRepoRoot walks up to the nearest .git directory', async () => {
    const { runDir, repoRoot } = await buildRunDir()
    try {
      expect(findRepoRoot(runDir)).toBe(repoRoot)
      expect(findRepoRoot(join(runDir, 'legs'))).toBe(repoRoot)
      expect(findRepoRoot(tmpdir())).toBeNull()
    } finally {
      await rm(join(runDir, '..', '..', '..', '..'), { recursive: true, force: true })
    }
  })
})

describe('writeMxEvidenceRoot + verifyMxEvidenceRoot', () => {
  it('round-trips MATCH on an untouched dir; evidence-root.json is excluded', async () => {
    const { runDir, repoRoot } = await buildRunDir()
    try {
      await writeMxEvidenceRoot(runDir, { ...ROOT_OPTIONS(), repoRoot })
      const stored = JSON.parse(await readFile(join(runDir, MX_EVIDENCE_ROOT_FILENAME), 'utf8'))
      expect(stored.generatedAt).toBe(FIXED_NOW)
      const verification = await verifyMxEvidenceRoot(runDir, { ...ROOT_OPTIONS(), repoRoot })
      expect(verification.allMatch).toBe(true)
      expect(Object.values(verification.fields).every((check) => check === 'MATCH')).toBe(true)
    } finally {
      await rm(join(runDir, '..', '..', '..', '..'), { recursive: true, force: true })
    }
  })

  it('reports MISMATCH for legsRoot when a leg file is tampered', async () => {
    const { runDir, repoRoot } = await buildRunDir()
    try {
      await writeMxEvidenceRoot(runDir, { ...ROOT_OPTIONS(), repoRoot })
      await writeFile(
        join(runDir, 'legs', 'L1-NATIVE-rep1', 'leg.json'),
        '{"legIndex":0,"status":"FAILED"}\n',
        'utf8'
      )
      const verification = await verifyMxEvidenceRoot(runDir, { ...ROOT_OPTIONS(), repoRoot })
      expect(verification.fields['legsRoot']).toBe('MISMATCH')
      expect(verification.fields['manifestSha256']).toBe('MATCH')
      expect(verification.allMatch).toBe(false)
    } finally {
      await rm(join(runDir, '..', '..', '..', '..'), { recursive: true, force: true })
    }
  })

  it('reports MISMATCH for manifestSha256 (+legsRoot) when the manifest is rewritten', async () => {
    const { runDir, repoRoot } = await buildRunDir()
    try {
      await writeMxEvidenceRoot(runDir, { ...ROOT_OPTIONS(), repoRoot })
      await writeFile(
        join(runDir, 'manifest.json'),
        `${JSON.stringify({ ...MANIFEST, status: 'STOPPED' }, null, 2)}\n`,
        'utf8'
      )
      const verification = await verifyMxEvidenceRoot(runDir, { ...ROOT_OPTIONS(), repoRoot })
      expect(verification.fields['manifestSha256']).toBe('MISMATCH')
      expect(verification.fields['legsRoot']).toBe('MISMATCH')
    } finally {
      await rm(join(runDir, '..', '..', '..', '..'), { recursive: true, force: true })
    }
  })

  it('reports UNKNOWN overall when no evidence-root.json exists', async () => {
    const { runDir, repoRoot } = await buildRunDir()
    try {
      const verification = await verifyMxEvidenceRoot(runDir, { ...ROOT_OPTIONS(), repoRoot })
      expect(verification.allMatch).toBe(false)
      expect(verification.fields['evidenceRootFile']).toBe('UNKNOWN')
    } finally {
      await rm(join(runDir, '..', '..', '..', '..'), { recursive: true, force: true })
    }
  })
})
