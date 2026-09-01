import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  claimSingleUseC0ReportDir,
  C0RunIdentityError
} from '../src/smoke/c0-report-directory'

describe('single-use C0 report identity', () => {
  it('claims a fresh report directory and refuses reuse without overwriting evidence', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'canvas-c0-single-use-'))
    try {
      const reportDir = await claimSingleUseC0ReportDir(reportRoot, 'c0-20260901-a1b2c3d4')
      const marker = join(reportDir, 'marker.txt')
      await writeFile(marker, 'preserved evidence\n', 'utf8')

      await expect(
        claimSingleUseC0ReportDir(reportRoot, 'c0-20260901-a1b2c3d4')
      ).rejects.toBeInstanceOf(C0RunIdentityError)
      await expect(readFile(marker, 'utf8')).resolves.toBe('preserved evidence\n')
    } finally {
      await rm(reportRoot, { recursive: true, force: true })
    }
  })

  it('uses the filesystem claim as an atomic concurrent-start gate', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'canvas-c0-single-use-race-'))
    try {
      const outcomes = await Promise.allSettled([
        claimSingleUseC0ReportDir(reportRoot, 'c0-20260901-deadbeef'),
        claimSingleUseC0ReportDir(reportRoot, 'c0-20260901-deadbeef')
      ])
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
      expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
      const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
      expect(rejected).toMatchObject({
        status: 'rejected',
        reason: expect.any(C0RunIdentityError)
      })
    } finally {
      await rm(reportRoot, { recursive: true, force: true })
    }
  })

  it('rejects path-like identities before claiming a directory', async () => {
    const reportRoot = await mkdtemp(join(tmpdir(), 'canvas-c0-single-use-invalid-'))
    try {
      await expect(claimSingleUseC0ReportDir(reportRoot, '../reused')).rejects.toThrow(
        C0RunIdentityError
      )
      await expect(claimSingleUseC0ReportDir(reportRoot, 'windows\\reused')).rejects.toThrow(
        C0RunIdentityError
      )
      await expect(claimSingleUseC0ReportDir(reportRoot, '')).rejects.toThrow(C0RunIdentityError)
    } finally {
      await rm(reportRoot, { recursive: true, force: true })
    }
  })
})
