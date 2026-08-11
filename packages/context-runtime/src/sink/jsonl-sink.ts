import { mkdir, appendFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  BinaryBlockMetadata,
  ModelCallObservation,
  ModelMessageDescriptor
} from '../observation/types'
import type { ObservationSink } from './in-memory-sink'

export interface JsonlSinkOptions {
  readonly directory: string
  readonly sessionId: string
}

interface JsonlModelMessageDescriptor {
  readonly position: number
  readonly role: string
  readonly contentType: string
  readonly estimatedTokens: number
  readonly estimatedChars: number
  readonly contentHash: string
  readonly toolName?: string
  readonly toolCallId?: string
  readonly isError?: boolean
  readonly binaryBlocks?: readonly BinaryBlockMetadata[]
  readonly rawPreview?: string
}

interface JsonlObservation {
  readonly kind: 'model-call'
  readonly runtimeSessionId: string
  readonly sequence: number
  readonly observedAt: string
  readonly harness: string
  readonly estimateScope: string
  readonly messageCount: number
  readonly observedMessageTokenEstimate: number
  readonly observedMessageCharEstimate: number
  readonly categoryCounts: Record<string, number>
  readonly toolResultCount: number
  readonly messageDescriptors: JsonlModelMessageDescriptor[]
  readonly rawCapture: boolean
}

// Opt-in JSONL research sink. Each observation is one normalized line. The
// output is metadata-only unless the observation builder was explicitly given a
// raw capture policy; raw previews are always bounded and redacted upstream.
export class JsonlObservationSink implements ObservationSink {
  private readonly file: string
  private readonly buffer: string[] = []
  private closed = false

  constructor(options: JsonlSinkOptions) {
    this.file = join(options.directory, `${options.sessionId}.jsonl`)
  }

  get path(): string {
    return this.file
  }

  write(observation: ModelCallObservation): void {
    if (this.closed) {
      throw new Error('JsonlObservationSink is closed')
    }
    const line = this.serialize(observation)
    this.buffer.push(line)
  }

  close(): void {
    this.closed = true
  }

  private serialize(observation: ModelCallObservation): string {
    const descriptors: JsonlModelMessageDescriptor[] = observation.messageDescriptors.map(
      (descriptor) => {
        const result: JsonlModelMessageDescriptor = {
          position: descriptor.position,
          role: descriptor.role,
          contentType: descriptor.contentType,
          estimatedTokens: descriptor.estimatedTokens,
          estimatedChars: descriptor.estimatedChars,
          contentHash: descriptor.contentHash,
          ...(descriptor.toolName !== undefined ? { toolName: descriptor.toolName } : {}),
          ...(descriptor.toolCallId !== undefined ? { toolCallId: descriptor.toolCallId } : {}),
          ...(descriptor.isError !== undefined ? { isError: descriptor.isError } : {}),
          ...(descriptor.binaryBlocks !== undefined
            ? { binaryBlocks: descriptor.binaryBlocks }
            : {}),
          ...(descriptor.rawPreview !== undefined ? { rawPreview: descriptor.rawPreview } : {})
        }
        return result
      }
    )
    const json: JsonlObservation = {
      kind: 'model-call',
      runtimeSessionId: observation.runtimeSessionId,
      sequence: observation.sequence,
      observedAt: observation.observedAt,
      harness: observation.harness,
      estimateScope: observation.estimateScope,
      messageCount: observation.messageCount,
      observedMessageTokenEstimate: observation.observedMessageTokenEstimate,
      observedMessageCharEstimate: observation.observedMessageCharEstimate,
      categoryCounts: observation.categoryCounts,
      toolResultCount: observation.toolResultCount,
      messageDescriptors: descriptors,
      rawCapture: descriptors.some((descriptor) => descriptor.rawPreview !== undefined)
    }
    return JSON.stringify(json)
  }

  // Flushes buffered lines to disk under `<directory>/<sessionId>.jsonl`.
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    const payload = this.buffer.join('\n') + '\n'
    this.buffer.length = 0
    await mkdir(dirname(this.file), { recursive: true })
    await appendFile(this.file, payload, 'utf8')
  }
}
