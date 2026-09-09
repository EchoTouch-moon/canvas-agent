import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

// These are the workspace roots that form the headless Runtime/research
// surface. Electron-only paths are intentionally absent from this list.
export const CORE_WORKSPACE_PREFIXES = Object.freeze([
  'packages__codex-context-integration',
  'packages__context-conformance',
  'packages__context-runtime',
  'packages__contracts',
  'packages__domain',
  'packages__persistence',
  'packages__pi-context-integration',
  'packages__repository-observer',
  'packages__worker-runtime',
  'research__context-benchmarks'
])

export function isCoreAuditPath(path) {
  return CORE_WORKSPACE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}>`))
}

export function coreFindings(advisories) {
  return Object.values(advisories ?? {}).flatMap((advisory) =>
    (advisory.findings ?? [])
      .filter((finding) => (finding.paths ?? []).some(isCoreAuditPath))
      .map((finding) => ({
        id: advisory.github_advisory_id ?? String(advisory.id),
        module: advisory.module_name,
        severity: advisory.severity,
        title: advisory.title,
        paths: finding.paths.filter(isCoreAuditPath),
        patchedVersions: advisory.patched_versions ?? null,
        url: advisory.url ?? null
      }))
  )
}

function parseAuditOutput(raw) {
  const first = raw.indexOf('{')
  const last = raw.lastIndexOf('}')
  if (first < 0 || last < first) return null
  try {
    return JSON.parse(raw.slice(first, last + 1))
  } catch {
    return null
  }
}

export function runCoreAudit() {
  const result = spawnSync(
    'pnpm',
    ['audit', '--prod', '--audit-level', 'high', '--json', '--registry=https://registry.npmjs.org'],
    { encoding: 'utf8' }
  )
  const report = parseAuditOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`)
  if (report === null || typeof report !== 'object') {
    process.stderr.write('Core audit did not return a readable JSON report.\n')
    if (result.stderr) process.stderr.write(result.stderr)
    return 1
  }
  if (report.error !== undefined) {
    process.stderr.write(`Core audit registry/error response: ${JSON.stringify(report.error)}\n`)
    return 1
  }
  const findings = coreFindings(report.advisories)
  const ignored = Object.values(report.advisories ?? {}).flatMap((advisory) =>
    (advisory.findings ?? [])
      .filter((finding) => !(finding.paths ?? []).some(isCoreAuditPath))
      .map((finding) => ({
        id: advisory.github_advisory_id ?? String(advisory.id),
        module: advisory.module_name,
        severity: advisory.severity,
        paths: finding.paths
      }))
  )
  process.stdout.write(
    `${JSON.stringify(
      {
        scope: 'headless-context-runtime-and-research',
        coreFindings: findings,
        electronOrOtherFindingsExcluded: ignored.length,
        auditExitCode: result.status ?? 1
      },
      null,
      2
    )}\n`
  )
  if (findings.length > 0) return 1
  // A non-zero audit process without an advisories object is an execution
  // failure (registry, lockfile or tool error), not an Electron-only finding.
  if (result.status !== 0 && report.advisories === undefined) return 1
  return 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runCoreAudit()
}
