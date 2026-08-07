import { utilityProcess } from 'electron'
import { join } from 'node:path'
import type { DispatchResult, ExecutionRequestContract } from '@canvas-agent/contracts'
import { workerHostResponseSchema, type WorkerHostResponse } from '../worker/protocol'
import type { AppConfig } from './config'
import { HostUnavailableError } from './command-errors'
import type { WorkerHost } from './worker-host'

export interface UtilityProcessLike {
  postMessage(message: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  kill(): void
}

export type ProcessFactory = (entry: string) => UtilityProcessLike

function defaultProcessFactory(entry: string): UtilityProcessLike {
  return utilityProcess.fork(entry, [], { serviceName: 'canvas-agent-worker' })
}

type HostState = 'STOPPED' | 'STARTING' | 'READY' | 'DISPOSING'

type PendingKind = 'dispatch' | 'cancel'

interface PendingRequest {
  kind: PendingKind
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

const INIT_TIMEOUT_MS = 10_000
const DISPOSE_TIMEOUT_MS = 10_000

export interface UtilityProcessWorkerHostOptions {
  initTimeoutMs?: number
  disposeTimeoutMs?: number
}

export class UtilityProcessWorkerHost implements WorkerHost {
  private state: HostState = 'STOPPED'
  private startPromise: Promise<void> | null = null
  private child: UtilityProcessLike | null = null
  private readonly pending = new Map<string, PendingRequest>()
  private readonly submittedExecutionIds = new Set<string>()
  private messageCounter = 0
  private initResolve: (() => void) | null = null
  private initReject: ((error: Error) => void) | null = null
  private initTimer: ReturnType<typeof setTimeout> | null = null
  private disposeResolve: (() => void) | null = null
  private disposeTimer: ReturnType<typeof setTimeout> | null = null
  private readonly initTimeoutMs: number
  private readonly disposeTimeoutMs: number

  constructor(
    private readonly appConfig: AppConfig,
    private readonly processFactory: ProcessFactory = defaultProcessFactory,
    options: UtilityProcessWorkerHostOptions = {}
  ) {
    this.initTimeoutMs = options.initTimeoutMs ?? INIT_TIMEOUT_MS
    this.disposeTimeoutMs = options.disposeTimeoutMs ?? DISPOSE_TIMEOUT_MS
  }

  async dispatch(request: ExecutionRequestContract): Promise<DispatchResult> {
    await this.ensureStarted()
    if (this.submittedExecutionIds.has(request.executionRequestId)) {
      throw new HostUnavailableError(
        `executionRequestId ${request.executionRequestId} was already submitted; retry with a new ExecutionRequest`
      )
    }
    this.submittedExecutionIds.add(request.executionRequestId)
    const messageId = this.nextMessageId()
    return this.request(messageId, 'dispatch', {
      protocolVersion: 1,
      type: 'dispatch',
      messageId,
      executionRequestId: request.executionRequestId,
      request
    }) as Promise<DispatchResult>
  }

  async cancel(executionRequestId: string): Promise<boolean> {
    await this.ensureStarted()
    const messageId = this.nextMessageId()
    const result = (await this.request(messageId, 'cancel', {
      protocolVersion: 1,
      type: 'cancel',
      messageId,
      executionRequestId
    })) as { cancelled: boolean }
    return result.cancelled
  }

  async dispose(): Promise<void> {
    if (this.state === 'STOPPED') {
      return
    }
    if (this.state === 'STARTING') {
      await this.ensureStarted()
    }
    if (this.state === 'DISPOSING') {
      return
    }

    this.state = 'DISPOSING'
    const child = this.child
    if (!child) {
      this.state = 'STOPPED'
      return
    }
    await new Promise<void>((resolve) => {
      this.disposeResolve = resolve
      child.postMessage({ protocolVersion: 1, type: 'dispose' })
      this.disposeTimer = setTimeout(() => resolve(), this.disposeTimeoutMs)
    })
    this.disposeResolve = null
    if (this.disposeTimer !== null) {
      clearTimeout(this.disposeTimer)
      this.disposeTimer = null
    }
    child.kill()
    this.child = null
    this.state = 'STOPPED'
    this.startPromise = null
  }

