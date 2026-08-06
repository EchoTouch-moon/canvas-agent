export interface VerificationCommandResult {
  argv: readonly string[]
  exitCode: number | null
  signal: string | null
  stdout: string
  stderr: string
  timedOut: boolean
  cancelled: boolean
  outputTruncated: boolean
  durationMs: number
}

export interface ArtifactDescriptor {
  kind: 'PATCH' | 'TEST_RESULT' | 'AGENT_SUMMARY' | 'AGENT_PARTIAL'
  fileName: string
  contentHash: string
  sizeBytes: number
}

export type DispatchOutcome =
  | 'VALIDATION_REJECTED'
  | 'CLAIM_REJECTED'
  | 'REVISION_MISMATCH'
  | 'SUCCEEDED'
  | 'PARTIAL'
  | 'CANCELLED'

export interface RecoveryMetadata {
  executionRequestId: string
  worktreePath: string
  state: 'running' | 'interrupted'
  startedAt: string
  interruptedAt?: string
  cleanupSucceeded: boolean
}

export interface RevisionMismatchDetail {
  field: string
  expected: string | null
  actual: string | null
}

export interface DispatchResult {
  outcome: DispatchOutcome
  claimGranted: boolean
  rejectionReason?: string
  revisionMismatch?: RevisionMismatchDetail
  patch?: string
  patchHash?: string
  verificationResults?: VerificationCommandResult[]
  artifacts?: ArtifactDescriptor[]
  agentSummary?: string
  recovery?: RecoveryMetadata
  timedOut?: boolean
}
