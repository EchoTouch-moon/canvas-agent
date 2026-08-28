import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// CR-004 hardening — EVIDENCE ROOT HASH.
//
// A tamper-evident anchor for one matrix run directory, written at run end
// and refreshed inside `--analyze`: the run identity, the code commit, the
// bound contract + its sha256, the manifest sha256, the provider config
// hash, and `legsRoot` — a sha256 over the sorted list of
// "<relativePath>:<fileSha256>" for EVERY file under the run dir (excluding
// evidence-root.json itself), plus `analysisSha256` when analysis.json
// exists. `--verify-evidence <dir>` recomputes every field and reports
// MATCH/MISMATCH per field. Historical leg evidence is never rewritten.

export const MX_EVIDENCE_ROOT_FILENAME = 'evidence-root.json'

export interface MxEvidenceRoot {
  readonly runId: string | null
  /** `git rev-parse HEAD` at generation time (null outside a repo). */
  readonly codeCommit: string | null
  readonly contractPath: string | null
  readonly contractSha256: string | null
  readonly manifestSha256: string | null
  readonly providerConfigHash: string | null
  /** sha256 over the sorted "<relativePath>:<fileSha256>" list of the run dir. */
  readonly legsRoot: string
  readonly analysisSha256?: string
  readonly generatedAt: string
}

export interface MxEvidenceRootOptions {
  /** Repo root for the contract path + git lookup; found by walking up when omitted. */
  readonly repoRoot?: string
  readonly now?: () => string
  /** Injectable git commit resolver for deterministic tests. */
  readonly gitRev?: () => string | null
}

export type MxEvidenceFieldCheck = 'MATCH' | 'MISMATCH' | 'UNKNOWN'

export interface MxEvidenceVerification {
  readonly fields: Readonly<Record<string, MxEvidenceFieldCheck>>
  readonly allMatch: boolean
}

function sha256OfContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

async function walkFiles(root: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) files.push(...(await walkFiles(root, rel)))
    else files.push(rel)
  }
  return files.sort()
}

/** Walk up from startDir to the nearest directory containing `.git`. */
export function findRepoRoot(startDir: string): string | null {
  let current = startDir
  for (let depth = 0; depth < 12; depth += 1) {
    if (current === '' || current === '/') return null
    if (existsSync(join(current, '.git'))) return current
    const parent = join(current, '..')
    if (parent === current) return null
    current = parent
  }
  return null
}

function defaultGitRev(cwd: string | undefined): string | null {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' })
  if (result.error !== undefined || result.status !== 0) return null
  const commit = result.stdout.trim()
  return /^[0-9a-f]{40}$/.test(commit) ? commit : null
}

interface MxManifestEvidence {
  readonly runId: string | null
  readonly contractPath: string | null
  readonly providerConfigHash: string | null
}

async function readManifestEvidence(runDir: string): Promise<MxManifestEvidence> {
  try {
    const raw = JSON.parse(await readFile(join(runDir, 'manifest.json'), 'utf8')) as {
      runId?: unknown
      contract?: unknown
      provider?: unknown
    }
    const provider =
      raw.provider !== null && typeof raw.provider === 'object' && !Array.isArray(raw.provider)
        ? (raw.provider as { experimentBinding?: unknown })
        : {}
    const binding =
      provider.experimentBinding !== null &&
      typeof provider.experimentBinding === 'object' &&
      !Array.isArray(provider.experimentBinding)
        ? (provider.experimentBinding as { providerConfigHash?: unknown })
        : {}
    return {
      runId: typeof raw.runId === 'string' && raw.runId !== '' ? raw.runId : null,
      contractPath: typeof raw.contract === 'string' && raw.contract !== '' ? raw.contract : null,
      providerConfigHash:
        typeof binding.providerConfigHash === 'string' ? binding.providerConfigHash : null
    }
  } catch {
    return { runId: null, contractPath: null, providerConfigHash: null }
  }
}

/**
 * Compute the evidence root of a run directory. `legsRoot` covers every file
 * under the dir (sorted relative paths, `/` separators) EXCLUDING
 * evidence-root.json itself; `analysisSha256` rides along when analysis.json
 * exists (it is also part of legsRoot, per the contract).
 */
