import { mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** A C0 run identity can claim one evidence directory exactly once. */
export class C0RunIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'C0RunIdentityError'
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'EEXIST'
  )
}

/**
 * Atomically claim a fresh C0 evidence directory before any observation or
 * provider work. A pre-existing directory is terminal identity reuse: the
 * caller must choose a new run id, and the old evidence remains untouched.
 */
export async function claimSingleUseC0ReportDir(
  reportRoot: string,
  runId: string
): Promise<string> {
  if (
    runId.trim().length === 0 ||
    runId === '.' ||
    runId === '..' ||
    runId.includes('/') ||
    runId.includes('\\') ||
    basename(runId) !== runId
  ) {
    throw new C0RunIdentityError(`invalid C0 run identity '${runId}'`)
  }

  const reportDir = join(reportRoot, runId)
  await mkdir(reportRoot, { recursive: true })
  try {
    // mkdir without recursive=true is the atomic single-use claim. Two
    // concurrent starts cannot both own the same identity.
    await mkdir(reportDir)
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new C0RunIdentityError(
        `C0 run identity '${runId}' is already claimed at ${reportDir}; single-use identities are never resumed or overwritten`
      )
    }
    throw error
  }

  // Claim remains durable even if sink or final evidence creation fails; a
  // partial run must not become reusable evidence under the same identity.
  return reportDir
}
