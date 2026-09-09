import { resolve } from 'node:path'
import { loadC1E0EnrollmentManifest, loadC1E0RunContract } from '../src/c1-e0-binding'

const repoRoot = resolve(import.meta.dirname, '../../..')
const enrollment = await loadC1E0EnrollmentManifest(repoRoot)
const contract = await loadC1E0RunContract(repoRoot)

process.stdout.write(
  `${JSON.stringify(
    {
      enrollmentManifestId: enrollment.manifestId,
      enrollmentCohort: enrollment.enrollmentCohort,
      candidateCount: enrollment.candidateCount,
      selectedTaskIds: enrollment.selectedTaskIds,
      enrollmentManifestSha256: enrollment.manifestSha256,
      runContractId: contract.contractId,
      pairCount: contract.design.pairCount,
      totalLegs: contract.design.totalLegs,
      armOrderQuota: contract.design.armOrderQuota,
      pairAssignments: contract.pairAssignments,
      runContractSha256: contract.runContractSha256,
      execution: 'NO_PROVIDER'
    },
    null,
    2
  )}\n`
)
