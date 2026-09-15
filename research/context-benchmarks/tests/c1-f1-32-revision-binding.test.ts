import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertC1F1Native32BindingControlSurfaceMatchesActualInventory,
  assertC1F1Native32SurfaceWitnessMatchesActualInventory,
  loadC1F1Native32Contract,
  validateC1F1Native32FinalBoundContract
} from '../c1/f1/contract/c1-f1-native-feasibility-32-contract'
import {
  assertC1F1Native32LiveAuthorization,
  buildFinalBoundF1Contract,
  computeC1F1Native32ExecutionBinding,
  type C1F1Native32LiveAuthorization
} from '../c1/f1/runner/c1-f1-32-execution-runner'
import { assertC1LiveWorktreeClean } from '../src/c1-live-study'

const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const FINAL_BOUND_RELATIVE_PATH =
  'research/context-benchmarks/c1/f1/bindings/c1-f1-native-feasibility-32-final-bound.json'
const execFileAsync = promisify(execFile)
const tempRoots = new Set<string>()

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execFileAsync('git', [...args], { cwd })
  return result.stdout.trim()
}

function authorizationFor(input: {
  readonly contract: Awaited<ReturnType<typeof buildFinalBoundF1Contract>>['contract']
  readonly binding: Awaited<ReturnType<typeof computeC1F1Native32ExecutionBinding>>
}): C1F1Native32LiveAuthorization {
  const root = input.contract as unknown as Record<string, unknown>
  const execution = root['executionBinding'] as Record<string, unknown>
  const enrollment = root['enrollmentBinding'] as Record<string, unknown>
  return {
    schemaVersion: 1,
    decision: 'AUTHORIZED',
    scope: 'C1_F1_NATIVE_FEASIBILITY_32_ONLY',
    owner: 'synthetic-revision-binding-test',
    authorizedAt: '2026-09-15T00:00:00.000Z',
    studyId: 'c1-f1-32-20260915-a1b2c3d4',
    identityStatus: 'FRESH_NEVER_CLAIMED_SINGLE_USE',
    executionSurfaceRevision: input.binding.executionSurfaceRevision,
    executionSurfaceHash: input.binding.executionSurfaceHash,
    bindingControlSurfaceHash: input.binding.bindingControlSurfaceHash,
    runContractSha256: input.contract.runContractSha256,
    finalBoundRunContractSha256: input.contract.runContractSha256,
    freezeCandidateRunContractSha256: String(root['freezeCandidateRunContractSha256']),
    enrollmentManifestSha256: String(enrollment['taskManifestSha256']),
    providerConfigHash: String(execution['providerConfigHash']),
    provider: String(execution['provider']),
    model: String(execution['model']),
    endpoint: String(execution['endpoint']),
    budgets: root['budgets'] as Record<string, unknown>,
    runtimeIntervention: 'DISABLED',
    fallback: 'NONE',
    retry: 'FORBIDDEN',
    resume: 'FORBIDDEN',
    reuse: 'FORBIDDEN',
    credentialPersistence: 'MEMORY_ONLY'
  }
}

afterEach(async () => {
  await Promise.all([...tempRoots].map((root) => rm(root, { recursive: true, force: true })))
  tempRoots.clear()
})

