import { ClaimRejectedError } from './errors'

export interface ClaimStore {
  claim(executionRequestId: string): boolean
  release(executionRequestId: string): boolean
  isClaimed(executionRequestId: string): boolean
}

export function createInMemoryClaimStore(): ClaimStore {
  const claimed = new Set<string>()
  return {
    claim(executionRequestId) {
      if (claimed.has(executionRequestId)) {
        return false
      }
      claimed.add(executionRequestId)
      return true
    },
    release(executionRequestId) {
      return claimed.delete(executionRequestId)
    },
    isClaimed(executionRequestId) {
      return claimed.has(executionRequestId)
    }
  }
}

export function claimOrThrow(store: ClaimStore, executionRequestId: string): void {
  if (!store.claim(executionRequestId)) {
    throw new ClaimRejectedError(executionRequestId)
  }
}
