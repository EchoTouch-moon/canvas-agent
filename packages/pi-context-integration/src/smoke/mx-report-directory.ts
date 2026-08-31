import { mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** A run identity can claim one evidence directory exactly once. */
export class MxRunIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MxRunIdentityError'
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
 * Atomically claim a fresh matrix evidence directory before the first leg.
 * A pre-existing directory is terminal identity reuse: the caller must use a
 * new run id, and the old evidence remains untouched.
 */
export async function claimSingleUseMxReportDir(
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
    throw new MxRunIdentityError(`invalid matrix run identity '${runId}'`)
  }

  const reportDir = join(reportRoot, runId)
  await mkdir(reportRoot, { recursive: true })
  try {
    // mkdir without recursive=true is the atomic single-use claim. Two
    // concurrent starts cannot both own the same identity.
    await mkdir(reportDir)
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new MxRunIdentityError(
        `matrix run identity '${runId}' is already claimed at ${reportDir}; single-use identities are never resumed or overwritten`
      )
    }
    throw error
  }

  // Claim remains durable even if this child creation fails; a partial run
  // must not become reusable evidence under the same identity.
  await mkdir(join(reportDir, 'legs'))
  return reportDir
}
