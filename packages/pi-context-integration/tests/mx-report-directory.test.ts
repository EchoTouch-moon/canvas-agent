import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  claimSingleUseMxReportDir,
  MxRunIdentityError
} from '../src/smoke/mx-report-directory'

describe('single-use matrix report identity', () => {
  it('claims a fresh report directory and refuses reuse without overwriting evidence', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'canvas-mx-single-use-'))
    try {
      const reportDir = await claimSingleUseMxReportDir(reportRoot, 'cr004-m9-20260831-01234567')
      const marker = join(reportDir, 'marker.txt')
      await writeFile(marker, 'preserved evidence\n', 'utf8')

      await expect(
        claimSingleUseMxReportDir(reportRoot, 'cr004-m9-20260831-01234567')
      ).rejects.toBeInstanceOf(MxRunIdentityError)
      await expect(readFile(marker, 'utf8')).resolves.toBe('preserved evidence\n')
    } finally {
      await rm(reportRoot, { recursive: true, force: true })
    }
  })

  it('uses the filesystem claim as an atomic concurrent-start gate', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'canvas-mx-single-use-race-'))
    try {
      const outcomes = await Promise.allSettled([
        claimSingleUseMxReportDir(reportRoot, 'cr004-m8-20260831-01234567'),
        claimSingleUseMxReportDir(reportRoot, 'cr004-m8-20260831-01234567')
      ])
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
      expect(rejected).toMatchObject({
        status: 'rejected',
        reason: expect.any(MxRunIdentityError)
      })
    } finally {
      await rm(reportRoot, { recursive: true, force: true })
    }
  })

  it('rejects path-like identities before claiming a directory', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'canvas-mx-single-use-invalid-'))
    try {
      await expect(claimSingleUseMxReportDir(reportRoot, '../reused')).rejects.toThrow(
        MxRunIdentityError
      )
      await expect(claimSingleUseMxReportDir(reportRoot, 'windows\\reused')).rejects.toThrow(
        MxRunIdentityError
      )
      await expect(claimSingleUseMxReportDir(reportRoot, '')).rejects.toThrow(MxRunIdentityError)
    } finally {
      await rm(reportRoot, { recursive: true, force: true })
    }
  })
})
