import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import { sha256Hex, ValidationError, type ArtifactInput } from '@canvas-agent/persistence'
import type { ArtifactDescriptor } from '@canvas-agent/worker-runtime'

export const MAX_ARTIFACT_BYTES = 16 * 1024 * 1024

export interface PathFlavor {
  relative(from: string, to: string): string
  isAbsolute(value: string): boolean
  sep: string
}

const platformPath: PathFlavor = { relative, isAbsolute, sep }

// Cross-platform strict-descendant check via node:path semantics (a leading
// separator check would fail on Windows). The candidate must be strictly under
// the ancestor (not equal, not a sibling, not '..').
export function isStrictDescendant(
  candidate: string,
  ancestor: string,
  flavor: PathFlavor = platformPath
): boolean {
  const rel = flavor.relative(ancestor, candidate)
  return (
    rel.length > 0 && rel !== '..' && !rel.startsWith(`..${flavor.sep}`) && !flavor.isAbsolute(rel)
  )
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
// descriptors are only claims. Symlinks are rejected by lstat before realpath,
// and the resolved path is required to stay a strict descendant of the trusted
// root / execution directory. Reads are bounded: size is checked before any
// read, and at most MAX_ARTIFACT_BYTES + 1 bytes are ever buffered.
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
      const unresolvedPath = join(executionDirectory, descriptor.fileName)

      const rawStat = await lstat(unresolvedPath)
      if (rawStat.isSymbolicLink()) {
        throw new ValidationError('artifact_symlink_unsupported')
      }
      if (!rawStat.isFile()) {
        throw new ValidationError('artifact_not_regular_file')
      }

      const artifactPath = await realpath(unresolvedPath)
      if (!isStrictDescendant(artifactPath, executionDirectory)) {
        throw new ValidationError('artifact_path_escape')
      }

      const bytes = await readBounded(artifactPath)
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

// Fail-closed bounded read: the declared size is checked before reading, and no
// more than MAX_ARTIFACT_BYTES + 1 bytes are ever buffered.
async function readBounded(artifactPath: string): Promise<Buffer> {
  const handle = await open(artifactPath, 'r')
  try {
    const stat = await handle.stat()
    if (stat.size > MAX_ARTIFACT_BYTES) {
      throw new ValidationError('artifact_too_large')
    }
    const cap = MAX_ARTIFACT_BYTES + 1
    const buffer = Buffer.alloc(cap)
    let bytesRead = 0
    while (bytesRead < cap) {
      const read = await handle.read(buffer, bytesRead, cap - bytesRead, bytesRead)
      if (read.bytesRead === 0) break
      bytesRead += read.bytesRead
      if (bytesRead > MAX_ARTIFACT_BYTES) {
        throw new ValidationError('artifact_too_large')
      }
    }
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}