  private ensureStarted(): Promise<void> {
    if (this.state === 'READY') {
      return Promise.resolve()
    }
    if (this.state === 'STARTING' && this.startPromise !== null) {
      return this.startPromise
    }
    this.state = 'STARTING'
    this.startPromise = this.start()
    return this.startPromise
  }

  private async start(): Promise<void> {
    const child = this.processFactory(join(__dirname, 'worker.js'))
    this.child = child
    child.on('message', (message) => this.handleMessage(message))
    child.on('exit', (code) => this.handleExit(code))

    await new Promise<void>((resolve, reject) => {
      this.initResolve = resolve
      this.initReject = reject
      child.postMessage({
        protocolVersion: 1,
        type: 'init',
        sourceRepositoryPath: this.appConfig.sourceRepositoryPath,
        runtimeDirectory: this.appConfig.runtimeDirectory
      })
      this.initTimer = setTimeout(() => {
        this.initReject = null
        reject(new HostUnavailableError('worker init timed out'))
      }, this.initTimeoutMs)
    })

    this.state = 'READY'
    this.startPromise = null
    this.initResolve = null
    this.initReject = null
    if (this.initTimer !== null) {
      clearTimeout(this.initTimer)
      this.initTimer = null
    }
  }

  private handleMessage(raw: unknown): void {
    const parsed = workerHostResponseSchema.safeParse(raw)
    if (!parsed.success) {
      console.error('[worker-host] invalid response frame', raw)
      return
    }
    const response = parsed.data

    switch (response.type) {
      case 'init:ack':
        if (this.initResolve !== null) {
          this.initResolve()
        }
        break
      case 'dispatch:result':
        this.settle(response.messageId, response)
        break
      case 'cancel:result':
        this.settle(response.messageId, response)
        break
      case 'error':
        this.rejectAll(new HostUnavailableError(response.message))
        break
      case 'dispose:ack':
        if (this.disposeResolve !== null) {
          this.disposeResolve()
        }
        break
    }
  }

  private handleExit(code: number): void {
    console.error(`[worker-host] utility process exited (${code})`)
    if (this.initReject !== null) {
      const reject = this.initReject
      this.initReject = null
      reject(new HostUnavailableError(`worker exited during start (${code})`))
    }
    this.rejectAll(new HostUnavailableError(`worker host exited (${code})`))
    this.child = null
    this.state = 'STOPPED'
    this.startPromise = null
  }

  private settle(
    messageId: string,
    response: Extract<WorkerHostResponse, { type: 'dispatch:result' | 'cancel:result' }>
  ): void {
    const pending = this.pending.get(messageId)
    if (pending === undefined) {
      console.error(`[worker-host] unknown messageId ${messageId}`)
      return
    }
    this.pending.delete(messageId)
    if (response.type === 'dispatch:result' && pending.kind === 'dispatch') {
      pending.resolve(response.result)
    } else if (response.type === 'cancel:result' && pending.kind === 'cancel') {
      pending.resolve({ cancelled: response.cancelled })
    } else {
      pending.reject(new HostUnavailableError('unexpected response frame'))
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }

  private request(messageId: string, kind: PendingKind, frame: unknown): Promise<unknown> {
    const child = this.child
    if (!child) {
      return Promise.reject(new HostUnavailableError('worker host is not started'))
    }
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(messageId, { kind, resolve, reject })
      try {
        child.postMessage(frame)
      } catch (error) {
        this.pending.delete(messageId)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private nextMessageId(): string {
    this.messageCounter += 1
    return `msg-${this.messageCounter}`
  }
}
