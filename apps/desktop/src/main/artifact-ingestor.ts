import { lstat, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256Hex, ValidationError, type ArtifactInput } from '@canvas-agent/persistence'
import type { ArtifactDescriptor } from '@canvas-agent/worker-runtime'

export const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024

function isStrictDescendant(candidate: string, ancestor: string): boolean {
  const relative = candidate.slice(ancestor.length)
  return relative.startsWith('/') && !relative.split('/').includes('..')
}

function validateFileName(fileName: string): void {
  if (fileName.length === 0 || fileName === '.' || fileName === '..') {
    throw new ValidationError('artifact_invalid_file_name')
  }
  if (/[\\/\0]/.test(fileName)) {
    throw new ValidationError('artifact_invalid_file_name')
  }
}

// Main establishes the facts about worker-produced artifacts; the worker's
// descriptors are only claims. Path containment uses realpath so a symlinked
// parent directory cannot escape the trusted artifact root.
export class ArtifactIngestor {
  constructor(private readonly runtimeDirectory: string) {}

  async ingest(
    executionRequestId: string,
    descriptors: readonly ArtifactDescriptor[]
  ): Promise<ArtifactInput[]> {
    if (descriptors.length === 0) {
      return []
    }
    const trustedArtifactRoot = await realpath(join(this.runtimeDirectory, 'artifacts'))
    const executionDirectory = await realpath(join(trustedArtifactRoot, executionRequestId))
    if (!isStrictDescendant(executionDirectory, trustedArtifactRoot)) {
      throw new ValidationError('artifact_execution_dir_escape')
    }

    const inputs: ArtifactInput[] = []
    for (const descriptor of descriptors) {
      validateFileName(descriptor.fileName)
      const artifactPath = await realpath(join(executionDirectory, descriptor.fileName))
      if (!isStrictDescendant(artifactPath, executionDirectory)) {
        throw new ValidationError('artifact_path_escape')
      }
      const stat = await lstat(artifactPath)
      if (!stat.isFile()) {
        throw new ValidationError('artifact_not_regular_file')
      }
      const bytes = await readFile(artifactPath)
      if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
        throw new ValidationError('artifact_too_large')
      }
      if (bytes.byteLength !== descriptor.sizeBytes) {
        throw new ValidationError('artifact_size_mismatch')
      }
      let content: string
      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes))
      } catch {
        throw new ValidationError('artifact_not_utf8')
      }
      const contentHash = sha256Hex(content)
      if (contentHash !== descriptor.contentHash) {
        throw new ValidationError('artifact_hash_mismatch')
      }
      inputs.push({
        kind: descriptor.kind,
        fileName: descriptor.fileName,
        content,
        contentHash,
        sizeBytes: bytes.byteLength
      })
    }
    return inputs
  }
}