describe('C1 F1-32 checkout and execution-surface revision binding', () => {
  it('accepts authorization after a binding-only artifact commit and merge changes HEAD', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'c1-f1-revision-binding-'))
    tempRoots.add(tempRoot)
    const worktreeRoot = join(tempRoot, 'checkout')
    const suffix = randomUUID().replaceAll('-', '')
    const artifactBranch = `test/f1-binding-artifact-${suffix}`
    const mainlineBranch = `test/f1-mainline-${suffix}`
    let worktreeAdded = false

    try {
      const implementationCommit = await git(REPO_ROOT, ['rev-parse', 'HEAD'])
      await git(REPO_ROOT, ['worktree', 'add', '--detach', worktreeRoot, implementationCommit])
      worktreeAdded = true

      const before = await computeC1F1Native32ExecutionBinding(worktreeRoot)
      const candidate = await loadC1F1Native32Contract(worktreeRoot, 'FREEZE_CANDIDATE')
      const boundBeforeArtifactCommit = buildFinalBoundF1Contract({
        candidate,
        binding: before
      }).contract
      const finalBoundPath = join(worktreeRoot, FINAL_BOUND_RELATIVE_PATH)
      await writeFile(finalBoundPath, JSON.stringify(boundBeforeArtifactCommit, null, 2) + '\n')

      await git(worktreeRoot, ['switch', '-c', artifactBranch])
      await git(worktreeRoot, ['add', FINAL_BOUND_RELATIVE_PATH])
      await git(worktreeRoot, [
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=F1 revision-binding test',
        '-c',
        'user.email=f1-revision-binding@example.invalid',
        'commit',
        '-m',
        'test: bind F1 artifact without changing execution surface'
      ])
      const bindingArtifactCommit = await git(worktreeRoot, ['rev-parse', 'HEAD'])

      await git(worktreeRoot, ['switch', '--detach', implementationCommit])
      await git(worktreeRoot, ['switch', '-c', mainlineBranch])
      await git(worktreeRoot, [
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=F1 revision-binding test',
        '-c',
        'user.email=f1-revision-binding@example.invalid',
        'commit',
        '--allow-empty',
        '-m',
        'test: advance checkout without changing bound surfaces'
      ])
      await git(worktreeRoot, [
        '-c',
        'commit.gpgsign=false',
        '-c',
        'user.name=F1 revision-binding test',
        '-c',
        'user.email=f1-revision-binding@example.invalid',
        'merge',
        '--no-ff',
        bindingArtifactCommit,
        '-m',
        'test: merge binding-only artifact commit'
      ])

      await assertC1LiveWorktreeClean(worktreeRoot)
      const afterMerge = await computeC1F1Native32ExecutionBinding(worktreeRoot)
      expect(afterMerge.checkoutRevision).not.toBe(before.checkoutRevision)
      expect(afterMerge.executionSurfaceRevision).toBe(before.executionSurfaceRevision)
      expect(afterMerge.executionSurfaceHash).toBe(before.executionSurfaceHash)
      expect(afterMerge.bindingControlSurfaceHash).toBe(before.bindingControlSurfaceHash)

      const validatedArtifact = validateC1F1Native32FinalBoundContract(
        JSON.parse(await readFile(finalBoundPath, 'utf8')) as unknown
      )
      const candidateAfterMerge = await loadC1F1Native32Contract(worktreeRoot, 'FREEZE_CANDIDATE')
      const dynamicFinalBound = buildFinalBoundF1Contract({
        candidate: candidateAfterMerge,
        binding: afterMerge
      }).contract
      expect(dynamicFinalBound.runContractSha256).toBe(validatedArtifact.runContractSha256)
      expect(
        (validatedArtifact['executionBinding'] as Record<string, unknown>)['checkoutRevision']
      ).toBe(implementationCommit)
      expect(
        (validatedArtifact['executionBinding'] as Record<string, unknown>)[
          'executionSurfaceRevision'
        ]
      ).toBe(afterMerge.executionSurfaceRevision)

      assertC1F1Native32SurfaceWitnessMatchesActualInventory(
        validatedArtifact,
        afterMerge.inventory
      )
      assertC1F1Native32BindingControlSurfaceMatchesActualInventory(
        validatedArtifact,
        afterMerge.bindingControlInventory
      )

      const authorization = authorizationFor({
        contract: dynamicFinalBound,
        binding: afterMerge
      })
      expect(() =>
        assertC1F1Native32LiveAuthorization({
          authorization,
          contract: dynamicFinalBound,
          binding: afterMerge,
          finalBoundRunContractSha256: dynamicFinalBound.runContractSha256
        })
      ).not.toThrow()
    } finally {
      if (worktreeAdded) {
        await execFileAsync('git', ['worktree', 'remove', '--force', worktreeRoot], {
          cwd: REPO_ROOT
        }).catch(() => undefined)
        await execFileAsync('git', ['branch', '-D', artifactBranch], { cwd: REPO_ROOT }).catch(
          () => undefined
        )
        await execFileAsync('git', ['branch', '-D', mainlineBranch], { cwd: REPO_ROOT }).catch(
          () => undefined
        )
      }
    }
  }, 120_000)
})