export async function computeMxEvidenceRoot(
  runDir: string,
  options: MxEvidenceRootOptions = {}
): Promise<MxEvidenceRoot> {
  const now = options.now ?? (() => new Date().toISOString())
  const manifestEvidence = await readManifestEvidence(runDir)
  const repoRoot = options.repoRoot ?? findRepoRoot(runDir) ?? undefined

  let manifestSha256: string | null = null
  try {
    manifestSha256 = sha256OfContent(await readFile(join(runDir, 'manifest.json'), 'utf8'))
  } catch {
    manifestSha256 = null
  }

  let contractSha256: string | null = null
  if (manifestEvidence.contractPath !== null && repoRoot !== undefined) {
    try {
      contractSha256 = sha256OfContent(
        await readFile(join(repoRoot, manifestEvidence.contractPath), 'utf8')
      )
    } catch {
      contractSha256 = null
    }
  }

  let analysisSha256: string | undefined
  const legs: string[] = []
  for (const rel of await walkFiles(runDir)) {
    if (rel === MX_EVIDENCE_ROOT_FILENAME) continue
    const content = await readFile(join(runDir, rel), 'utf8')
    const fileSha256 = sha256OfContent(content)
    legs.push(`${rel}:${fileSha256}`)
    if (rel === 'analysis.json') analysisSha256 = fileSha256
  }
  const gitRev = options.gitRev ?? (() => defaultGitRev(repoRoot ?? runDir))
  return {
    runId: manifestEvidence.runId,
    codeCommit: gitRev(),
    contractPath: manifestEvidence.contractPath,
    contractSha256,
    manifestSha256,
    providerConfigHash: manifestEvidence.providerConfigHash,
    legsRoot: sha256OfContent(legs.join('\n')),
    ...(analysisSha256 !== undefined ? { analysisSha256 } : {}),
    generatedAt: now()
  }
}

/** Compute + write `<runDir>/evidence-root.json` (excluded from its own hash). */
export async function writeMxEvidenceRoot(
  runDir: string,
  options: MxEvidenceRootOptions = {}
): Promise<MxEvidenceRoot> {
  const root = await computeMxEvidenceRoot(runDir, options)
  await writeFile(
    join(runDir, MX_EVIDENCE_ROOT_FILENAME),
    `${JSON.stringify(root, null, 2)}\n`,
    'utf8'
  )
  return root
}

/**
 * Recompute the evidence root of a run directory and compare it field by
 * field against the stored evidence-root.json. `generatedAt` is excluded
 * (it legitimately differs); a missing stored file is UNKNOWN overall.
 */
export async function verifyMxEvidenceRoot(
  runDir: string,
  options: MxEvidenceRootOptions = {}
): Promise<MxEvidenceVerification> {
  let stored: MxEvidenceRoot
  try {
    stored = JSON.parse(await readFile(join(runDir, MX_EVIDENCE_ROOT_FILENAME), 'utf8')) as MxEvidenceRoot
  } catch {
    return { fields: { evidenceRootFile: 'UNKNOWN' }, allMatch: false }
  }
  const recomputed = await computeMxEvidenceRoot(runDir, {
    ...options,
    now: () => stored.generatedAt
  })
  const check = (storedValue: string | null | undefined, value: string | null | undefined): MxEvidenceFieldCheck => {
    if (storedValue === undefined) return 'UNKNOWN'
    return storedValue === value ? 'MATCH' : 'MISMATCH'
  }
  const fields: Record<string, MxEvidenceFieldCheck> = {
    runId: check(stored.runId, recomputed.runId),
    codeCommit: check(stored.codeCommit, recomputed.codeCommit),
    contractPath: check(stored.contractPath, recomputed.contractPath),
    contractSha256: check(stored.contractSha256, recomputed.contractSha256),
    manifestSha256: check(stored.manifestSha256, recomputed.manifestSha256),
    providerConfigHash: check(stored.providerConfigHash, recomputed.providerConfigHash),
    legsRoot: check(stored.legsRoot, recomputed.legsRoot),
    analysisSha256: check(stored.analysisSha256, recomputed.analysisSha256)
  }
  return { fields, allMatch: Object.values(fields).every((value) => value === 'MATCH') }
}
